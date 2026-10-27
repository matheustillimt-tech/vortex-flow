import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = (nome: string) =>
  readFileSync(new URL(`../supabase/migrations/${nome}.sql`, import.meta.url), "utf8");
const m042 = sql("042_permission_profiles");
const m043 = sql("043_users_privilege_guard");
const m046 = sql("046_colaboradores_chat_follow_permissions");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const FIN = "00000000-0000-0000-0000-000000000002";
const VE = "00000000-0000-0000-0000-000000000003";
const COLEGA = "00000000-0000-0000-0000-000000000004";
const CONVERSA = "00000000-0000-0000-0000-000000000005";
const NADA = "00000000-0000-0000-0000-000000000006";
const CANAL = "50000000-0000-0000-0000-000000000001";

/** Banco com 042 e 043 aplicadas e as políticas de produção de 037 e 002. */
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
      ('${ADMIN}', 'Admin', 'admin'), ('${FIN}', 'Fin', 'colaborador'),
      ('${VE}', 'Ve', 'colaborador'), ('${COLEGA}', 'Colega', 'colaborador'),
      ('${CONVERSA}', 'Conversa', 'colaborador'), ('${NADA}', 'Nada', 'colaborador');
  `);
  await db.exec(m042);
  await db.exec(m043);
  await db.exec(`
    insert into public.permission_profiles (nome, can_manage) values
      ('Financeiro', false), ('SoVe', false), ('Chat', false), ('Legado', true);
    insert into public.permission_grants (profile_id, resource, action)
      select id, 'colaboradores', a from public.permission_profiles, unnest(array['view','create','edit','delete']) a
        where nome = 'Financeiro'
      union all select id, 'colaboradores', 'view' from public.permission_profiles where nome = 'SoVe'
      union all select id, 'chat', 'view' from public.permission_profiles where nome = 'Chat';
    update public.users set permission_profile_id = (select id from public.permission_profiles where nome = 'Financeiro') where id = '${FIN}';
    update public.users set permission_profile_id = (select id from public.permission_profiles where nome = 'SoVe') where id = '${VE}';
    update public.users set permission_profile_id = (select id from public.permission_profiles where nome = 'Chat') where id = '${CONVERSA}';
    update public.users set permission_profile_id = (select id from public.permission_profiles where nome = 'Legado') where id = '${COLEGA}';

    create table public.colaborador_dados (
      user_id uuid primary key references public.users(id) on delete cascade, chave_pix text
    );
    alter table public.colaborador_dados enable row level security;
    create policy "colaborador_dados_select_own_or_admin" on public.colaborador_dados
      for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
    create policy "colaborador_dados_insert_own_or_admin" on public.colaborador_dados
      for insert with check (user_id = auth.uid() or public.is_admin(auth.uid()));
    create policy "colaborador_dados_update_own_or_admin" on public.colaborador_dados
      for update using (user_id = auth.uid() or public.is_admin(auth.uid()))
      with check (user_id = auth.uid() or public.is_admin(auth.uid()));
    create policy "colaborador_dados_delete_admin" on public.colaborador_dados
      for delete using (public.is_admin(auth.uid()));

    alter table public.users enable row level security;
    create policy "users_select" on public.users for select using (true);
    create policy "users_update_self" on public.users for update using (auth.uid() = id);
    create policy "users_admin_all" on public.users for all
      using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

    create table public.chat_channels (id uuid primary key default gen_random_uuid(), kind text not null);
    create table public.chat_channel_members (
      channel_id uuid references public.chat_channels on delete cascade, user_id uuid,
      primary key (channel_id, user_id)
    );
    create table public.chat_messages (
      id uuid primary key default gen_random_uuid(),
      channel_id uuid references public.chat_channels on delete cascade, user_id uuid, content text
    );
    alter table public.chat_channels enable row level security;
    alter table public.chat_channel_members enable row level security;
    alter table public.chat_messages enable row level security;
    create policy "chat_channels_select" on public.chat_channels for select using (true);
    create policy "chat_channels_write" on public.chat_channels for all using (true) with check (true);
    create policy "chat_channel_members_all" on public.chat_channel_members for all using (true) with check (true);
    create policy "chat_messages_select" on public.chat_messages for select using (true);
    create policy "chat_messages_insert" on public.chat_messages for insert with check (user_id = auth.uid());
    create policy "chat_messages_update_own" on public.chat_messages for update
      using (user_id = auth.uid()) with check (user_id = auth.uid());
    create policy "chat_messages_delete_own" on public.chat_messages for delete
      using (user_id = auth.uid() or public.is_admin(auth.uid()));

    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;

    insert into public.colaborador_dados values ('${COLEGA}', 'pix-colega'), ('${ADMIN}', 'pix-admin');
    insert into public.chat_channels (id, kind) values ('${CANAL}', 'company');
    insert into public.chat_messages (channel_id, user_id, content) values ('${CANAL}', '${CONVERSA}', 'bom dia');
  `);
  await db.exec(m046);
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

const pix = async (db: PGlite, uid: string) =>
  (await db.query<{ chave_pix: string }>(
    `select chave_pix from public.colaborador_dados where user_id = $1`, [uid]
  )).rows[0]?.chave_pix;

describe("046 — caixa 'gerir conteúdo' neutralizada", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("perfis sem acesso total perdem can_manage; o role de quem os usa acompanha", async () => {
    const r = await db.query<{ nome: string; can_manage: boolean }>(
      `select nome, can_manage from public.permission_profiles where nome in ('Legado', 'Super Admin') order by nome`
    );
    expect(r.rows).toEqual([
      { nome: "Legado", can_manage: false },
      { nome: "Super Admin", can_manage: true }
    ]);
    const role = await db.query<{ role: string }>(`select role::text from public.users where id = '${COLEGA}'`);
    expect(role.rows[0].role).toBe("colaborador");
  });
});

describe("046 — colaboradores seguem o perfil", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("o dono segue lendo e gravando o próprio cadastro, sem permissão nenhuma", async () => {
    await como(db, NADA, async () => {
      await db.exec(`insert into public.colaborador_dados values ('${NADA}', 'pix-nada')`);
      await db.exec(`update public.colaborador_dados set chave_pix = 'pix-nada-2' where user_id = '${NADA}'`);
      const r = await db.query(`select 1 from public.colaborador_dados where user_id = '${NADA}'`);
      expect(r.rows).toHaveLength(1);
    });
    expect(await pix(db, NADA)).toBe("pix-nada-2");
  });

  it("sem Ver, não lê o cadastro dos outros", async () => {
    const r = await como(db, NADA, () =>
      db.query(`select 1 from public.colaborador_dados where user_id <> '${NADA}'`)
    );
    expect(r.rows).toHaveLength(0);
  });

  it("Ver lê o de todos, inclusive de quem tem acesso total, mas não altera", async () => {
    const r = await como(db, VE, () =>
      db.query(`select user_id from public.colaborador_dados where user_id in ('${COLEGA}', '${ADMIN}')`)
    );
    expect(r.rows).toHaveLength(2);
    await como(db, VE, () =>
      db.exec(`update public.colaborador_dados set chave_pix = 'fraude' where user_id = '${COLEGA}'`)
    );
    expect(await pix(db, COLEGA)).toBe("pix-colega");
  });

  it("Editar altera o cadastro de um colega", async () => {
    await como(db, FIN, () =>
      db.exec(`update public.colaborador_dados set chave_pix = 'pix-corrigido' where user_id = '${COLEGA}'`)
    );
    expect(await pix(db, COLEGA)).toBe("pix-corrigido");
  });

  it("Editar NÃO altera o cadastro de quem tem acesso total", async () => {
    await como(db, FIN, () =>
      db.exec(`update public.colaborador_dados set chave_pix = 'fraude' where user_id = '${ADMIN}'`)
    );
    expect(await pix(db, ADMIN)).toBe("pix-admin");
  });

  it("Editar cria o cadastro de quem ainda não preencheu", async () => {
    await como(db, FIN, () =>
      db.exec(`insert into public.colaborador_dados values ('${VE}', 'pix-ve')`)
    );
    expect(await pix(db, VE)).toBe("pix-ve");
  });

  it("sem Criar nem Editar, não cria cadastro para outra pessoa", async () => {
    await expect(
      como(db, VE, () => db.exec(`insert into public.colaborador_dados values ('${CONVERSA}', 'x')`))
    ).rejects.toThrow(/row-level security/i);
  });

  it("perfil público: Editar colaboradores altera nome de colega, não de quem tem acesso total", async () => {
    await como(db, FIN, async () => {
      await db.exec(`update public.users set nome = 'Colega Renomeado' where id = '${COLEGA}'`);
      await db.exec(`update public.users set nome = 'Hackeado' where id = '${ADMIN}'`);
    });
    const r = await db.query<{ id: string; nome: string }>(
      `select id, nome from public.users where id in ('${COLEGA}', '${ADMIN}') order by nome`
    );
    expect(r.rows.find((x) => x.id === COLEGA)?.nome).toBe("Colega Renomeado");
    expect(r.rows.find((x) => x.id === ADMIN)?.nome).toBe("Admin");
  });

  it("…e não burla a trava de privilégio da 043", async () => {
    await expect(
      como(db, FIN, () => db.exec(`update public.users set role = 'admin' where id = '${COLEGA}'`))
    ).rejects.toThrow(/Apenas administradores/);
  });

  it("excluir exige a ação Excluir, e não alcança quem tem acesso total", async () => {
    await como(db, VE, () => db.exec(`delete from public.colaborador_dados where user_id = '${COLEGA}'`));
    expect(await pix(db, COLEGA)).toBeDefined();
    await como(db, FIN, () => db.exec(`delete from public.colaborador_dados where user_id = '${ADMIN}'`));
    expect(await pix(db, ADMIN)).toBe("pix-admin");
    await como(db, FIN, () => db.exec(`delete from public.colaborador_dados where user_id = '${COLEGA}'`));
    expect(await pix(db, COLEGA)).toBeUndefined();
  });
});

describe("046 — chat exige chat:view", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });

  it("sem chat:view não lê mensagens nem canais", async () => {
    const r = await como(db, NADA, async () => ({
      msgs: (await db.query(`select 1 from public.chat_messages`)).rows.length,
      canais: (await db.query(`select 1 from public.chat_channels`)).rows.length
    }));
    expect(r).toEqual({ msgs: 0, canais: 0 });
  });

  it("sem chat:view não envia mensagem", async () => {
    await expect(
      como(db, NADA, () =>
        db.exec(`insert into public.chat_messages (channel_id, user_id, content) values ('${CANAL}', '${NADA}', 'oi')`)
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("com chat:view lê e envia", async () => {
    await como(db, CONVERSA, async () => {
      expect((await db.query(`select 1 from public.chat_messages`)).rows.length).toBeGreaterThan(0);
      await db.exec(`insert into public.chat_messages (channel_id, user_id, content) values ('${CANAL}', '${CONVERSA}', 'enviado')`);
    });
    const r = await db.query(`select 1 from public.chat_messages where content = 'enviado'`);
    expect(r.rows).toHaveLength(1);
  });

  it("acesso total lê o chat", async () => {
    const r = await como(db, ADMIN, () => db.query(`select 1 from public.chat_messages`));
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it("é idempotente e remove as políticas antigas de colaboradores", async () => {
    await db.exec(m046);
    const antigas = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_policies
      where tablename = 'colaborador_dados' and policyname like '%own_or_admin%'
    `);
    expect(antigas.rows[0].n).toBe(0);
    const chat = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_policies
      where policyname in ('chat_channels_perm', 'chat_channel_members_perm', 'chat_messages_perm')
    `);
    expect(chat.rows[0].n).toBe(3);
  });
});
