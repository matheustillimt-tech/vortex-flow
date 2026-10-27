// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ canCompress: vi.fn(), compress: vi.fn() }));
vi.mock("@/lib/video-compress", () => ({ canCompressVideo: mocks.canCompress, compressVideoForUpload: mocks.compress }));
import { MAX_TASK_ATTACHMENT_BYTES, prepareTaskAttachment, taskAttachmentValidationError } from "@/lib/task-attachment-files";
const large = (name: string, type: string) => { const file = new File(["mock"], name, { type }); Object.defineProperty(file, "size", { value: MAX_TASK_ATTACHMENT_BYTES + 1 }); return file; };
beforeEach(() => { vi.clearAllMocks(); mocks.canCompress.mockReturnValue(true); });
it("aceita documento dentro do limite sem modificar arquivo", async () => {
  const file = new File(["mock"], "arquivo.pdf", { type: "application/pdf" });
  expect(await prepareTaskAttachment(file)).toBe(file); expect(mocks.compress).not.toHaveBeenCalled();
});
it("rejeita documento acima do limite e tipo fora dos formatos aceitos", async () => {
  await expect(prepareTaskAttachment(large("arquivo.pdf", "application/pdf"))).rejects.toThrow("excede 100 MB");
  expect(taskAttachmentValidationError(new File(["mock"], "arquivo.exe"))).toContain("não suportado");
});
it("comprime vídeo grande e informa progresso usando as opções existentes", async () => {
  mocks.compress.mockImplementation(async (_, opts) => { opts.onProgress(0.5); return { blob: new Blob(["compressed"]), ext: "webm", mime: "video/webm" }; });
  const progress = vi.fn(); const file = await prepareTaskAttachment(large("video.mp4", "video/mp4"), progress);
  expect(file.name).toBe("video-comprimido.webm"); expect(progress).toHaveBeenCalledWith(0.5);
  expect(mocks.compress.mock.calls[0][1]).toMatchObject({ targetBytes: 95 * 1024 * 1024, maxResolution: 720 });
});
it("informa falta de suporte e compressão insuficiente sem tentar upload", async () => {
  mocks.canCompress.mockReturnValue(false);
  await expect(prepareTaskAttachment(large("video.mp4", "video/mp4"))).rejects.toThrow("não suporta compressão");
  mocks.canCompress.mockReturnValue(true); mocks.compress.mockResolvedValue({ blob: { size: MAX_TASK_ATTACHMENT_BYTES + 1 } });
  await expect(prepareTaskAttachment(large("video.mp4", "video/mp4"))).rejects.toThrow("após a compressão");
});
