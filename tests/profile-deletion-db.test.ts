import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (nome: string) =>
  readFileSync(new URL(`../supabase/migrations/${nome}.sql`, import.meta.url), "utf8");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const COLAB = "00000000-0000-0000-0000-000000000002";

/** Banco com 042, 043 e 049: a pessoa comum já foi movida para um perfil criado na tela. */
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
      ('${ADMIN}', 'Admin', 'admin'), ('${COLAB}', 'Colab', 'colaborador');
  `);
  await db.exec(sql("042_permission_profiles"));
  await db.exec(sql("043_users_privilege_guard"));
  await db.exec(sql("049_allow_deleting_system_profiles"));
  await db.exec(`
    insert into public.permission_profiles (nome) values ('Suporte');
    update public.users set permission_profile_id =
      (select id from public.permission_profiles where nome = 'Suporte')
    where id = '${COLAB}';
  `);
  return db;
}

const perfis = async (db: PGlite) =>
  (await db.query<{ nome: string }>(`select nome from public.permission_profiles order by nome`))
    .rows.map((r) => r.nome);

describe("049 — qualquer perfil pode ser excluído, menos o de acesso total", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("'Sem permissões', vazio, agora pode ser excluído", async () => {
    await db.exec(`delete from public.permission_profiles where nome = 'Sem permissões'`);
    expect(await perfis(db)).toEqual(["Super Admin", "Suporte"]);
  });

  it("o perfil de acesso total segue protegido", async () => {
    await expect(
      db.exec(`delete from public.permission_profiles where nome = 'Super Admin'`)
    ).rejects.toThrow("O perfil de acesso total não pode ser excluído");
    await db.exec("rollback").catch(() => {});
    expect(await perfis(db)).toContain("Super Admin");
  });

  it("perfil em uso não pode ser excluído (as pessoas precisam ser movidas antes)", async () => {
    await expect(
      db.exec(`delete from public.permission_profiles where nome = 'Suporte'`)
    ).rejects.toThrow();
    await db.exec("rollback").catch(() => {});
    expect(await perfis(db)).toContain("Suporte");
  });

  it("sem 'Sem permissões', gente nova entra sem perfil — e sem erro", async () => {
    const novo = "00000000-0000-0000-0000-0000000000aa";
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec(`insert into public.users (id, nome, role) values ('${novo}', 'Novo', 'colaborador')`);
    const r = await db.query<{ permission_profile_id: string | null; role: string }>(
      `select permission_profile_id, role::text from public.users where id = '${novo}'`
    );
    expect(r.rows[0]).toEqual({ permission_profile_id: null, role: "colaborador" });
  });

  it("perfil criado na tela, quando vazio, continua excluível", async () => {
    await db.exec(`insert into public.permission_profiles (nome) values ('Temporário')`);
    await db.exec(`delete from public.permission_profiles where nome = 'Temporário'`);
    expect(await perfis(db)).not.toContain("Temporário");
  });

  it("é idempotente", async () => {
    await db.exec(sql("049_allow_deleting_system_profiles"));
    await expect(
      db.exec(`delete from public.permission_profiles where nome = 'Super Admin'`)
    ).rejects.toThrow("O perfil de acesso total não pode ser excluído");
  });
});
