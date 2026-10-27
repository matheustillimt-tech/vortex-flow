import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/042_permission_profiles.sql", import.meta.url),
  "utf8"
);

const admin = "00000000-0000-0000-0000-000000000001";
const gestor = "00000000-0000-0000-0000-000000000002";
const colaborador = "00000000-0000-0000-0000-000000000003";
const inativo = "00000000-0000-0000-0000-000000000004";

/** Reproduz só o que a 042 encosta: users, o enum, e as duas funções da RLS. */
async function base(seed: string) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('admin', 'gestor', 'colaborador');
    create table public.users (
      id uuid primary key,
      nome text not null,
      role public.user_role not null,
      ativo boolean not null default true,
      updated_at timestamptz not null default now()
    );
    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;
    create function public.is_admin(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role = 'admin' and ativo) $$;
    create function public.is_admin_or_gestor(uid uuid) returns boolean language sql stable security definer as
      $$ select exists(select 1 from public.users where id = uid and role in ('admin','gestor') and ativo) $$;
    ${seed}
  `);
  return db;
}

const equipeCompleta = `
  insert into public.users (id, nome, role, ativo) values
    ('${admin}', 'Admin', 'admin', true),
    ('${gestor}', 'Gestor', 'gestor', true),
    ('${colaborador}', 'Colab', 'colaborador', true),
    ('${inativo}', 'Inativo', 'admin', false);
`;

async function migrated(seed = equipeCompleta) {
  const db = await base(seed);
  await db.exec(migration);
  return db;
}

const one = async (db: PGlite, sql: string) =>
  (await db.query<Record<string, unknown>>(sql)).rows[0];

describe("042 — perfis de permissão", () => {
  describe("backfill", () => {
    it("admin vira Super Admin; todo o resto entra em branco", async () => {
      const db = await migrated();
      const { rows } = await db.query<{ nome: string; perfil: string }>(`
        select u.nome, p.nome as perfil
        from public.users u join public.permission_profiles p
          on p.id = u.permission_profile_id
        order by u.nome
      `);
      expect(rows).toEqual([
        { nome: "Admin", perfil: "Super Admin" },
        { nome: "Colab", perfil: "Sem permissões" },
        // Gestor não tem mais perfil próprio: entra em branco como os demais.
        { nome: "Gestor", perfil: "Sem permissões" },
        { nome: "Inativo", perfil: "Super Admin" }
      ]);
      await db.close();
    });

    it("não deixa nenhum usuário ativo sem perfil", async () => {
      const db = await migrated();
      const r = await one(
        db,
        `select count(*)::int as n from public.users
         where ativo and permission_profile_id is null`
      );
      expect(r.n).toBe(0);
      await db.close();
    });
  });

  describe("trava de segurança", () => {
    it("aborta se ninguém ativo ficaria com acesso total", async () => {
      const db = await base(`
        insert into public.users (id, nome, role, ativo) values
          ('${colaborador}', 'Colab', 'colaborador', true),
          ('${inativo}', 'Ex-admin', 'admin', false);
      `);
      await expect(db.exec(migration)).rejects.toThrow(
        /nenhum usuário ativo ficaria com acesso total/i
      );
      // A exceção deixa a transação em estado abortado — encerra antes de olhar.
      await db.exec("rollback");
      // Abortou de verdade: nada da migration sobreviveu.
      const r = await one(
        db,
        `select count(*)::int as n from information_schema.tables
         where table_schema='public' and table_name='permission_profiles'`
      );
      expect(r.n).toBe(0);
      // E a coluna nova também não ficou pela metade.
      const c = await one(
        db,
        `select count(*)::int as n from information_schema.columns
         where table_schema='public' and table_name='users'
           and column_name='permission_profile_id'`
      );
      expect(c.n).toBe(0);
      await db.close();
    });
  });

  describe("o perfil passa a mandar no lugar do enum", () => {
    it("is_admin segue full_access, não mais role='admin'", async () => {
      const db = await migrated();
      // O enum continua dizendo 'admin'...
      const antes = await one(db, `select public.is_admin('${admin}') as v`);
      expect(antes.v).toBe(true);

      // ...mas trocar só o PERFIL tira o acesso, sem tocar em role.
      await db.exec(`
        update public.users set permission_profile_id =
          (select id from public.permission_profiles where nome = 'Sem permissões')
        where id = '${admin}';
      `);
      const depois = await one(
        db,
        `select public.is_admin('${admin}') as v, (select role::text from public.users where id='${admin}') as role`
      );
      expect(depois.role).toBe("admin");
      expect(depois.v).toBe(false);
      await db.close();
    });

    it("promover pelo perfil concede acesso total sem mexer no enum", async () => {
      const db = await migrated();
      await db.exec(`
        update public.users set permission_profile_id =
          (select id from public.permission_profiles where nome = 'Super Admin')
        where id = '${colaborador}';
      `);
      const r = await one(
        db,
        `select public.is_admin('${colaborador}') as v,
                (select role::text from public.users where id='${colaborador}') as role`
      );
      expect(r.role).toBe("colaborador");
      expect(r.v).toBe(true);
      await db.close();
    });

    it("is_admin_or_gestor honra can_manage, não mais o enum", async () => {
      const db = await migrated();
      // Quem era 'gestor' entra em branco e PERDE o poder de gestão — efeito
      // esperado de semear todo mundo sem atribuição.
      const r = await one(db, `
        select public.is_admin_or_gestor('${admin}') as a,
               public.is_admin_or_gestor('${gestor}') as g,
               public.is_admin_or_gestor('${colaborador}') as c
      `);
      expect(r).toEqual({ a: true, g: false, c: false });

      // E volta assim que um perfil com can_manage for atribuído.
      await db.exec(`
        insert into public.permission_profiles (nome, can_manage) values ('Gestão', true);
        update public.users set permission_profile_id =
          (select id from public.permission_profiles where nome = 'Gestão')
        where id = '${gestor}';
      `);
      const depois = await one(
        db,
        `select public.is_admin_or_gestor('${gestor}') as g`
      );
      expect(depois.g).toBe(true);
      await db.close();
    });

    it("usuário inativo não tem acesso, mesmo com perfil total", async () => {
      const db = await migrated();
      const r = await one(db, `
        select public.is_admin('${inativo}') as a,
               public.has_permission('${inativo}', 'dashboard', 'view') as h
      `);
      expect(r).toEqual({ a: false, h: false });
      await db.close();
    });
  });

  describe("has_permission", () => {
    it("full_access responde por qualquer recurso, inclusive inexistente", async () => {
      const db = await migrated();
      const r = await one(db, `
        select public.has_permission('${admin}', 'configuracoes.time', 'delete') as a,
               public.has_permission('${admin}', 'coisa-que-nao-existe', 'edit') as b
      `);
      expect(r).toEqual({ a: true, b: true });
      await db.close();
    });

    it("quem entra em branco não alcança nada", async () => {
      const db = await migrated();
      const r = await one(db, `
        select public.has_permission('${colaborador}', 'dashboard', 'view') as dash,
               public.has_permission('${colaborador}', 'tarefas', 'view') as tarefas,
               public.has_permission('${colaborador}', 'configuracoes.time', 'view') as time_tab
      `);
      expect(r).toEqual({ dash: false, tarefas: false, time_tab: false });
      await db.close();
    });

    it("concessão avulsa passa a valer só para o recurso e a ação concedidos", async () => {
      const db = await migrated();
      await db.exec(`
        insert into public.permission_profiles (nome) values ('Suporte');
        insert into public.permission_grants (profile_id, resource, action)
        select id, 'chat', 'view' from public.permission_profiles where nome = 'Suporte';
        update public.users set permission_profile_id =
          (select id from public.permission_profiles where nome = 'Suporte')
        where id = '${colaborador}';
      `);
      const r = await one(db, `
        select public.has_permission('${colaborador}', 'chat', 'view') as ver_chat,
               public.has_permission('${colaborador}', 'chat', 'edit') as editar_chat,
               public.has_permission('${colaborador}', 'tarefas', 'view') as ver_tarefas
      `);
      expect(r).toEqual({ ver_chat: true, editar_chat: false, ver_tarefas: false });
      await db.close();
    });

    it("desconhece usuário sem perfil", async () => {
      const db = await migrated();
      const semPerfil = "00000000-0000-0000-0000-0000000000ff";
      await db.exec(
        `insert into public.users (id, nome, role, ativo)
         values ('${semPerfil}', 'Sem perfil', 'colaborador', true);`
      );
      const r = await one(
        db,
        `select public.has_permission('${semPerfil}', 'dashboard', 'view') as v`
      );
      expect(r.v).toBe(false);
      await db.close();
    });
  });

  describe("integridade dos perfis", () => {
    it("perfil de sistema não pode ser excluído", async () => {
      const db = await migrated();
      await expect(
        db.exec(`delete from public.permission_profiles where nome = 'Super Admin';`)
      ).rejects.toThrow(/sistema não podem ser excluídos/i);
      await db.close();
    });

    it("perfil personalizado pode ser excluído quando ninguém o usa", async () => {
      const db = await migrated();
      await db.exec(`
        insert into public.permission_profiles (nome, descricao) values ('Suporte', 'Teste');
      `);
      await db.exec(`delete from public.permission_profiles where nome = 'Suporte';`);
      const r = await one(
        db,
        `select count(*)::int as n from public.permission_profiles where nome = 'Suporte'`
      );
      expect(r.n).toBe(0);
      await db.close();
    });

    it("perfil em uso não pode ser excluído (on delete restrict)", async () => {
      const db = await migrated();
      await db.exec(`
        insert into public.permission_profiles (nome) values ('Suporte');
        update public.users set permission_profile_id =
          (select id from public.permission_profiles where nome = 'Suporte')
        where id = '${colaborador}';
      `);
      await expect(
        db.exec(`delete from public.permission_profiles where nome = 'Suporte';`)
      ).rejects.toThrow();
      await db.close();
    });

    it("excluir o perfil leva junto suas concessões", async () => {
      const db = await migrated();
      await db.exec(`
        insert into public.permission_profiles (nome) values ('Suporte');
        insert into public.permission_grants (profile_id, resource, action)
        select id, 'chat', 'view' from public.permission_profiles where nome = 'Suporte';
        delete from public.permission_profiles where nome = 'Suporte';
      `);
      const r = await one(
        db,
        `select count(*)::int as n from public.permission_grants where resource = 'chat'
         and profile_id not in (select id from public.permission_profiles)`
      );
      expect(r.n).toBe(0);
      await db.close();
    });

    it("rejeita ação fora do vocabulário", async () => {
      const db = await migrated();
      await expect(
        db.exec(`
          insert into public.permission_grants (profile_id, resource, action)
          select id, 'chat', 'inventar' from public.permission_profiles where nome = 'Sem permissões';
        `)
      ).rejects.toThrow();
      await db.close();
    });
  });

  it("é idempotente: rodar duas vezes não duplica nem quebra", async () => {
    const db = await migrated();
    await db.exec(migration);
    const r = await one(
      db,
      `select count(*)::int as n from public.permission_profiles`
    );
    expect(r.n).toBe(2);
    await db.close();
  });
});
