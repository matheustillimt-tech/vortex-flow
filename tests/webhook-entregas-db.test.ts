import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CELULAR, CELULAR_E164, CELULAR_MASCARA, OUTRO_CELULAR_E164 } from "./fixtures/telefones";

const migration = readFileSync(
  new URL("../supabase/migrations/051_webhook_whatsapp.sql", import.meta.url),
  "utf8"
);

const ADMIN = "00000000-0000-0000-0000-000000000001";
const ANA = "00000000-0000-0000-0000-000000000002";
const BIA = "00000000-0000-0000-0000-000000000003";
const TAREFA = "aaaaaaaa-0000-0000-0000-000000000001";

/** Só o necessário das tabelas reais para os gatilhos rodarem. */
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.users (id uuid primary key, nome text not null);
    create function public.is_admin(uid uuid) returns boolean language sql stable as
      $$ select uid = '${ADMIN}'::uuid $$;
    create table public.tasks (
      id uuid primary key default gen_random_uuid(),
      titulo text not null,
      created_by uuid references public.users(id)
    );
    create table public.task_assignees (
      task_id uuid not null references public.tasks(id) on delete cascade,
      user_id uuid not null references public.users(id) on delete cascade,
      assigned_by uuid references public.users(id),
      primary key (task_id, user_id)
    );
    create table public.colaborador_dados (
      user_id uuid primary key references public.users(id) on delete cascade,
      cpf text
    );
    insert into public.users (id, nome) values
      ('${ADMIN}', 'Admin'), ('${ANA}', 'Ana'), ('${BIA}', 'Bia');
    insert into public.tasks (id, titulo, created_by) values ('${TAREFA}', 'Criativos', '${ADMIN}');
  `);
  await db.exec(migration);
  return db;
}

type Entrega = { user_id: string; status: string; atribuido_por: string | null; tentativas: number };
const entregas = async (db: PGlite) =>
  (await db.query<Entrega>(
    `select user_id, status, atribuido_por, tentativas from public.webhook_entregas order by user_id`
  )).rows;

describe("051 — fila de webhook na atribuição", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec(`
      delete from public.webhook_entregas;
      delete from public.task_assignees;
      delete from public.webhook_config;
      delete from public.colaborador_dados;
      delete from public.webhook_remocoes_recentes;
      insert into public.webhook_config (url, ativo) values ('https://disparo.exemplo.com/hook', true);
      insert into public.colaborador_dados (user_id) values ('${ANA}');
      update public.colaborador_dados set whatsapp = '${CELULAR_E164}' where user_id = '${ANA}';
    `);
  });

  const atribuir = (userId: string, por: string | null = ADMIN) =>
    db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by)
             values ('${TAREFA}', '${userId}', ${por ? `'${por}'` : "null"})`);

  it("responsável com WhatsApp entra como pendente, com quem atribuiu", async () => {
    await atribuir(ANA);
    expect(await entregas(db)).toEqual([
      { user_id: ANA, status: "pendente", atribuido_por: ADMIN, tentativas: 0 }
    ]);
  });

  it("sem assigned_by, quem atribuiu é o criador da tarefa", async () => {
    await atribuir(ANA, null);
    expect((await entregas(db))[0].atribuido_por).toBe(ADMIN);
  });

  it("sem WhatsApp fica registrado como sem_telefone", async () => {
    await atribuir(BIA);
    expect((await entregas(db))[0].status).toBe("sem_telefone");
  });

  it("vários responsáveis geram uma entrega cada", async () => {
    await atribuir(ANA);
    await atribuir(BIA);
    expect((await entregas(db)).map((e) => e.user_id)).toEqual([ANA, BIA]);
  });

  it("quem atribui a si mesmo não recebe", async () => {
    await atribuir(ANA, ANA);
    expect(await entregas(db)).toEqual([]);
  });

  it("o criador da tarefa não recebe", async () => {
    await atribuir(ADMIN, BIA);
    expect(await entregas(db)).toEqual([]);
  });

  it("webhook desligado não registra nada", async () => {
    await db.exec(`update public.webhook_config set ativo = false`);
    await atribuir(ANA);
    expect(await entregas(db)).toEqual([]);
  });

  it("webhook sem URL não registra nada", async () => {
    await db.exec(`update public.webhook_config set url = '  '`);
    await atribuir(ANA);
    expect(await entregas(db)).toEqual([]);
  });

  it("sem configuração nenhuma, a atribuição segue normal", async () => {
    await db.exec(`delete from public.webhook_config`);
    await atribuir(ANA);
    expect(await entregas(db)).toEqual([]);
    const r = await db.query(`select 1 from public.task_assignees where user_id = '${ANA}'`);
    expect(r.rows).toHaveLength(1);
  });

  it("WhatsApp só aceita dígitos com 55", async () => {
    await expect(
      db.exec(`update public.colaborador_dados set whatsapp = '${CELULAR}' where user_id = '${ANA}'`)
    ).rejects.toThrow();
    await expect(
      db.exec(`update public.colaborador_dados set whatsapp = '${CELULAR_MASCARA}' where user_id = '${ANA}'`)
    ).rejects.toThrow();
  });

  it("webhook_config tem uma linha só", async () => {
    await expect(
      db.exec(`insert into public.webhook_config (url) values ('https://outra')`)
    ).rejects.toThrow();
  });

  it("inserir uma entrega pendente sem pg_net/vault não dá erro (a rota despacha depois)", async () => {
    await expect(
      db.exec(
        `insert into public.webhook_entregas (task_id, user_id, status) values ('${TAREFA}', '${ANA}', 'pendente')`
      )
    ).resolves.not.toThrow();
  });
});

describe("051 — remoção evita reatribuição fantasma", () => {
  let db: PGlite;
  beforeAll(async () => { db = await fixture(); });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec(`
      delete from public.webhook_entregas;
      delete from public.task_assignees;
      delete from public.webhook_config;
      delete from public.colaborador_dados;
      delete from public.webhook_remocoes_recentes;
      insert into public.webhook_config (url, ativo) values ('https://disparo.exemplo.com/hook', true);
      insert into public.colaborador_dados (user_id) values ('${ANA}'), ('${BIA}');
      update public.colaborador_dados set whatsapp = '${CELULAR_E164}' where user_id = '${ANA}';
      update public.colaborador_dados set whatsapp = '${OUTRO_CELULAR_E164}' where user_id = '${BIA}';
    `);
  });

  const atribuir = (userId: string, por: string | null = ADMIN) =>
    db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by)
             values ('${TAREFA}', '${userId}', ${por ? `'${por}'` : "null"})`);
  const entregasDe = async (userId: string) =>
    (await db.query(`select id from public.webhook_entregas where user_id = '${userId}'`)).rows;

  it("deletar todos os responsáveis e reinserir a mesma lista não duplica aviso para quem já estava, mas avisa quem é novo", async () => {
    await atribuir(ANA);
    expect(await entregasDe(ANA)).toHaveLength(1);

    // Mesmo padrão do task-panel/mcp: apaga tudo e reinsere a lista completa.
    await db.exec(`delete from public.task_assignees where task_id = '${TAREFA}'`);
    await atribuir(ANA);
    await atribuir(BIA);

    expect(await entregasDe(ANA)).toHaveLength(1); // continua com 1 — não reavisa
    expect(await entregasDe(BIA)).toHaveLength(1); // é novo — recebe o aviso
  });

  it("removido há mais de 2 minutos e reatribuído recebe um novo aviso", async () => {
    await atribuir(ANA);
    expect(await entregasDe(ANA)).toHaveLength(1);

    await db.exec(`delete from public.task_assignees where task_id = '${TAREFA}' and user_id = '${ANA}'`);
    await db.exec(
      `update public.webhook_remocoes_recentes set removido_em = now() - interval '3 minutes'
       where task_id = '${TAREFA}' and user_id = '${ANA}'`
    );
    await atribuir(ANA);

    expect(await entregasDe(ANA)).toHaveLength(2);
  });

  it("deletar a tarefa em cascata com responsáveis não dá erro", async () => {
    const outraTarefa = "aaaaaaaa-0000-0000-0000-000000000099";
    await db.exec(`insert into public.tasks (id, titulo, created_by) values ('${outraTarefa}', 'Tarefa temporária', '${ADMIN}')`);
    await db.exec(
      `insert into public.task_assignees (task_id, user_id, assigned_by) values ('${outraTarefa}', '${ANA}', '${ADMIN}')`
    );
    await expect(db.exec(`delete from public.tasks where id = '${outraTarefa}'`)).resolves.not.toThrow();
  });
});

describe("051 — reserva de pendentes", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await fixture();
    await db.exec(`
      insert into public.webhook_config (url, ativo) values ('https://disparo.exemplo.com/hook', true);
      insert into public.colaborador_dados (user_id) values ('${ANA}');
      update public.colaborador_dados set whatsapp = '${CELULAR_E164}' where user_id = '${ANA}';
      insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}');
      insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${BIA}', '${ADMIN}');
    `);
  });
  afterAll(async () => { await db.close(); });

  it("reserva só pendentes, marca processando e conta a tentativa", async () => {
    const r = await db.query<{ user_id: string; status: string; tentativas: number }>(
      `select user_id, status, tentativas from public.webhook_reservar_pendentes(5)`
    );
    expect(r.rows).toEqual([{ user_id: ANA, status: "processando", tentativas: 1 }]);
  });

  it("uma segunda chamada não pega a mesma entrega", async () => {
    const r = await db.query(`select * from public.webhook_reservar_pendentes(5)`);
    expect(r.rows).toEqual([]);
  });

  it("entrega presa em processando há mais de 5 minutos volta a ser reservada", async () => {
    await db.exec(`update public.webhook_entregas set reservado_em = now() - interval '6 minutes'
                   where status = 'processando'`);
    const r = await db.query<{ tentativas: number }>(
      `select tentativas from public.webhook_reservar_pendentes(5)`
    );
    expect(r.rows).toEqual([{ tentativas: 2 }]);
  });

  it("é idempotente", async () => {
    await db.exec(migration);
    const r = await db.query(`select count(*)::int as n from public.webhook_entregas`);
    expect(r.rows).toEqual([{ n: 2 }]);
  });
});
