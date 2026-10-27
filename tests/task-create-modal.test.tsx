// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), prepare: vi.fn(), discard: vi.fn(), save: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: mocks.auth }, from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: "column", nome: "BACKLOG" }] }) }) }) }) }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast, success: mocks.toast } }));
vi.mock("@/lib/task-attachments", () => ({ uploadTaskAttachment: mocks.upload, discardPendingTaskAttachment: mocks.discard, formatFileSize: (n: number) => `${n} B` }));
vi.mock("@/lib/task-attachment-files", () => ({ prepareTaskAttachment: mocks.prepare, TASK_ATTACHMENT_ACCEPT: ".txt", taskAttachmentValidationError: (file: File) => file.name.endsWith(".exe") ? "Formato não suportado" : null }));
vi.mock("@/lib/task-creation", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/task-creation")>(), saveTaskDraft: mocks.save }));
import { TaskCreateModal } from "@/components/projects/task-create-modal";
const f1 = new File(["arquivo fictício A"], "a.txt", { type: "text/plain" });
const f2 = new File(["arquivo fictício B"], "b.txt", { type: "text/plain" });
function setup() {
  const onCreated = vi.fn(), onClose = vi.fn();
  render(<TaskCreateModal open onClose={onClose} onCreated={onCreated} projectId="project" users={[]} sectors={[]} />);
  fireEvent.change(screen.getByPlaceholderText("O que precisa ser feito?"), { target: { value: "Teste fictício" } });
  return { onCreated, onClose };
}
const select = (...files: File[]) => fireEvent.change(screen.getByLabelText("Anexar arquivos"), { target: { files } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
  mocks.prepare.mockImplementation(async (file: File) => file);
  mocks.upload.mockResolvedValue({ id: "attachment" });
  mocks.discard.mockResolvedValue(undefined);
  mocks.save.mockImplementation(async (draft, onSaved) => { if (!draft.taskSaved) { draft.taskSaved = true; onSaved(); } });
});
afterEach(cleanup);
it("seleciona sem upload, evita seleção duplicada e cancela sem objetos órfãos", async () => {
  const { onClose } = setup(); select(f1, f2); select(f1);
  expect(screen.getAllByText("a.txt")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remover b.txt" }));
  await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.discard).not.toHaveBeenCalled();
});
it("envia arquivos para a tarefa recém-criada antes de concluir", async () => {
  const { onCreated } = setup(); select(f1, f2); submit();
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  const id = mocks.save.mock.calls[0][0].task.id;
  expect(mocks.upload).toHaveBeenCalledTimes(2);
  expect(mocks.upload.mock.calls.every(([, args]) => args.taskId === id && args.userId === "user" && args.attachmentId)).toBe(true);
});
it("mantém falha visível e repete só o anexo pendente usando o mesmo ID", async () => {
  const { onCreated } = setup();
  mocks.upload.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("rede indisponível")).mockResolvedValueOnce({});
  select(f1, f2); submit();
  await screen.findByRole("alert");
  expect(onCreated).not.toHaveBeenCalled(); expect(screen.getByText("rede indisponível")).toBeTruthy();
  expect((screen.getByPlaceholderText("O que precisa ser feito?") as HTMLInputElement).closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(mocks.upload.mock.calls.map(([file]) => file.name)).toEqual(["a.txt", "b.txt", "b.txt"]);
  expect(mocks.upload.mock.calls[1][1]).toEqual(mocks.upload.mock.calls[2][1]);
  expect(mocks.save.mock.calls[0][0]).toBe(mocks.save.mock.calls[1][0]);
});
it("bloqueia clique, atalho e fechar durante um envio em andamento", async () => {
  let resolve!: (value: unknown) => void;
  mocks.upload.mockImplementation(() => new Promise(r => { resolve = r; }));
  const { onCreated, onClose } = setup(); select(f1); submit();
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledOnce());
  fireEvent.keyDown(screen.getByPlaceholderText("O que precisa ser feito?"), { key: "Enter", ctrlKey: true });
  screen.getAllByRole("button", { name: "Fechar" }).forEach(button => fireEvent.click(button));
  fireEvent.click(screen.getByRole("button", { name: "Salvando..." }));
  expect(mocks.save).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
  resolve({}); await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
});
it("explica o fechamento parcial e limpa apenas seleções pendentes após confirmação", async () => {
  mocks.upload.mockRejectedValue(new Error("falha"));
  const { onCreated } = setup(); select(f1); submit();
  await screen.findByRole("alert");
  fireEvent.click(screen.getAllByRole("button", { name: "Fechar" })[0]);
  expect(screen.getByText(/A tarefa e os anexos enviados serão mantidos/)).toBeTruthy();
  expect(onCreated).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Fechar sem enviar pendências" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  expect(mocks.discard).toHaveBeenCalledOnce();
});
it("não cria nem envia quando a sessão está expirada", async () => {
  mocks.auth.mockResolvedValue({ data: { user: null }, error: null });
  const { onCreated } = setup(); select(f1); submit();
  await screen.findByRole("alert"); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(onCreated).not.toHaveBeenCalled();
});
it("rejeita formatos inválidos antes de enviar", () => {
  setup(); select(new File(["fictício"], "teste.exe"));
  expect(mocks.toast).toHaveBeenCalledWith("Formato não suportado");
  expect(screen.queryByText("teste.exe")).toBeNull(); expect(mocks.upload).not.toHaveBeenCalled();
});
it("mantém os anexos pendentes quando o salvamento dos dados da tarefa falha", async () => {
  mocks.save.mockImplementationOnce(async (draft, onSaved) => { draft.taskSaved = true; onSaved(); throw new Error("Checklist indisponível"); });
  const { onCreated } = setup(); select(f1); submit();
  await screen.findByRole("alert"); expect(mocks.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce()); expect(mocks.upload).toHaveBeenCalledOnce();
});
