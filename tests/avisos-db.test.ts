import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const m051 = readFileSync(new URL("../supabase/migrations/051_webhook_whatsapp.sql", import.meta.url), "utf8");
const m052 = readFileSync(new URL("../supabase/migrations/052_avisos_whatsapp_canais.sql", import.meta.url), "utf8");

const ADMIN = "00000000-0000-0000-0000-000000000001";
const ANA = "00000000-0000-0000-0000-000000000002";
const BIA = "00000000-0000-0000-0000-000000000003";
const CAIO = "00000000-0000-0000-0000-000000000004"; // sem acesso ao projeto
const DANI = "00000000-0000-0000-0000-000000000005";
const PROJ = "bbbbbbbb-0000-0000-0000-000000000001";
const TAREFA = "aaaaaaaa-0000-0000-0000-000000000001";

/** Mesmo recorte de 051, com o que 052 usa a mais (status, prazo, comentários, acesso). */
async function fixture(comConfigAntiga = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type task_status as enum ('pendente', 'em_andamento', 'em_revisao', 'concluido', 'travado');
    create table public.users (id uuid primary key, nome text not null, ativo boolean not null default true);
    create function public.is_admin(uid uuid) returns boolean language sql stable as
      $$ select uid = '${ADMIN}'::uuid $$;
    create function public.user_can_see_project(uid uuid, pid uuid) returns boolean language sql stable as
      $$ select uid is not null and uid <> '${CAIO}'::uuid $$;
    create function public.has_permission(uid uuid, p_resource text, p_action text) returns boolean
      language sql stable as $$ select uid = '${ADMIN}'::uuid $$;
    create table public.tasks (
      id uuid primary key default gen_random_uuid(),
      titulo text not null,
      project_id uuid,
      status task_status not null default 'pendente',
      prazo timestamptz,
      created_at timestamptz not null default now(),
      created_by uuid references public.users(id)
    );
    create table public.task_assignees (
      task_id uuid not null references public.tasks(id) on delete cascade,
      user_id uuid not null references public.users(id) on delete cascade,
      assigned_by uuid references public.users(id),
      primary key (task_id, user_id)
    );
    create table public.task_comments (
      id uuid primary key default gen_random_uuid(),
      task_id uuid not null references public.tasks(id) on delete cascade,
      user_id uuid references public.users(id) on delete set null,
      conteudo text not null,
      created_at timestamptz not null default now()
    );
    create table public.colaborador_dados (
      user_id uuid primary key references public.users(id) on delete cascade,
      cpf text
    );
    insert into public.users (id, nome) values
      ('${ADMIN}', 'Admin Geral'), ('${ANA}', 'Ana Souza'), ('${BIA}', 'Bia Lima'),
      ('${CAIO}', 'Caio Rocha'), ('${DANI}', 'Ana Paula');
    insert into public.tasks (id, titulo, project_id, created_by, created_at)
      values ('${TAREFA}', 'Criativos', '${PROJ}', '${ADMIN}', '2026-10-01T12:00:00Z');
  `);
  await db.exec(m051);
  await db.exec(`grant usage on schema public to authenticated; grant select on public.tasks to authenticated;`);
  if (comConfigAntiga) {
    await db.exec(`insert into public.webhook_config (url, ativo) values ('https://disparo.exemplo.com/hook', true)`);
  }
  await db.exec(m052);
  return db;
}

type Linha = { user_id: string; evento: string; status: string; dedup_key: string | null; payload_extra: Record<string, unknown> | null };
const fila = async (db: PGlite, evento?: string) =>
  (
    await db.query<Linha>(
      `select user_id, evento, status, dedup_key, payload_extra from public.webhook_entregas
        ${evento ? `where evento = '${evento}'` : ""} order by user_id, dedup_key`
    )
  ).rows;

describe("052 — instalação que já existia", () => {
  it("continua no canal webhook, só com o aviso de nova tarefa ligado", async () => {
    const db = await fixture(true);
    const { rows } = await db.query<{ canal: string; eventos_ativos: Record<string, boolean>; templates: unknown }>(
      `select canal, eventos_ativos, templates from public.webhook_config`
    );
    expect(rows[0].canal).toBe("webhook");
    expect(rows[0].eventos_ativos).toEqual({
      "tarefa.atribuida": true,
      "tarefa.prazo": false,
      "tarefa.atrasada": false,
      "tarefa.comentario": false
    });
    expect(rows[0].templates).toEqual({});
    await db.exec(`insert into public.colaborador_dados (user_id) values ('${ANA}');
                   update public.colaborador_dados set whatsapp = '5511900008888';
                   insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}')`);
    expect((await fila(db)).map((e) => [e.evento, e.status])).toEqual([["tarefa.atribuida", "pendente"]]);
    await db.close();
  });

  it("rodar 052 de novo não quebra nem religa os eventos", async () => {
    const db = await fixture(true);
    await db.exec(m052);
    const { rows } = await db.query<{ eventos_ativos: Record<string, boolean> }>(`select eventos_ativos from public.webhook_config`);
    expect(rows[0].eventos_ativos["tarefa.prazo"]).toBe(false);
    await db.close();
  });
});

describe("052 — avisos", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await fixture();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec(`
      delete from public.webhook_entregas;
      delete from public.task_comments;
      delete from public.task_lembretes;
      delete from public.task_assignees;
      delete from public.webhook_config;
      delete from public.colaborador_dados;
      delete from public.webhook_remocoes_recentes;
      update public.tasks set status = 'pendente', prazo = '2026-10-28T23:59:00-03:00',
        created_at = '2026-10-01T12:00:00Z', lembrete_padrao = true;
      insert into public.webhook_config (canal, crm_url, crm_chave, ativo)
        values ('crm', 'https://crm.exemplo.com/functions/v1/mcp', 'v1:cifrado', true);
      insert into public.colaborador_dados (user_id) values ('${ANA}'), ('${BIA}'), ('${ADMIN}'), ('${CAIO}'), ('${DANI}');
      update public.colaborador_dados set whatsapp = '5511900008888' where user_id <> '${BIA}';
    `);
  });

  const atribuir = async (...ids: string[]) => {
    for (const id of ids)
      await db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${id}', '${ADMIN}')`);
    await db.exec(`delete from public.webhook_entregas`);
  };
  const comentar = (autor: string, texto: string) =>
    db.exec(`insert into public.task_comments (task_id, user_id, conteudo) values ('${TAREFA}', '${autor}', '${texto}')`);
  const agendar = async (agora: string) =>
    (await db.query<{ n: number }>(`select public.avisos_enfileirar_agendados('${agora}'::timestamptz) as n`)).rows[0].n;

  it("instalação nova nasce com os 4 eventos ligados", async () => {
    const { rows } = await db.query<{ eventos_ativos: Record<string, boolean> }>(`select eventos_ativos from public.webhook_config`);
    expect(Object.values(rows[0].eventos_ativos)).toEqual([true, true, true, true]);
  });

  describe("nova tarefa", () => {
    it("canal CRM completo registra a atribuição", async () => {
      await db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}')`);
      expect((await fila(db)).map((e) => e.evento)).toEqual(["tarefa.atribuida"]);
    });

    it("canal CRM sem chave não registra", async () => {
      await db.exec(`update public.webhook_config set crm_chave = null`);
      await db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}')`);
      expect(await fila(db)).toEqual([]);
    });

    it("Z-API com instância e token registra", async () => {
      await db.exec(`update public.webhook_config set canal = 'zapi', zapi_instancia = 'I', zapi_token = 'v1:x'`);
      await db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}')`);
      expect(await fila(db)).toHaveLength(1);
    });

    it("evento desligado não registra", async () => {
      await db.exec(`update public.webhook_config set eventos_ativos = eventos_ativos || '{"tarefa.atribuida": false}'`);
      await db.exec(`insert into public.task_assignees (task_id, user_id, assigned_by) values ('${TAREFA}', '${ANA}', '${ADMIN}')`);
      expect(await fila(db)).toEqual([]);
    });

    it("evento fora da lista é recusado pela fila", async () => {
      await expect(
        db.exec(`insert into public.webhook_entregas (task_id, user_id, evento, status) values ('${TAREFA}', '${ANA}', 'outro', 'pendente')`)
      ).rejects.toThrow();
    });
  });

  describe("comentário", () => {
    it("avisa os responsáveis menos quem comentou", async () => {
      await atribuir(ANA, BIA);
      await comentar(ANA, "Subi a versão 1");
      const linhas = await fila(db, "tarefa.comentario");
      expect(linhas.map((l) => [l.user_id, l.status])).toEqual([[BIA, "sem_telefone"]]);
      expect(linhas[0].payload_extra).toMatchObject({ comentario: "Subi a versão 1" });
      expect(linhas[0].dedup_key).toMatch(/^tarefa\.comentario:/);
    });

    it("avisa quem foi marcado pelo nome completo, sem repetir quem também é responsável", async () => {
      await atribuir(BIA);
      await comentar(ADMIN, "@Ana Souza e @bia lima, conferem?");
      expect((await fila(db, "tarefa.comentario")).map((l) => l.user_id)).toEqual([ANA, BIA]);
    });

    it("primeiro nome só vale quando é único", async () => {
      await comentar(ADMIN, "@Bia pode ver? @Ana também");
      // "Ana" é de Ana Souza e de Ana Paula: ambíguo, ninguém recebe por ele.
      expect((await fila(db, "tarefa.comentario")).map((l) => l.user_id)).toEqual([BIA]);
    });

    it("quem não enxerga o projeto não recebe, mesmo marcado", async () => {
      await comentar(ADMIN, "@Caio Rocha olha isso");
      expect(await fila(db, "tarefa.comentario")).toEqual([]);
    });

    it("quem marca a si mesmo não recebe", async () => {
      await comentar(ANA, "lembrete pra mim @Ana Souza");
      expect(await fila(db, "tarefa.comentario")).toEqual([]);
    });

    it("nome com caractere especial não quebra o gatilho", async () => {
      await db.exec(`update public.users set nome = 'Bia (Design).' where id = '${BIA}'`);
      await comentar(ADMIN, "@bia (design). viu?");
      expect((await fila(db, "tarefa.comentario")).map((l) => l.user_id)).toEqual([BIA]);
      await db.exec(`update public.users set nome = 'Bia Lima' where id = '${BIA}'`);
    });

    it("evento desligado não avisa", async () => {
      await atribuir(BIA);
      await db.exec(`update public.webhook_config set eventos_ativos = eventos_ativos || '{"tarefa.comentario": false}'`);
      await comentar(ANA, "oi");
      expect(await fila(db)).toEqual([]);
    });
  });

  describe("agendador", () => {
    it("antes das 08:00 do dia do prazo não avisa", async () => {
      await atribuir(ANA, BIA);
      expect(await agendar("2026-10-28T07:59:00-03:00")).toBe(0);
      expect(await fila(db)).toEqual([]);
    });

    it("às 08:00 do dia do prazo avisa cada responsável uma vez só", async () => {
      await atribuir(ANA, BIA);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(2);
      expect(await agendar("2026-10-28T08:10:00-03:00")).toBe(0);
      expect((await fila(db, "tarefa.prazo")).map((l) => [l.user_id, l.status])).toEqual([
        [ANA, "pendente"],
        [BIA, "sem_telefone"]
      ]);
    });

    it("tarefa criada depois das 08:00 do dia não ganha o lembrete das 08:00", async () => {
      await atribuir(ANA);
      await db.exec(`update public.tasks set created_at = '2026-10-28T10:00:00-03:00'`);
      expect(await agendar("2026-10-28T10:05:00-03:00")).toBe(0);
    });

    it("lembrete padrão desligado não avisa às 08:00, mas o horário extra avisa", async () => {
      await atribuir(ANA);
      await db.exec(`update public.tasks set lembrete_padrao = false;
        insert into public.task_lembretes (task_id, horario, criado_por) values ('${TAREFA}', '2026-10-28T14:00:00-03:00', '${ADMIN}')`);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(0);
      expect(await agendar("2026-10-28T14:02:00-03:00")).toBe(1);
      expect(await agendar("2026-10-28T14:07:00-03:00")).toBe(0);
      expect((await fila(db, "tarefa.prazo")).map((l) => l.user_id)).toEqual([ANA]);
    });

    it("lembrete extra às 08:00 do dia do prazo não duplica o aviso padrão", async () => {
      await atribuir(ANA);
      await db.exec(`insert into public.task_lembretes (task_id, horario, criado_por) values ('${TAREFA}', '2026-10-28T08:00:00-03:00', '${ADMIN}')`);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(1);
    });

    it("tarefa concluída não recebe prazo nem atraso", async () => {
      await atribuir(ANA);
      await db.exec(`update public.tasks set status = 'concluido'`);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(0);
      expect(await agendar("2026-10-29T08:05:00-03:00")).toBe(0);
    });

    it("atrasada: no 1º dia avisa responsáveis e quem criou; depois só responsáveis", async () => {
      await atribuir(ANA);
      await db.exec(`update public.tasks set lembrete_padrao = false`);
      expect(await agendar("2026-10-29T07:00:00-03:00")).toBe(0);
      expect(await agendar("2026-10-29T08:01:00-03:00")).toBe(2);
      const dia1 = await fila(db, "tarefa.atrasada");
      expect(dia1.map((l) => l.user_id)).toEqual([ADMIN, ANA]);
      expect(dia1[0].payload_extra).toMatchObject({ dias_atraso: 1 });
      await db.exec(`delete from public.webhook_entregas`);
      expect(await agendar("2026-10-30T08:01:00-03:00")).toBe(1);
      const dia2 = await fila(db, "tarefa.atrasada");
      expect(dia2.map((l) => l.user_id)).toEqual([ANA]);
      expect(dia2[0].payload_extra).toMatchObject({ dias_atraso: 2 });
      expect(await agendar("2026-10-30T09:01:00-03:00")).toBe(0);
    });

    it("criador que também é responsável recebe uma vez só", async () => {
      await atribuir(ADMIN);
      await db.exec(`update public.tasks set lembrete_padrao = false`);
      expect(await agendar("2026-10-29T08:01:00-03:00")).toBe(1);
    });

    it("canal desligado não enfileira nada", async () => {
      await atribuir(ANA);
      await db.exec(`update public.webhook_config set ativo = false`);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(0);
    });

    it("evento de prazo desligado não enfileira prazo", async () => {
      await atribuir(ANA);
      await db.exec(`update public.webhook_config set eventos_ativos = eventos_ativos || '{"tarefa.prazo": false}'`);
      expect(await agendar("2026-10-28T08:05:00-03:00")).toBe(0);
    });

    it("avisos_cron() sem pg_net nem vault roda sem erro", async () => {
      await atribuir(ANA);
      await expect(db.exec(`select public.avisos_cron()`)).resolves.not.toThrow();
    });
  });

  describe("fila", () => {
    it("a reserva ignora entrega agendada para o futuro", async () => {
      await db.exec(`
        insert into public.webhook_entregas (task_id, user_id, evento, status, agendado_para)
        values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'pendente', now() + interval '1 hour'),
               ('${TAREFA}', '${BIA}', 'tarefa.prazo', 'pendente', null)`);
      const { rows } = await db.query<{ user_id: string; evento: string }>(
        `select user_id, evento from public.webhook_reservar_pendentes(5)`
      );
      expect(rows).toEqual([{ user_id: BIA, evento: "tarefa.prazo" }]);
    });

    it("aceita o status cancelado (tarefa concluída antes do envio)", async () => {
      await expect(
        db.exec(`insert into public.webhook_entregas (task_id, user_id, evento, status) values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'cancelado')`)
      ).resolves.not.toThrow();
    });

    it("envio travado em processando com 3 tentativas vira erro, não é reenviado", async () => {
      await db.exec(`update public.webhook_config set canal = 'webhook', url = 'https://x/hook';
        insert into public.webhook_entregas (task_id, user_id, evento, status, tentativas, reservado_em)
        values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'processando', 3, now() - interval '10 minutes')`);
      const { rows } = await db.query(`select * from public.webhook_reservar_pendentes(5)`);
      expect(rows).toEqual([]);
      expect((await fila(db)).map((l) => l.status)).toEqual(["erro"]);
    });

    it("no canal webhook, travado com menos de 3 tentativas volta (a ferramenta deduplica por entrega_id)", async () => {
      await db.exec(`update public.webhook_config set canal = 'webhook', url = 'https://x/hook';
        insert into public.webhook_entregas (task_id, user_id, evento, status, tentativas, reservado_em)
        values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'processando', 1, now() - interval '10 minutes')`);
      const { rows } = await db.query(`select * from public.webhook_reservar_pendentes(5)`);
      expect(rows).toHaveLength(1);
    });

    it("no CRM/Z-API, travado não é reenviado (não dá para saber se saiu): vira erro", async () => {
      await db.exec(`insert into public.webhook_entregas (task_id, user_id, evento, status, tentativas, reservado_em)
        values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'processando', 1, now() - interval '10 minutes')`);
      const { rows } = await db.query(`select * from public.webhook_reservar_pendentes(5)`);
      expect(rows).toEqual([]);
      expect((await fila(db)).map((l) => l.status)).toEqual(["erro"]);
    });

    it("dedup_key não deixa a mesma mensagem entrar duas vezes", async () => {
      const ins = `insert into public.webhook_entregas (task_id, user_id, evento, status, dedup_key)
                   values ('${TAREFA}', '${ANA}', 'tarefa.prazo', 'pendente', 'k1')`;
      await db.exec(ins);
      await expect(db.exec(ins)).rejects.toThrow();
    });
  });

  describe("lembretes da tarefa (RLS)", () => {
    const comoUsuario = async (uid: string, sql: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
      try {
        return await db.exec(sql);
      } finally {
        await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
      }
    };

    it("quem criou a tarefa adiciona lembrete", async () => {
      await db.exec(`update public.tasks set created_by = '${ANA}'`);
      await comoUsuario(ANA, `insert into public.task_lembretes (task_id, horario, criado_por) values ('${TAREFA}', now(), '${ANA}')`);
      expect((await db.query(`select 1 from public.task_lembretes`)).rows).toHaveLength(1);
      await db.exec(`update public.tasks set created_by = '${ADMIN}'`);
    });

    it("quem não criou e não pode editar não adiciona", async () => {
      await expect(
        comoUsuario(BIA, `insert into public.task_lembretes (task_id, horario, criado_por) values ('${TAREFA}', now(), '${BIA}')`)
      ).rejects.toThrow();
    });

    it("quem pode editar tarefas adiciona", async () => {
      await comoUsuario(ADMIN, `insert into public.task_lembretes (task_id, horario, criado_por) values ('${TAREFA}', now(), '${ADMIN}')`);
      expect((await db.query(`select 1 from public.task_lembretes`)).rows).toHaveLength(1);
    });
  });
});
