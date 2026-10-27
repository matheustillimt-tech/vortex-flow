import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (nome: string) =>
  readFileSync(new URL(`../supabase/migrations/${nome}.sql`, import.meta.url), "utf8");
const m042 = sql("042_permission_profiles");
const m045 = sql("045_projects_sectors_follow_permissions");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const PESSOAS: Record<string, string> = {
  ProjCria: "00000000-0000-0000-0000-000000000011",
  ProjEdita: "00000000-0000-0000-0000-000000000012",
  ProjExclui: "00000000-0000-0000-0000-000000000013",
  SetorCria: "00000000-0000-0000-0000-000000000021",
  SetorEdita: "00000000-0000-0000-0000-000000000022",
  Gestao: "00000000-0000-0000-0000-000000000031",
  Nada: "00000000-0000-0000-0000-000000000099"
};
const PROJETO = "10000000-0000-0000-0000-000000000001";
const SETOR = "40000000-0000-0000-0000-000000000001";

/**
 * Banco mínimo com as políticas de produção que a 045 encosta: projetos, funis e
 * produtos abertos a quem vê o projeto; colunas com inserir/excluir só para
 * admin; setores por is_admin_or_gestor.
 */
async function fixture() {
  const db = new PGlite();
  const valores = Object.entries(PESSOAS)
    .map(([nome, id]) => `('${id}', '${nome}', 'colaborador')`)
    .join(", ");
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
    insert into public.users (id, nome, role) values ('${ADMIN}', 'Admin', 'admin'), ${valores};
  `);
  await db.exec(m042);
  await db.exec(`
    insert into public.permission_profiles (nome, can_manage) values
      ('ProjCria', false), ('ProjEdita', false), ('ProjExclui', false),
      ('SetorCria', false), ('SetorEdita', false), ('Gestao', true), ('Nada', false);
    insert into public.permission_grants (profile_id, resource, action)
      select id, 'projetos', 'create' from public.permission_profiles where nome = 'ProjCria'
      union all select id, 'projetos', 'edit' from public.permission_profiles where nome = 'ProjEdita'
      union all select id, 'projetos', 'delete' from public.permission_profiles where nome = 'ProjExclui'
      union all select id, 'configuracoes.setores', 'create' from public.permission_profiles where nome = 'SetorCria'
      union all select id, 'configuracoes.setores', 'edit' from public.permission_profiles where nome = 'SetorEdita';
    update public.users u set permission_profile_id = p.id
      from public.permission_profiles p where p.nome = u.nome and u.nome <> 'Admin';

    create function public.user_can_see_project(uid uuid, pid uuid) returns boolean
      language sql stable as $$ select true $$;

    create table public.projects (id uuid primary key default gen_random_uuid(), nome text, status text not null default 'ativo');
    create table public.funnels (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects on delete cascade, nome text);
    create table public.products (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects on delete cascade, nome text);
    create table public.kanban_columns (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects on delete cascade, nome text);
    create table public.sectors (id uuid primary key default gen_random_uuid(), nome text, status text not null default 'ativo');

    alter table public.projects enable row level security;
    alter table public.funnels enable row level security;
    alter table public.products enable row level security;
    alter table public.kanban_columns enable row level security;
    alter table public.sectors enable row level security;

    create policy aberto on public.projects for all to authenticated using (true) with check (true);
    create policy aberto on public.funnels for all to authenticated using (true) with check (true);
    create policy aberto on public.products for all to authenticated using (true) with check (true);

    create policy "kanban_columns_select_scoped" on public.kanban_columns for select using (true);
    create policy "kanban_columns_update_scoped" on public.kanban_columns for update using (true) with check (true);
    create policy "kanban_columns_insert_admin" on public.kanban_columns for insert with check (public.is_admin(auth.uid()));
    create policy "kanban_columns_delete_admin" on public.kanban_columns for delete using (public.is_admin(auth.uid()));

    create policy "sectors_select" on public.sectors for select using (true);
    create policy "sectors_write" on public.sectors for all
      using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));

    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;

    insert into public.projects (id, nome) values ('${PROJETO}', 'Existente');
    insert into public.sectors (id, nome) values ('${SETOR}', 'Suporte');
  `);
  await db.exec(m045);
  return db;
}

async function como<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const valor = async (db: PGlite, consulta: string) =>
  (await db.query<Record<string, unknown>>(consulta)).rows[0];

describe("045 — projetos seguem o perfil", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("sem Criar, não cria projeto; com Criar, cria", async () => {
    await expect(
      como(db, PESSOAS.ProjEdita, () => db.exec(`insert into public.projects (nome) values ('x')`))
    ).rejects.toThrow(/row-level security/i);
    await como(db, PESSOAS.ProjCria, () => db.exec(`insert into public.projects (nome) values ('Novo')`));
    expect(await valor(db, `select count(*)::int as n from public.projects where nome = 'Novo'`)).toEqual({ n: 1 });
  });

  it("sem Editar, não arquiva; com Editar, arquiva", async () => {
    await como(db, PESSOAS.ProjCria, () =>
      db.exec(`update public.projects set status = 'arquivado' where id = '${PROJETO}'`)
    );
    expect(await valor(db, `select status from public.projects where id = '${PROJETO}'`)).toEqual({ status: "ativo" });
    await como(db, PESSOAS.ProjEdita, () =>
      db.exec(`update public.projects set status = 'arquivado' where id = '${PROJETO}'`)
    );
    expect(await valor(db, `select status from public.projects where id = '${PROJETO}'`)).toEqual({ status: "arquivado" });
  });

  it("funis e produtos exigem Editar", async () => {
    await expect(
      como(db, PESSOAS.ProjCria, () =>
        db.exec(`insert into public.funnels (project_id, nome) values ('${PROJETO}', 'Funil')`)
      )
    ).rejects.toThrow(/row-level security/i);
    await como(db, PESSOAS.ProjEdita, async () => {
      await db.exec(`insert into public.funnels (project_id, nome) values ('${PROJETO}', 'Funil')`);
      await db.exec(`insert into public.products (project_id, nome) values ('${PROJETO}', 'Produto')`);
    });
    expect(await valor(db, `select count(*)::int as n from public.products`)).toEqual({ n: 1 });
  });

  it("colunas: Editar agora cria e exclui — antes só Super Admin conseguia", async () => {
    await como(db, PESSOAS.ProjEdita, () =>
      db.exec(`insert into public.kanban_columns (project_id, nome) values ('${PROJETO}', 'Revisão')`)
    );
    await como(db, PESSOAS.ProjEdita, () =>
      db.exec(`delete from public.kanban_columns where nome = 'Revisão'`)
    );
    expect(await valor(db, `select count(*)::int as n from public.kanban_columns where nome = 'Revisão'`)).toEqual({ n: 0 });
  });

  it("colunas: sem nenhuma permissão de projeto, não cria nem renomeia", async () => {
    await db.exec(`insert into public.kanban_columns (project_id, nome) values ('${PROJETO}', 'Fixa')`);
    await expect(
      como(db, PESSOAS.Nada, () =>
        db.exec(`insert into public.kanban_columns (project_id, nome) values ('${PROJETO}', 'x')`)
      )
    ).rejects.toThrow(/row-level security/i);
    await como(db, PESSOAS.Nada, () =>
      db.exec(`update public.kanban_columns set nome = 'Mudou' where nome = 'Fixa'`)
    );
    expect(await valor(db, `select count(*)::int as n from public.kanban_columns where nome = 'Fixa'`)).toEqual({ n: 1 });
  });

  it("colunas: Criar insere (colunas padrão de projeto novo), mas não exclui", async () => {
    await como(db, PESSOAS.ProjCria, () =>
      db.exec(`insert into public.kanban_columns (project_id, nome) values ('${PROJETO}', 'Padrão')`)
    );
    await como(db, PESSOAS.ProjCria, () =>
      db.exec(`delete from public.kanban_columns where nome = 'Padrão'`)
    );
    expect(await valor(db, `select count(*)::int as n from public.kanban_columns where nome = 'Padrão'`)).toEqual({ n: 1 });
  });

  it("sem Excluir, não exclui projeto; com Excluir, exclui", async () => {
    await como(db, PESSOAS.ProjEdita, () => db.exec(`delete from public.projects where id = '${PROJETO}'`));
    expect(await valor(db, `select count(*)::int as n from public.projects where id = '${PROJETO}'`)).toEqual({ n: 1 });
    await como(db, PESSOAS.ProjExclui, () => db.exec(`delete from public.projects where id = '${PROJETO}'`));
    expect(await valor(db, `select count(*)::int as n from public.projects where id = '${PROJETO}'`)).toEqual({ n: 0 });
  });
});

describe("045 — setores seguem a aba Setores", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("a caixa 'gerir conteúdo', sozinha, deixa de liberar setores", async () => {
    await expect(
      como(db, PESSOAS.Gestao, () => db.exec(`insert into public.sectors (nome) values ('x')`))
    ).rejects.toThrow(/row-level security/i);
  });

  it("Criar cria; Editar altera mas não cria", async () => {
    await como(db, PESSOAS.SetorCria, () => db.exec(`insert into public.sectors (nome) values ('Financeiro')`));
    await expect(
      como(db, PESSOAS.SetorEdita, () => db.exec(`insert into public.sectors (nome) values ('y')`))
    ).rejects.toThrow(/row-level security/i);
    await como(db, PESSOAS.SetorEdita, () =>
      db.exec(`update public.sectors set status = 'arquivado' where id = '${SETOR}'`)
    );
    expect(await valor(db, `select status from public.sectors where id = '${SETOR}'`)).toEqual({ status: "arquivado" });
  });

  it("acesso total segue fazendo tudo", async () => {
    await como(db, ADMIN, async () => {
      await db.exec(`insert into public.sectors (id, nome) values ('40000000-0000-0000-0000-0000000000aa', 'Admin')`);
      await db.exec(`delete from public.sectors where id = '40000000-0000-0000-0000-0000000000aa'`);
      await db.exec(`insert into public.projects (id, nome) values ('10000000-0000-0000-0000-0000000000aa', 'Admin')`);
      await db.exec(`delete from public.projects where id = '10000000-0000-0000-0000-0000000000aa'`);
    });
    expect(await valor(db, `select count(*)::int as n from public.sectors where nome = 'Admin'`)).toEqual({ n: 0 });
  });

  it("remove as políticas antigas e é idempotente", async () => {
    await db.exec(m045);
    const antigas = await valor(db, `
      select count(*)::int as n from pg_policies where schemaname = 'public'
        and policyname in ('sectors_write', 'kanban_columns_insert_admin', 'kanban_columns_delete_admin')
    `);
    expect(antigas).toEqual({ n: 0 });
    const novas = await valor(db, `
      select count(*)::int as n from pg_policies where schemaname = 'public'
        and policyname ~ '(_perm_(insert|update|delete)|_(insert|delete)_perm)$'
        and tablename in ('projects', 'funnels', 'products', 'kanban_columns', 'sectors')
    `);
    // projects 3 + funnels 3 + products 3 + kanban_columns 3 + sectors 3
    expect(novas).toEqual({ n: 15 });
  });
});
