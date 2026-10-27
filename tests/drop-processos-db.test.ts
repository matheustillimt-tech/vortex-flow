import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const m048 = readFileSync(
  new URL("../supabase/migrations/048_drop_processos.sql", import.meta.url),
  "utf8"
);

const TABELAS = [
  "processes",
  "process_templates",
  "template_etapas",
  "template_tasks",
  "template_checklist_items"
];

/** Reproduz o que a 008 e a 026-034 deixaram no banco, com dados. */
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;

    create table public.users (id uuid primary key, nome text, updated_at timestamptz not null default now());
    create trigger trg_users_updated before update on public.users
      for each row execute function public.set_updated_at();
    create table public.sectors (id uuid primary key);

    create table public.processes (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      sector_id uuid references public.sectors(id) on delete set null,
      owner_id uuid references public.users(id) on delete set null,
      view_count int not null default 0,
      updated_at timestamptz not null default now()
    );
    create trigger trg_processes_updated before update on public.processes
      for each row execute function public.set_updated_at();

    create table public.process_templates (id uuid primary key default gen_random_uuid(), nome text);
    create table public.template_etapas (
      id uuid primary key default gen_random_uuid(),
      template_id uuid not null references public.process_templates(id) on delete cascade
    );
    create table public.template_tasks (
      id uuid primary key default gen_random_uuid(),
      template_id uuid not null references public.process_templates(id) on delete cascade,
      etapa_id uuid references public.template_etapas(id) on delete set null
    );
    create table public.template_checklist_items (
      id uuid primary key default gen_random_uuid(),
      template_task_id uuid not null references public.template_tasks(id) on delete cascade
    );

    create function public.increment_process_views(p_id uuid) returns void
      language sql security definer as $$ select $$;
    create function public.apply_process_template(uuid, uuid, date) returns int
      language sql security definer as $$ select 0 $$;
    create function public.apply_template_task(uuid, uuid, date) returns uuid
      language sql security definer as $$ select null::uuid $$;

    create publication supabase_realtime;
    alter publication supabase_realtime add table public.processes;

    insert into public.users (id, nome) values ('00000000-0000-0000-0000-000000000001', 'Admin');
    insert into public.processes (title) values ('POP de atendimento');
    insert into public.process_templates (id, nome) values ('10000000-0000-0000-0000-000000000001', 'Funil');
    insert into public.template_etapas (id, template_id)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
    insert into public.template_tasks (id, template_id, etapa_id)
      values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
              '20000000-0000-0000-0000-000000000001');
    insert into public.template_checklist_items (template_task_id)
      values ('30000000-0000-0000-0000-000000000001');
  `);
  return db;
}

const existe = async (db: PGlite, tabela: string) =>
  (await db.query<{ r: string | null }>(`select to_regclass($1) as r`, [`public.${tabela}`])).rows[0].r !== null;

const funcao = async (db: PGlite, assinatura: string) =>
  (await db.query<{ r: string | null }>(`select to_regprocedure($1)::text as r`, [assinatura])).rows[0].r !== null;

describe("048 — remove a área de Processos", () => {
  it("apaga as 5 tabelas e as 3 funções", async () => {
    const db = await fixture();
    await db.exec(m048);
    for (const t of TABELAS) expect(await existe(db, t), t).toBe(false);
    expect(await funcao(db, "public.increment_process_views(uuid)")).toBe(false);
    expect(await funcao(db, "public.apply_process_template(uuid, uuid, date)")).toBe(false);
    expect(await funcao(db, "public.apply_template_task(uuid, uuid, date)")).toBe(false);
    await db.close();
  });

  it("mantém a set_updated_at, que é compartilhada, funcionando nas outras tabelas", async () => {
    const db = await fixture();
    await db.exec(m048);
    expect(await funcao(db, "public.set_updated_at()")).toBe(true);
    const antes = (await db.query<{ u: Date }>(`select updated_at as u from public.users`)).rows[0].u;
    await new Promise((r) => setTimeout(r, 5));
    await db.exec(`update public.users set nome = 'Admin 2'`);
    const depois = (await db.query<{ u: Date }>(`select updated_at as u from public.users`)).rows[0].u;
    expect(new Date(depois).getTime()).toBeGreaterThan(new Date(antes).getTime());
    await db.close();
  });

  it("tira processes da publicação do realtime", async () => {
    const db = await fixture();
    await db.exec(m048);
    const r = await db.query(
      `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'processes'`
    );
    expect(r.rows).toHaveLength(0);
    await db.close();
  });

  it("não mexe nas tabelas que continuam no sistema", async () => {
    const db = await fixture();
    await db.exec(m048);
    expect(await existe(db, "users")).toBe(true);
    expect(await existe(db, "sectors")).toBe(true);
    await db.close();
  });

  it("com uma dependência não mapeada, falha e não apaga nada", async () => {
    const db = await fixture();
    // Algo que ninguém lembrou: uma view que lê os POPs.
    await db.exec(`create view public.pops_publicados as select id, title from public.processes`);
    await expect(db.exec(m048)).rejects.toThrow();
    await db.exec("rollback");
    for (const t of TABELAS) expect(await existe(db, t), t).toBe(true);
    expect(await funcao(db, "public.increment_process_views(uuid)")).toBe(true);
    const pops = await db.query(`select 1 from public.processes`);
    expect(pops.rows).toHaveLength(1);
    await db.close();
  });

  it("é idempotente", async () => {
    const db = await fixture();
    await db.exec(m048);
    await db.exec(m048);
    for (const t of TABELAS) expect(await existe(db, t), t).toBe(false);
    await db.close();
  });
});
