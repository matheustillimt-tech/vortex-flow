// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), lookup: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.invalid/${path}` } }) }) },
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) }), insert: (row: unknown) => ({ select: () => ({ single: () => mocks.insert(row) }) }) })
}) }));
import { discardPendingTaskAttachment, uploadTaskAttachment } from "@/lib/task-attachments";
const file = new File(["fictício"], "anexo.txt", { type: "text/plain" });
const args = { taskId: "task", userId: "user", attachmentId: "att" };
beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue({ data: null, error: null }); mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null }); mocks.insert.mockImplementation(async row => ({ data: row, error: null })); });
it("associa arquivo no bucket existente com tarefa, autor e ID estáveis", async () => {
  const result = await uploadTaskAttachment(file, args);
  expect(mocks.upload).toHaveBeenCalledWith("task/att.txt", file, expect.objectContaining({ upsert: false }));
  expect(result).toMatchObject({ id: "att", task_id: "task", uploaded_by: "user", storage_path: "task/att.txt", type: "file" });
});
it("não repete upload já confirmado após perda da resposta", async () => {
  mocks.lookup.mockResolvedValue({ data: { id: "att", task_id: "task" }, error: null });
  expect(await uploadTaskAttachment(file, args)).toMatchObject({ id: "att" });
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("recupera objeto que já existe sem enviar outro caminho", async () => {
  mocks.upload.mockResolvedValue({ error: { statusCode: "409" } });
  await uploadTaskAttachment(file, args);
  expect(mocks.insert).toHaveBeenCalledOnce();
});
it("não remove objeto quando INSERT foi confirmado depois da resposta perdida", async () => {
  mocks.insert.mockRejectedValue(new Error("network"));
  mocks.lookup.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id: "att", task_id: "task" }, error: null });
  expect(await uploadTaskAttachment(file, args)).toMatchObject({ id: "att" });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("limpa objeto sem associação quando metadata falha", async () => {
  mocks.insert.mockResolvedValue({ data: null, error: { message: "RLS" } });
  await expect(uploadTaskAttachment(file, args)).rejects.toMatchObject({ message: "RLS" });
  expect(mocks.remove).toHaveBeenCalledWith(["task/att.txt"]);
});
it("preserva objeto se consulta de confirmação falha, permitindo retomar", async () => {
  mocks.insert.mockRejectedValue(new Error("network"));
  mocks.lookup.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "network" } });
  await expect(uploadTaskAttachment(file, args)).rejects.toThrow("Não foi possível confirmar");
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("cancelamento não apaga anexo associado e limpa objetos pendentes", async () => {
  mocks.lookup.mockResolvedValueOnce({ data: { id: "att" }, error: null });
  await discardPendingTaskAttachment(file, args); expect(mocks.remove).not.toHaveBeenCalled();
  await discardPendingTaskAttachment(file, args); expect(mocks.remove).toHaveBeenCalledWith(["task/att.txt"]);
});
it("propaga erro de autorização sem tentar registrar metadata", async () => {
  mocks.upload.mockResolvedValue({ error: { statusCode: "403", message: "not allowed" } });
  await expect(uploadTaskAttachment(file, args)).rejects.toMatchObject({ statusCode: "403" });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("retoma também o conflito 400 legado do Storage sem ignorar outros erros 400", async () => {
  mocks.upload.mockResolvedValue({ error: { statusCode: "400", message: "Asset Already Exists" } });
  await uploadTaskAttachment(file, args);
  expect(mocks.insert).toHaveBeenCalledOnce();
  mocks.upload.mockResolvedValue({ error: { statusCode: "400", message: "Invalid key" } });
  await expect(uploadTaskAttachment(file, args)).rejects.toMatchObject({ message: "Invalid key" });
});
