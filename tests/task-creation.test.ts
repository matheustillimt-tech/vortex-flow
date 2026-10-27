import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: mocks.from }) }));
import { createTaskDraft, saveTaskDraft } from "@/lib/task-creation";
const input = { project_id: "project", titulo: "Tarefa fictícia", descricao: null, prioridade: "media" as const, status: "pendente" as const, sector_id: null, kanban_column_id: "column", prazo: null, prazo_has_time: false, responsavel_id: "user", created_by: "user" };
let rows: Record<string, Map<string, unknown>>;
let failTable: string | null;
let writes: { table: string; value: any; options: any }[];
beforeEach(() => {
  rows = {}; writes = []; failTable = null;
  mocks.from.mockImplementation((table: string) => ({
    upsert: async (value: any, options: any) => {
      writes.push({ table, value, options });
      rows[table] ??= new Map();
      for (const row of Array.isArray(value) ? value : [value]) rows[table].set(row.id ?? `${row.task_id}:${row.user_id}`, row);
      if (failTable === table) { failTable = null; return { error: { message: "Resposta perdida após gravar" } }; }
      return { error: null };
    },
    select: () => ({ eq: (_: string, id: string) => ({ single: async () => ({ data: rows[table]?.get(id), error: null }) }) })
  }));
});
it("reutiliza o ID após resposta perdida da criação sem sobrescrever nem duplicar", async () => {
  const draft = createTaskDraft(input, ["user"], ["Revisar"]);
  failTable = "tasks";
  await expect(saveTaskDraft(draft, vi.fn())).rejects.toMatchObject({ message: /./ });
  expect(draft.taskSaved).toBe(false);
  await saveTaskDraft(draft, vi.fn());
  expect(rows.tasks.size).toBe(1);
  expect(writes.filter(x => x.table === "tasks").map(x => x.value.id)).toEqual([draft.task.id, draft.task.id]);
  expect(writes.every(x => x.options.ignoreDuplicates === true)).toBe(true);
});
it("retoma checklist sem recriar tarefa ou responsáveis após falha parcial", async () => {
  const draft = createTaskDraft(input, ["user"], ["Revisar", "Concluir"]);
  failTable = "task_checklist_items";
  const created = vi.fn();
  await expect(saveTaskDraft(draft, created)).rejects.toBeTruthy();
  expect(draft.taskSaved).toBe(true);
  await saveTaskDraft(draft, created);
  expect(created).toHaveBeenCalledTimes(1);
  expect(writes.filter(x => x.table === "tasks")).toHaveLength(1);
  expect(writes.filter(x => x.table === "task_assignees")).toHaveLength(1);
  expect(rows.task_checklist_items.size).toBe(2);
});
it("cria normalmente sem responsáveis, checklist ou anexos", async () => {
  const draft = createTaskDraft({ ...input, responsavel_id: null }, [], []);
  await saveTaskDraft(draft, vi.fn());
  expect(writes.map(x => x.table)).toEqual(["tasks"]);
});
