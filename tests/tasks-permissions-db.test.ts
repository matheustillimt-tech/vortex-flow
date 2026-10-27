import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (nome: string) =>
  readFileSync(new URL(`../supabase/migrations/${nome}.sql`, import.meta.url), "utf8");
const m042 = sql("042_permission_profiles");
const m044 = sql("044_tasks_follow_permissions");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const CRIA = "00000000-0000-0000-0000-000000000002";
const EDITA = "00000000-0000-0000-0000-000000000003";
const EXCLUI = "00000000-0000-0000-0000-000000000004";
const NADA = "00000000-0000-0000-0000-000000000005";
const PROJETO = "10000000-0000-0000-0000-000000000001";
const TAREFA = "20000000-0000-0000-0000-000000000001";

const SUBTABELAS = [
  "task_assignees",
  "task_checklist_items",
  "task_links",
  "task_dependencies",
  "task_attachments"
];

/**
 * Banco mínimo com o que a 044 encosta. As políticas permissivas imitam as de
 * produção (qualquer autenticado escreve), para provar que a 044 restringe.
 */
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('admin', 'gestor', 'colaborador');
    create table public.users (
      id uuid primary key, nome text not null, role public.user_role not null,
      ativo boolean not null default true, updated_at timestamptz not null default now()
    );
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;
    create function public.is_admin(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role = 'admin' and ativo) $$;
    create function public.is_admin_or_gestor(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role in ('admin','gestor') and ativo) $$;
    insert into public.users (id, nome, role) values
      ('${ADMIN}', 'Admin', 'admin'), ('${CRIA}', 'Cria', 'colaborador'),
      ('${EDITA}', 'Edita', 'colaborador'), ('${EXCLUI}', 'Exclui', 'colaborador'),
      ('${NADA}', 'Nada', 'colaborador');
  `);
  await db.exec(m042);
  await db.exec(`
    insert into public.permission_profiles (nome) values ('Cria'), ('Edita'), ('Exclui');
    insert into public.permission_grants (profile_id, resource, action)
      select id, 'tarefas', 'create' from public.permission_profiles where nome = 'Cria'
      union all select id, 'tarefas', 'edit' from public.permission_profiles where nome = 'Edita'
      union all select id, 'tarefas', 'delete' from public.permission_profiles where nome = 'Exclui';
    update public.users u set permission_profile_id = p.id
      from public.permission_profiles p where p.nome = u.nome and u.nome in ('Cria','Edita','Exclui');

    create table public.projects (id uuid primary key);
    create table public.tasks (
      id uuid primary key, project_id uuid references public.projects,
      titulo text not null, status text not null default 'pendente'
    );
    create table public.task_assignees (task_id uuid references public.tasks on delete cascade, user_id uuid, primary key (task_id, user_id));
    create table public.task_checklist_items (id uuid primary key, task_id uuid references public.tasks on delete cascade, titulo text, done boolean default false);
    create table public.task_links (id uuid primary key default gen_random_uuid(), task_id uuid references public.tasks on delete cascade, url text);
    create table public.task_dependencies (id uuid primary key default gen_random_uuid(), task_id uuid references public.tasks on delete cascade, depends_on_task_id uuid);
    create table public.task_attachments (id uuid primary key default gen_random_uuid(), task_id uuid references public.tasks on delete cascade, url text);

    -- RPCs remanescentes da área de Processos, com a concessão de produção.
    create function public.apply_template_task(uuid, uuid, date) returns uuid
      language sql security definer as $$ select null::uuid $$;
    create function public.apply_process_template(uuid, uuid, date) returns uuid
      language sql security definer as $$ select null::uuid $$;
    grant execute on function public.apply_template_task(uuid, uuid, date) to authenticated;
    grant execute on function public.apply_process_template(uuid, uuid, date) to authenticated;
  `);
  for (const t of ["tasks", ...SUBTABELAS]) {
    await db.exec(`
      alter table public.${t} enable row level security;
      create policy aberto on public.${t} for all to authenticated using (true) with check (true);
    `);
  }
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    insert into public.projects values ('${PROJETO}');
    insert into public.tasks (id, project_id, titulo) values ('${TAREFA}', '${PROJETO}', 'Existente');
    insert into public.task_checklist_items (id, task_id, titulo)
      values ('30000000-0000-0000-0000-000000000001', '${TAREFA}', 'Item');
  `);
  await db.exec(m044);
  return db;
}

/** Executa como a pessoa, com a RLS valendo. */
async function como<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const statusDaTarefa = async (db: PGlite) =>
  (await db.query<{ status: string }>(`select status from public.tasks where id = '${TAREFA}'`)).rows[0]?.status;

describe("044 — tarefas seguem o perfil", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("sem Criar, não cria tarefa", async () => {
    await expect(
      como(db, NADA, () =>
        db.exec(`insert into public.tasks (id, titulo) values (gen_random_uuid(), 'x')`)
      )
    ).rejects.toThrow(/row-level security/i);
    await expect(
      como(db, EDITA, () =>
        db.exec(`insert into public.tasks (id, titulo) values (gen_random_uuid(), 'x')`)
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("com Criar, cria a tarefa e grava responsáveis e checklist no mesmo fluxo", async () => {
    const nova = "20000000-0000-0000-0000-0000000000aa";
    await como(db, CRIA, async () => {
      await db.exec(`insert into public.tasks (id, project_id, titulo) values ('${nova}', '${PROJETO}', 'Nova')`);
      await db.exec(`insert into public.task_assignees values ('${nova}', '${CRIA}')`);
      await db.exec(`insert into public.task_checklist_items (id, task_id, titulo)
        values ('30000000-0000-0000-0000-0000000000aa', '${nova}', 'Passo')`);
    });
    const r = await db.query(`select 1 from public.task_assignees where task_id = '${nova}'`);
    expect(r.rows).toHaveLength(1);
  });

  it("sem Editar, não altera nenhuma tarefa — nem conclui", async () => {
    for (const uid of [NADA, CRIA, EXCLUI]) {
      await como(db, uid, () =>
        db.exec(`update public.tasks set status = 'concluido' where id = '${TAREFA}'`)
      );
      expect(await statusDaTarefa(db), `perfil ${uid}`).toBe("pendente");
    }
  });

  it("com Editar, altera e conclui", async () => {
    await como(db, EDITA, () =>
      db.exec(`update public.tasks set status = 'concluido' where id = '${TAREFA}'`)
    );
    expect(await statusDaTarefa(db)).toBe("concluido");
  });

  it("com Criar mas sem Editar, não marca item do checklist nem o remove", async () => {
    const item = "30000000-0000-0000-0000-000000000001";
    await como(db, CRIA, async () => {
      await db.exec(`update public.task_checklist_items set done = true where id = '${item}'`);
      await db.exec(`delete from public.task_checklist_items where id = '${item}'`);
    });
    const r = await db.query<{ done: boolean }>(`select done from public.task_checklist_items where id = '${item}'`);
    expect(r.rows).toEqual([{ done: false }]);
  });

  it("com Editar, mexe nas subtabelas", async () => {
    const item = "30000000-0000-0000-0000-000000000001";
    await como(db, EDITA, async () => {
      await db.exec(`update public.task_checklist_items set done = true where id = '${item}'`);
      await db.exec(`insert into public.task_links (task_id, url) values ('${TAREFA}', 'https://x')`);
    });
    const r = await db.query<{ done: boolean }>(`select done from public.task_checklist_items where id = '${item}'`);
    expect(r.rows).toEqual([{ done: true }]);
  });

  it("sem Excluir, não exclui; com Excluir, exclui", async () => {
    await como(db, EDITA, () => db.exec(`delete from public.tasks where id = '${TAREFA}'`));
    expect(await statusDaTarefa(db)).toBeDefined();
    await como(db, EXCLUI, () => db.exec(`delete from public.tasks where id = '${TAREFA}'`));
    expect(await statusDaTarefa(db)).toBeUndefined();
  });

  it("acesso total faz tudo", async () => {
    const t = "20000000-0000-0000-0000-0000000000bb";
    await como(db, ADMIN, async () => {
      await db.exec(`insert into public.tasks (id, titulo) values ('${t}', 'Admin')`);
      await db.exec(`update public.tasks set status = 'em_andamento' where id = '${t}'`);
      await db.exec(`delete from public.tasks where id = '${t}'`);
    });
    const r = await db.query(`select 1 from public.tasks where id = '${t}'`);
    expect(r.rows).toHaveLength(0);
  });

  it("fecha a brecha das RPCs de template", async () => {
    const r = await db.query<{ a: boolean; b: boolean }>(`
      select has_function_privilege('authenticated', 'public.apply_template_task(uuid, uuid, date)', 'execute') as a,
             has_function_privilege('authenticated', 'public.apply_process_template(uuid, uuid, date)', 'execute') as b
    `);
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });

  it("é idempotente", async () => {
    await db.exec(m044);
    // Expressão exata: em LIKE o "_" é curinga e pegaria as políticas permission_*.
    const r = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_policies
      where schemaname = 'public' and policyname ~ '_perm_(insert|update|delete)$'
    `);
    // 3 em tasks + 3 por subtabela.
    expect(r.rows[0].n).toBe(3 + 3 * SUBTABELAS.length);
  });
});
