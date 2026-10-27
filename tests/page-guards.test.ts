import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_ACCESS_HREF, PERMISSION_CATALOG } from "@/lib/permissions";

/**
 * Trava estática: impede que uma tela do catálogo fique sem guarda no servidor.
 * Esconder no menu não é permissão — sem requirePageAccess, a URL abre direto.
 */

const APP = fileURLToPath(new URL("../app/(app)", import.meta.url));
const paginaDe = (rota: string) => join(APP, rota, "page.tsx");

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return paginas(caminho);
    return nome === "page.tsx" ? [caminho] : [];
  });
}

describe("guardas de página", () => {
  const telas = PERMISSION_CATALOG.filter((r) => r.href);

  it.each(telas.map((r) => [r.href!, r.key]))(
    "%s exige o recurso %s",
    (href, key) => {
      const arquivo = paginaDe(href);
      expect(existsSync(arquivo), `página ${href} não existe`).toBe(true);
      expect(readFileSync(arquivo, "utf8")).toContain(`requirePageAccess("${key}")`);
    }
  );

  it("o detalhe de projeto também exige Projetos", () => {
    expect(readFileSync(paginaDe("projetos/[id]"), "utf8")).toContain(
      'requirePageAccess("projetos")'
    );
  });

  it("nenhuma página decide acesso pelo role legado", () => {
    for (const arquivo of paginas(APP)) {
      const codigo = readFileSync(arquivo, "utf8");
      expect(codigo, arquivo).not.toMatch(/role\s*!==?\s*["']admin["']/);
      expect(codigo, arquivo).not.toContain('.select("role")');
    }
  });

  it("a página de sem-acesso não se protege — seria um laço de redirecionamento", () => {
    const codigo = readFileSync(paginaDe(NO_ACCESS_HREF), "utf8");
    // Ignora comentários: o arquivo explica por que não chama a guarda.
    const semComentarios = codigo.replace(/\/\/.*$/gm, "");
    expect(semComentarios).not.toContain("requirePageAccess(");
  });
});
