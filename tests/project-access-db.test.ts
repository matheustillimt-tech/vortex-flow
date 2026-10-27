import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const oldMigration = migration("015_project_members");
const fix = migration("040_project_access_atomic");
const guards = migration("041_project_access_legacy_policies");
const admin = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const manager = "00000000-0000-0000-0000-000000000003";
const p1 = "10000000-0000-0000-0000-000000000001";
const p2 = "10000000-0000-0000-0000-000000000002";
const missing = "10000000-0000-0000-0000-000000000099";

async function fixture(legacy: boolean) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create type public.user_role as enum ('admin', 'gestor', 'colaborador');
    create table public.users (id uuid primary key, role public.user_role not null, ativo boolean default true);
    create table public.projects (id uuid primary key);
    create function public.is_admin(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role = 'admin' and ativo) $$;
    create function public.is_admin_or_gestor(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role in ('admin', 'gestor') and ativo) $$;
    create table public.tasks (id uuid primary key, project_id uuid references public.projects);
    create table public.maps (id uuid primary key, project_id uuid references public.projects);
    create table public.nodes (id uuid primary key, map_id uuid references public.maps);
    create table public.edges (id uuid primary key, map_id uuid references public.maps);
    create table public.funnels (id uuid primary key, project_id uuid references public.projects);
    create table public.products (id uuid primary key, project_id uuid references public.projects);
    create publication supabase_realtime;
    insert into public.users values ('${admin}', 'admin', true), ('${member}', 'colaborador', true), ('${manager}', 'gestor', true);
    insert into public.projects values ('${p1}'), ('${p2}');
  `);
  if (legacy) {
    // Definição histórica de schema.sql, anterior à 015.
    await db.exec(`create table public.project_members (
      project_id uuid not null references public.projects(id) on delete cascade,
      user_id uuid not null references public.users(id) on delete cascade,
      created_at timestamptz not null default now(), primary key (project_id, user_id));
      create policy project_members_write on public.project_members for all
        using (public.is_admin_or_gestor(auth.uid())) with check (public.is_admin_or_gestor(auth.uid()));
      insert into public.project_members values ('${p1}', '${member}', '2026-01-01T00:00:00Z');`);
  }
  await db.exec(oldMigration);
  // Policies abertas deixadas pelo schema original coexistem com a 015.
  for (const table of ["projects", "tasks", "maps", "nodes", "edges", "funnels", "products"]) {
    await db.exec(`create policy legacy_open on public.${table} for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');`);
  }
  await db.exec(`grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated;`);
  return db;
}

async function actor(db: PGlite, id: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function setAccess(db: PGlite, ids: string[] | null, target = member) {
  return (await db.query<{ result: { ok: boolean; count: number; restricted: boolean } }>(
    "select public.set_user_project_access($1::uuid, $2::uuid[]) as result", [target, ids]
  )).rows[0].result;
}
async function rows(db: PGlite) {
  return (await db.query<{ project_id: string; user_id: string; granted_by: string | null; granted_at: string | Date }>(
    "select * from public.project_members where user_id = $1 order by project_id", [member]
  )).rows;
}

describe("Regressão do schema original", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(true); });
  afterAll(async () => { await db.close(); });

  it("reproduz coluna ausente após executar a migração 015", async () => {
    await expect(db.exec(`insert into public.project_members(project_id,user_id,granted_by)
      values ('${p2}', '${member}', '${admin}')`)).rejects.toMatchObject({ code: "42703" });
  });

  it("reproduz perda da restrição no salvamento antigo em duas operações", async () => {
    await db.exec(`delete from public.project_members where user_id = '${member}'`);
    await expect(db.exec(`insert into public.project_members(project_id,user_id,granted_by)
      values ('${p2}', '${member}', '${admin}')`)).rejects.toMatchObject({ code: "42703" });
    expect((await db.query<{ allowed: boolean }>(`select public.user_can_see_project('${member}', '${p2}') as allowed`)).rows[0].allowed).toBe(true);
    await db.exec(`insert into public.project_members values ('${p1}', '${member}', '2026-01-01T00:00:00Z')`);
  });

  it("reproduz policies antigas anulando a restrição de leitura", async () => {
    await actor(db, member);
    await db.exec("set role authenticated");
    expect((await db.query("select * from public.projects")).rows).toHaveLength(2);
    await db.exec("reset role");
  });

  it("corrige sem perder acessos históricos e pode ser reaplicada", async () => {
    await db.exec(fix); await db.exec(fix);
    const permissions = await rows(db);
    expect(permissions).toHaveLength(1);
    expect(permissions[0].granted_by).toBeNull();
    expect(new Date(permissions[0].granted_at as string).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    await actor(db, admin);
    expect(await setAccess(db, [p1, p2])).toEqual({ ok: true, restricted: true, count: 2 });
  });
});

describe.each([true, false])("Correção transacional (schema legado: %s)", (legacy) => {
  let db: PGlite;
  beforeAll(async () => {
    db = await fixture(legacy);
    await db.exec(fix); await db.exec(guards); await db.exec(guards);
    await actor(db, admin);
  });
  afterAll(async () => { await db.close(); });

  it("registra admin e data, elimina IDs duplicados e mantém auditoria nas repetições", async () => {
    await setAccess(db, [p2, p2]);
    const before = await rows(db);
    expect(before).toHaveLength(1);
    expect(before[0].granted_by).toBe(admin);
    expect(before[0].granted_at).toBeTruthy();
    await setAccess(db, [p2]);
    expect(await rows(db)).toEqual(before);
  });

  it("falhas de projeto, membro, lista nula e restrição de admin preservam dados", async () => {
    const before = await rows(db);
    await expect(setAccess(db, [missing])).rejects.toMatchObject({ code: "22023" });
    await expect(setAccess(db, null)).rejects.toMatchObject({ code: "22023" });
    await expect(setAccess(db, [p1], missing)).rejects.toMatchObject({ code: "22023" });
    await expect(setAccess(db, [p1], admin)).rejects.toMatchObject({ code: "22023" });
    expect(await rows(db)).toEqual(before);
  });

  it("reverte também falha tardia de exclusão após inserir novo acesso", async () => {
    const before = await rows(db);
    await db.exec(`create function public.test_reject_delete() returns trigger language plpgsql as $$
      begin raise exception 'falha simulada'; end $$;
      create trigger test_failure before delete on public.project_members
        for each row execute function public.test_reject_delete();`);
    await expect(setAccess(db, [p1])).rejects.toThrow("falha simulada");
    expect(await rows(db)).toEqual(before);
    await db.exec("drop trigger test_failure on public.project_members");
  });

  it("bloqueia chamada por colaborador, gestor e sessão ausente", async () => {
    const before = await rows(db);
    for (const id of [member, manager, ""]) {
      await actor(db, id);
      await db.exec("set role authenticated");
      await expect(setAccess(db, [])).rejects.toMatchObject({ code: "42501" });
      await db.exec("reset role");
    }
    await actor(db, admin);
    expect(await rows(db)).toEqual(before);
  });

  it("gestor não pode apagar restrições pela policy legada", async () => {
    await setAccess(db, [p1]);
    const before = await rows(db);
    await actor(db, manager); await db.exec("set role authenticated");
    await db.exec(`delete from public.project_members where user_id = '${member}'`);
    await db.exec("reset role"); await actor(db, admin);
    expect(await rows(db)).toEqual(before);
  });

  it("RLS restringe projeto e conteúdo associado apesar de policies permissivas antigas", async () => {
    await setAccess(db, [p1]);
    for (const table of ["tasks", "maps", "funnels", "products"]) {
      await db.exec(`insert into public.${table} values ('${p1}', '${p1}'), ('${p2}', '${p2}')`);
    }
    for (const table of ["nodes", "edges"]) {
      await db.exec(`insert into public.${table} values ('${p1}', '${p1}'), ('${p2}', '${p2}')`);
    }
    for (const id of [member, admin]) {
      await actor(db, id); await db.exec("set role authenticated");
      for (const table of ["projects", "tasks", "maps", "nodes", "edges", "funnels", "products"]) {
        expect((await db.query(`select id from public.${table} order by id`)).rows).toHaveLength(id === admin ? 2 : 1);
      }
      await db.exec("reset role");
    }
  });

  it("lista vazia explícita libera todos e a função é executável pela sessão admin", async () => {
    await actor(db, admin); await db.exec("set role authenticated");
    expect(await setAccess(db, [])).toEqual({ ok: true, restricted: false, count: 0 });
    await db.exec("reset role");
    expect(await rows(db)).toHaveLength(0);
    await actor(db, member); await db.exec("set role authenticated");
    expect((await db.query("select * from public.projects")).rows).toHaveLength(2);
    await db.exec("reset role");
  });
});
