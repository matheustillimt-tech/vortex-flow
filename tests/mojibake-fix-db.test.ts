import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Reproduz a corrupção real: a 042 e a 043 foram coladas no SQL Editor a partir
 * de um `pbcopy` sem LANG=UTF-8, que converte cada letra acentuada como MacRoman
 * (UTF-8 C3 xx lido byte a byte: "õ" vira "√µ"). Aplica as duas CORROMPIDAS, e
 * depois a 047 seguida da 043 correta — exatamente o procedimento de correção.
 */

const sql = (nome: string) =>
  readFileSync(new URL(`../supabase/migrations/${nome}.sql`, import.meta.url), "utf8");

// Byte C3 é "√" em MacRoman; o segundo byte vira o caractere MacRoman correspondente.
const MACROMAN: Record<string, string> = {
  "á": "√°", "â": "√¢", "ã": "√£", "ç": "√ß", "é": "√©", "ê": "√™",
  "í": "√≠", "ó": "√≥", "ô": "√¥", "õ": "√µ", "ú": "√∫"
};
const corromper = (texto: string) =>
  texto.replace(/[áâãçéêíóôõú]/g, (c) => MACROMAN[c]);

const ADMIN = "00000000-0000-0000-0000-000000000001";
const COLAB = "00000000-0000-0000-0000-000000000002";

async function bancoCorrompido() {
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
  await db.exec(corromper(sql("042_permission_profiles")));
  await db.exec(corromper(sql("043_users_privilege_guard")));
  return db;
}

const funcoesComMarca = async (db: PGlite) =>
  (await db.query<{ proname: string }>(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and position(chr(8730) in p.prosrc) > 0
    order by 1
  `)).rows.map((r) => r.proname);

describe("reprodução da corrupção", () => {
  it("colar a 042 e a 043 corrompidas grava o nome e as mensagens errados", async () => {
    const db = await bancoCorrompido();
    const nomes = (await db.query<{ nome: string }>(
      `select nome from public.permission_profiles order by nome`
    )).rows.map((r) => r.nome);
    expect(nomes).toContain("Sem permiss√µes");
    expect(await funcoesComMarca(db)).toEqual(
      expect.arrayContaining(["prevent_system_profile_delete", "users_privileges_guard"])
    );
    await db.close();
  });
});

describe("047 + 043 reaplicada corrigem", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await bancoCorrompido();
    await db.exec(sql("047_fix_mojibake_042_043"));
    await db.exec(sql("043_users_privilege_guard"));
  });
  afterAll(async () => { await db.close(); });

  it("o perfil volta a se chamar 'Sem permissões', com descrições corretas", async () => {
    const r = await db.query<{ nome: string; descricao: string }>(
      `select nome, descricao from public.permission_profiles where is_system order by full_access`
    );
    expect(r.rows[0].nome).toBe("Sem permissões");
    expect(r.rows[1].descricao).toBe("Acesso irrestrito a todos os menus, abas e ações.");
  });

  it("nenhum perfil nem função segue com a marca da corrupção", async () => {
    const perfis = await db.query<{ n: number }>(`
      select count(*)::int as n from public.permission_profiles
      where position(chr(8730) in nome) > 0 or position(chr(8730) in coalesce(descricao, '')) > 0
    `);
    expect(perfis.rows[0].n).toBe(0);
    expect(await funcoesComMarca(db)).toEqual([]);
  });

  it("quem já estava no perfil continua nele depois da renomeação", async () => {
    const r = await db.query<{ nome: string }>(`
      select p.nome from public.users u
      join public.permission_profiles p on p.id = u.permission_profile_id
      where u.id = '${COLAB}'
    `);
    expect(r.rows[0].nome).toBe("Sem permissões");
  });

  it("gente nova volta a receber 'Sem permissões' (a busca por nome da 043 casa de novo)", async () => {
    const novo = "00000000-0000-0000-0000-0000000000aa";
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec(`insert into public.users (id, nome, role) values ('${novo}', 'Novo', 'colaborador')`);
    const r = await db.query<{ nome: string }>(`
      select p.nome from public.users u
      join public.permission_profiles p on p.id = u.permission_profile_id
      where u.id = '${novo}'
    `);
    expect(r.rows[0]?.nome).toBe("Sem permissões");
  });

  it("as mensagens de erro saem com acento correto", async () => {
    await expect(
      db.exec(`delete from public.permission_profiles where nome = 'Super Admin'`)
    ).rejects.toThrow("Perfis de sistema não podem ser excluídos.");
    await db.exec("rollback").catch(() => {});
    await expect(
      db.query(`update public.users set ativo = false where id = '${ADMIN}'`)
    ).rejects.toThrow("Não é possível remover o último Super Admin ativo.");
  });

  it("a 047 é idempotente", async () => {
    await db.exec(sql("047_fix_mojibake_042_043"));
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.permission_profiles where nome = 'Sem permissões'`
    );
    expect(r.rows[0].n).toBe(1);
  });
});
