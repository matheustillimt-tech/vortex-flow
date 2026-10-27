// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { downloadFile, previewKind } from "@/lib/attachment-preview";
import { AttachmentPreview, type PreviewItem } from "@/components/attachments/attachment-preview";

// No jsdom o endereço do módulo não é de arquivo; lê a partir da raiz do projeto.
const ler = (caminho: string) => readFileSync(resolve(process.cwd(), caminho), "utf8");

const arquivo = (name: string, extra: Partial<PreviewItem> = {}): PreviewItem => ({
  id: name,
  name,
  url: `https://storage.example/${name}`,
  size: 2048,
  ...extra
});

describe("previewKind", () => {
  it.each([
    [{ name: "foto.jpeg", type: "image" }, "image"],
    [{ name: "x.bin", mime: "image/png" }, "image"],
    [{ name: "reels.mp4", type: "video" }, "video"],
    [{ name: "audio.m4a", mime: "audio/mp4" }, "audio"],
    [{ name: "contrato.PDF" }, "pdf"],
    [{ name: "x", mime: "application/pdf" }, "pdf"],
    [{ name: "leads.csv" }, "text"],
    [{ name: "notas.txt", mime: "text/plain" }, "text"],
    [{ name: "planilha.xlsx" }, "none"],
    [{ name: "proposta.docx" }, "none"],
    [{ name: "arquivos.zip" }, "none"]
  ])("%j → %s", (att, esperado) => {
    expect(previewKind(att)).toBe(esperado);
  });
});

describe("AttachmentPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nome,valor\nA,1")));
    URL.createObjectURL = vi.fn(() => "blob:local");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mostra imagem", () => {
    render(<AttachmentPreview items={[arquivo("foto.jpeg", { type: "image" })]} index={0} onClose={vi.fn()} />);
    expect((screen.getByAltText("foto.jpeg") as HTMLImageElement).src).toContain("foto.jpeg");
  });

  it("mostra PDF num quadro embutido", () => {
    const { container } = render(
      <AttachmentPreview items={[arquivo("contrato.pdf")]} index={0} onClose={vi.fn()} />
    );
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://storage.example/contrato.pdf"
    );
  });

  it("mostra o conteúdo de um CSV", async () => {
    render(<AttachmentPreview items={[arquivo("leads.csv")]} index={0} onClose={vi.fn()} />);
    expect(await screen.findByText(/nome,valor/)).toBeTruthy();
  });

  it("tipo sem prévia oferece baixar", () => {
    render(<AttachmentPreview items={[arquivo("proposta.docx")]} index={0} onClose={vi.fn()} />);
    expect(screen.getByText("Pré-visualização indisponível para este tipo de arquivo.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Baixar para abrir" })).toBeTruthy();
  });

  it("arquivo local (antes de enviar) não oferece baixar nem nova aba", () => {
    render(
      <AttachmentPreview
        items={[arquivo("foto.jpeg", { type: "image", url: "blob:local" })]}
        index={0}
        onClose={vi.fn()}
        allowDownload={false}
      />
    );
    expect(screen.queryByRole("button", { name: "Baixar" })).toBeNull();
    expect(screen.queryByText("Abrir em nova aba")).toBeNull();
  });

  it("Esc fecha só a pré-visualização — não chega ao modal por baixo", () => {
    const onClose = vi.fn();
    const modalPorBaixo = vi.fn();
    window.addEventListener("keydown", modalPorBaixo);
    render(<AttachmentPreview items={[arquivo("foto.jpeg", { type: "image" })]} index={0} onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalPorBaixo).not.toHaveBeenCalled();
    window.removeEventListener("keydown", modalPorBaixo);
  });

  it("navega entre anexos com as setas e dá a volta", () => {
    const onIndexChange = vi.fn();
    const itens = [arquivo("a.jpeg", { type: "image" }), arquivo("b.pdf"), arquivo("c.csv")];
    render(<AttachmentPreview items={itens} index={0} onClose={vi.fn()} onIndexChange={onIndexChange} />);
    expect(screen.getByText(/1 de 3/)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Anexo anterior" }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
  });

  it("clicar no fundo fecha; clicar no conteúdo não", () => {
    const onClose = vi.fn();
    render(<AttachmentPreview items={[arquivo("foto.jpeg", { type: "image" })]} index={0} onClose={onClose} />);
    fireEvent.click(screen.getByAltText("foto.jpeg"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("downloadFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("baixa com o nome original, a partir de um endereço local", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("conteudo")));
    URL.createObjectURL = vi.fn(() => "blob:local");
    URL.revokeObjectURL = vi.fn();
    let baixado: { href: string; download: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      baixado = { href: this.href, download: this.download };
    });

    await downloadFile("https://storage.example/4afaf571.jpeg", "Briefing do cliente.jpeg");

    expect(baixado).toEqual({ href: "blob:local", download: "Briefing do cliente.jpeg" });
  });

  it("falha com mensagem quando o arquivo não é encontrado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(downloadFile("https://storage.example/x.pdf", "x.pdf")).rejects.toThrow(/404/);
  });
});

describe("regressões cobertas por esta mudança", () => {
  it("o download não depende mais do atributo download em link externo", () => {
    const codigo = ler("components/side-panel/task-attachments.tsx");
    expect(codigo).not.toMatch(/<a\b[^>]*\sdownload[\s>]/);
    expect(codigo).toContain("downloadFile(");
  });

  it("no painel, os anexos ficam fora do bloco desabilitado para quem só lê", () => {
    const painel = ler("components/side-panel/task-panel.tsx");
    const fecha = painel.indexOf("</fieldset>");
    const anexos = painel.indexOf('title="Anexos"');
    const reabre = painel.indexOf("<fieldset disabled={!canEdit}", fecha);
    expect(fecha).toBeGreaterThan(-1);
    expect(anexos).toBeGreaterThan(fecha);
    expect(reabre).toBeGreaterThan(anexos);

    // Enviar e excluir continuam presos ao perfil.
    expect(ler("components/side-panel/task-attachments.tsx")).toContain('useCan("tarefas", "edit")');
  });

  it("a criação de tarefa oferece pré-visualizar o arquivo pendente", () => {
    const modal = ler("components/projects/task-create-modal.tsx");
    expect(modal).toContain("aria-label={`Pré-visualizar ${item.file.name}`}");
    expect(modal).toContain("allowDownload={false}");
    expect(modal).toContain("URL.revokeObjectURL(url)");
  });
});
