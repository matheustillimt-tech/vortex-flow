import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const sql = (name: string) =>
  readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const m042 = sql("042_permission_profiles");
const m043 = sql("043_users_privilege_guard");

const admin = "00000000-0000-0000-0000-000000000001";
const colab = "00000000-0000-0000-0000-000000000003";
const outro = "00000000-0000-0000-0000-000000000005";

async function fixture() {
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
    insert into public.users (id, nome, role, ativo) values
      ('${admin}', 'Admin', 'admin', true),
      ('${colab}', 'Colab', 'colaborador', true),
      ('${outro}', 'Outro', 'colaborador', true);
  `);
  await db.exec(m042);
  await db.exec(m043);
  // Um perfil personalizado e um com gestão, como os que serão criados na tela.
  await db.exec(`
    insert into public.permission_profiles (nome) values ('Suporte');
    insert into public.permission_profiles (nome, can_manage) values ('Gestão', true);
  `);
  return db;
}

/** Simula a sessão de alguém (null = service-role / SQL Editor). */
const como = (db: PGlite, uid: string | null) =>
  db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);

const perfilId = async (db: PGlite, nome: string) =>
  (await db.query<{ id: string }>(
    `select id from public.permission_profiles where nome = $1`, [nome]
  )).rows[0].id;

const linha = async (db: PGlite, id: string) =>
  (await db.query<{ role: string; perfil: string; ativo: boolean }>(`
    select u.role::text as role, p.nome as perfil, u.ativo
    from public.users u join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = $1`, [id])).rows[0];

describe("043 — escalada de privilégio fechada", () => {
  it("colaborador não se promove a Super Admin pelo perfil", async () => {
    const db = await fixture();
    const sa = await perfilId(db, "Super Admin");
    await como(db, colab);
    await expect(
      db.query(`update public.users set permission_profile_id = $1 where id = $2`, [sa, colab])
    ).rejects.toThrow(/Apenas administradores/);
    await como(db, null);
    expect((await linha(db, colab)).perfil).toBe("Sem permissões");
    await db.close();
  });

  it("colaborador não se promove pelo role legado", async () => {
    const db = await fixture();
    await como(db, colab);
    await expect(
      db.query(`update public.users set role = 'admin' where id = $1`, [colab])
    ).rejects.toThrow(/Apenas administradores/);
    await db.close();
  });

  it("colaborador não altera o próprio status de acesso", async () => {
    const db = await fixture();
    await como(db, colab);
    await expect(
      db.query(`update public.users set ativo = false where id = $1`, [colab])
    ).rejects.toThrow(/Apenas administradores/);
    await db.close();
  });

  it("colaborador segue podendo editar campos comuns da própria linha", async () => {
    const db = await fixture();
    await como(db, colab);
    await db.query(`update public.users set nome = 'Novo nome' where id = $1`, [colab]);
    await como(db, null);
    const r = await db.query<{ nome: string }>(
      `select nome from public.users where id = $1`, [colab]
    );
    expect(r.rows[0].nome).toBe("Novo nome");
    await db.close();
  });
});

describe("043 — atribuição e derivação do role", () => {
  it("admin atribui perfil a outra pessoa e o role acompanha", async () => {
    const db = await fixture();
    await como(db, admin);
    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Suporte"), colab]);
    expect(await linha(db, colab)).toMatchObject({ perfil: "Suporte", role: "colaborador" });

    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Gestão"), colab]);
    expect((await linha(db, colab)).role).toBe("gestor");

    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Super Admin"), colab]);
    expect((await linha(db, colab)).role).toBe("admin");
    await db.close();
  });

  it("o servidor (sem sessão) também atribui", async () => {
    const db = await fixture();
    await como(db, null);
    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Suporte"), colab]);
    expect((await linha(db, colab)).perfil).toBe("Suporte");
    await db.close();
  });

  it("gravar role direto não burla a derivação", async () => {
    const db = await fixture();
    await como(db, admin);
    // Tenta dizer 'admin' mantendo um perfil sem acesso total explícito:
    // o legado mapeia para Super Admin, e o role reflete o perfil.
    await db.query(`update public.users set role = 'admin' where id = $1`, [colab]);
    expect(await linha(db, colab)).toMatchObject({ perfil: "Super Admin", role: "admin" });
    await db.close();
  });

  it("quem nasce sem perfil recebe o equivalente ao role", async () => {
    const db = await fixture();
    const novo = "00000000-0000-0000-0000-0000000000aa";
    const novoAdmin = "00000000-0000-0000-0000-0000000000ab";
    await como(db, null);
    await db.query(`insert into public.users (id, nome, role) values ($1, 'Novo', 'colaborador'),
      ($2, 'Novo admin', 'admin')`, [novo, novoAdmin]);
    expect((await linha(db, novo)).perfil).toBe("Sem permissões");
    expect((await linha(db, novoAdmin)).perfil).toBe("Super Admin");
    await db.close();
  });

  it("mudar a capacidade de um perfil atualiza o role de quem o usa", async () => {
    const db = await fixture();
    await como(db, admin);
    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Suporte"), colab]);
    expect((await linha(db, colab)).role).toBe("colaborador");
    await db.query(`update public.permission_profiles set can_manage = true where nome = 'Suporte'`);
    expect((await linha(db, colab)).role).toBe("gestor");
    await db.close();
  });
});

describe("043 — sempre sobra um Super Admin", () => {
  it("não rebaixa o último Super Admin", async () => {
    const db = await fixture();
    await como(db, null);
    await expect(
      db.query(`update public.users set permission_profile_id = $1 where id = $2`,
        [await perfilId(db, "Suporte"), admin])
    ).rejects.toThrow(/último Super Admin/);
    await db.close();
  });

  it("não desativa o último Super Admin", async () => {
    const db = await fixture();
    await como(db, null);
    await expect(
      db.query(`update public.users set ativo = false where id = $1`, [admin])
    ).rejects.toThrow(/último Super Admin/);
    await db.close();
  });

  it("não exclui o último Super Admin", async () => {
    const db = await fixture();
    await como(db, null);
    await expect(
      db.query(`delete from public.users where id = $1`, [admin])
    ).rejects.toThrow(/último Super Admin/);
    await db.close();
  });

  it("com dois Super Admins, um pode ser rebaixado", async () => {
    const db = await fixture();
    await como(db, null);
    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Super Admin"), outro]);
    await db.query(`update public.users set permission_profile_id = $1 where id = $2`,
      [await perfilId(db, "Suporte"), admin]);
    expect(await linha(db, admin)).toMatchObject({ perfil: "Suporte", role: "colaborador" });
    await db.close();
  });
});

it("043 é idempotente", async () => {
  const db = await fixture();
  await db.exec(m043);
  expect((await linha(db, admin)).perfil).toBe("Super Admin");
  await db.close();
});
