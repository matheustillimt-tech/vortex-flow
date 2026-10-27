"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Check,
  Cloud,
  Edit3,
  GitBranch,
  Package,
  Plus,
  Sparkles,
  Trash2,
  X as XIcon
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TIER_COLOR,
  TIER_LABEL,
  type Funnel,
  type Product,
  type Project,
  type ProjectStatus,
  type ProjectTipo,
  type TaskPriority,
  type TicketTier
} from "@/lib/types";

const COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#ec4899",
  "#f97316", "#eab308", "#6366f1", "#06b6d4"
];

const FUNNEL_COLORS = [
  "#3b82f6", "#10b981", "#f97316", "#ec4899",
  "#a855f7", "#eab308", "#06b6d4", "#ef4444"
];

export function ProjectModal({
  open,
  onClose,
  project,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  /** mantidos por compat — não usados mais */
  sectors?: unknown;
  users?: unknown;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    nome: "",
    descricao: "",
    status: "ativo" as ProjectStatus,
    prioridade: "media" as TaskPriority,
    cor: COLORS[0],
    tipo: "infoproduto" as ProjectTipo
  });
  const [saving, setSaving] = useState(false);

  // ---------- Funis & Produtos (carregado só em modo edição) ----------
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [funnelForm, setFunnelForm] = useState<Partial<Funnel> | null>(null);
  const [productForm, setProductForm] = useState<Partial<Product> | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        nome: project?.nome ?? "",
        descricao: project?.descricao ?? "",
        status: project?.status ?? "ativo",
        prioridade: project?.prioridade ?? "media",
        cor: project?.cor ?? COLORS[0],
        tipo: (project?.tipo ?? "infoproduto") as ProjectTipo
      });
      setFunnelForm(null);
      setProductForm(null);
      if (project) void loadFunnelsProducts(project.id);
      else {
        setFunnels([]);
        setProducts([]);
      }
    }
  }, [open, project]);

  async function loadFunnelsProducts(projectId: string) {
    const supabase = createClient();
    const [f, p] = await Promise.all([
      supabase.from("funnels").select("*").eq("project_id", projectId).order("ordem"),
      supabase.from("products").select("*").eq("project_id", projectId).order("nome")
    ]);
    setFunnels((f.data as Funnel[]) ?? []);
    setProducts((p.data as Product[]) ?? []);
  }

  async function save() {
    if (!form.nome.trim()) return toast.error("Nome é obrigatório");
    setSaving(true);
    const supabase = createClient();
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      status: form.status,
      prioridade: form.prioridade,
      cor: form.cor,
      tipo: form.tipo
    };

    if (project) {
      const { error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", project.id);
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
    } else {
      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select()
        .single();
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
      const projectId = (data as Project).id;
      // criar mapa default
      await supabase.from("maps").insert({
        nome: "Mapa do projeto",
        scope: "project",
        project_id: projectId,
        is_default: true
      });
    }
    setSaving(false);
    toast.success(project ? "Projeto atualizado" : "Projeto criado");
    onSaved();
  }

  // ---------- Funnel CRUD ----------
  async function saveFunnel() {
    if (!project || !funnelForm) return;
    if (!funnelForm.nome?.trim()) return toast.error("Nome do funil");
    const supabase = createClient();
    const payload = {
      project_id: project.id,
      nome: funnelForm.nome.trim(),
      tier: funnelForm.tier || null,
      cor: funnelForm.cor || FUNNEL_COLORS[0],
      ordem: funnelForm.ordem ?? funnels.length
    };
    const { error } = funnelForm.id
      ? await supabase.from("funnels").update(payload).eq("id", funnelForm.id)
      : await supabase.from("funnels").insert(payload);
    if (error) return toast.error(error.message);
    setFunnelForm(null);
    await loadFunnelsProducts(project.id);
    toast.success("Funil salvo");
  }

  async function deleteFunnel(f: Funnel) {
    if (!confirm(`Excluir funil "${f.nome}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("funnels").delete().eq("id", f.id);
    if (error) return toast.error(error.message);
    if (project) await loadFunnelsProducts(project.id);
  }

  // ---------- Product CRUD ----------
  async function saveProduct() {
    if (!project || !productForm) return;
    if (!productForm.nome?.trim()) return toast.error("Nome do produto");
    if (!productForm.tier) return toast.error("Tier obrigatório (low/medio/high)");
    const supabase = createClient();
    const payload = {
      project_id: project.id,
      nome: productForm.nome.trim(),
      tier: productForm.tier,
      funnel_id: productForm.funnel_id || null,
      cor: productForm.cor || null,
      descricao: productForm.descricao?.trim() || null
    };
    const { error } = productForm.id
      ? await supabase.from("products").update(payload).eq("id", productForm.id)
      : await supabase.from("products").insert(payload);
    if (error) return toast.error(error.message);
    setProductForm(null);
    await loadFunnelsProducts(project.id);
    toast.success("Produto salvo");
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Excluir produto "${p.nome}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    if (project) await loadFunnelsProducts(project.id);
  }

  async function updateProductFunnel(p: Product, funnelId: string | null) {
    const supabase = createClient();
    setProducts((prev) =>
      prev.map((pp) => (pp.id === p.id ? { ...pp, funnel_id: funnelId } : pp))
    );
    await supabase
      .from("products")
      .update({ funnel_id: funnelId })
      .eq("id", p.id);
  }

  const productsByFunnel = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const k = p.funnel_id ?? "_none";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [products]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Editar projeto" : "Novo projeto"}
      size="lg"
    >
      <div className="space-y-5">
        {/* ---------- Tipo de projeto ---------- */}
        <div>
          <p className="text-[11px] font-medium text-fg-muted uppercase tracking-wider mb-2">
            Tipo de projeto
          </p>
          <div className="grid grid-cols-3 gap-2">
            <TipoCard
              active={form.tipo === "infoproduto"}
              onClick={() =>
                !project && setForm({ ...form, tipo: "infoproduto" })
              }
              disabled={!!project}
              icon={Sparkles}
              label="Infoproduto"
              hint="Com funis e tickets low/médio/high"
            />
            <TipoCard
              active={form.tipo === "saas"}
              onClick={() => !project && setForm({ ...form, tipo: "saas" })}
              disabled={!!project}
              icon={Cloud}
              label="SaaS"
              hint="Apenas mapa mental de tarefas"
            />
            <TipoCard
              active={form.tipo === "produto_fisico"}
              onClick={() =>
                !project && setForm({ ...form, tipo: "produto_fisico" })
              }
              disabled={!!project}
              icon={Box}
              label="Produto físico"
              hint="Apenas mapa mental de tarefas"
            />
          </div>
          {project && (
            <p className="text-[10px] text-fg-subtle mt-1.5 italic">
              O tipo não pode ser alterado depois da criação.
            </p>
          )}
        </div>

        {/* ---------- Dados básicos ---------- */}
        <div className="space-y-4">
          <FormField label="Nome">
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder={
                form.tipo === "infoproduto"
                  ? "Ex: Curso de confeitaria"
                  : form.tipo === "saas"
                    ? "Ex: App de agendamento"
                    : "Ex: Linha de cosméticos"
              }
              autoFocus
            />
          </FormField>
          <FormField label="Descrição">
            <Textarea
              value={form.descricao}
              onChange={(e) =>
                setForm({ ...form, descricao: e.target.value })
              }
              placeholder="Sobre o que é este projeto?"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as ProjectStatus })
                }
              >
                {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Prioridade">
              <Select
                value={form.prioridade}
                onChange={(e) =>
                  setForm({
                    ...form,
                    prioridade: e.target.value as TaskPriority
                  })
                }
              >
                {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField label="Cor">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, cor: c })}
                  className={`w-7 h-7 rounded-lg border-2 transition ${
                    form.cor === c ? "border-fg scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </FormField>
        </div>

        {/* ---------- Funis & Produtos (só edição E só infoproduto) ---------- */}
        {project && form.tipo === "infoproduto" && (
          <div className="border-t border-border pt-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="w-4 h-4 text-fg-muted" />
              <h3 className="text-sm font-semibold">Funis</h3>
              <span className="text-xs text-fg-subtle">({funnels.length})</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setFunnelForm({
                    nome: "",
                    tier: null,
                    cor: FUNNEL_COLORS[funnels.length % FUNNEL_COLORS.length]
                  })
                }
                className="ml-auto"
              >
                <Plus className="w-3 h-3" /> Funil
              </Button>
            </div>

            {funnels.length === 0 ? (
              <p className="text-xs text-fg-subtle text-center py-3 border border-dashed border-border rounded-lg">
                Nenhum funil. Crie um para começar.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {funnels.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 px-3 py-2 bg-bg border border-border rounded-lg"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: f.cor }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{f.nome}</p>
                      {f.tier && (
                        <p
                          className="text-[10px] font-medium"
                          style={{ color: TIER_COLOR[f.tier] }}
                        >
                          {TIER_LABEL[f.tier]}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-fg-subtle px-1.5 py-0.5 rounded bg-bg-muted">
                      {(productsByFunnel.get(f.id) ?? []).length} produto(s)
                    </span>
                    <button
                      onClick={() => setFunnelForm({ ...f })}
                      className="p-1 text-fg-subtle hover:text-fg"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteFunnel(f)}
                      className="p-1 text-fg-subtle hover:text-priority-urgent"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Funnel form inline */}
            {funnelForm && (
              <div className="bg-bg-muted border border-border rounded-xl p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Nome">
                    <Input
                      value={funnelForm.nome ?? ""}
                      onChange={(e) =>
                        setFunnelForm({ ...funnelForm, nome: e.target.value })
                      }
                      placeholder="Ex: Lowticket"
                      autoFocus
                    />
                  </FormField>
                  <FormField label="Tier">
                    <Select
                      value={funnelForm.tier ?? ""}
                      onChange={(e) =>
                        setFunnelForm({
                          ...funnelForm,
                          tier: (e.target.value || null) as TicketTier | null
                        })
                      }
                    >
                      <option value="">—</option>
                      <option value="low">Lowticket</option>
                      <option value="medio">Médio ticket</option>
                      <option value="high">Highticket</option>
                    </Select>
                  </FormField>
                </div>
                <FormField label="Cor">
                  <div className="flex flex-wrap gap-1.5">
                    {FUNNEL_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setFunnelForm({ ...funnelForm, cor: c })
                        }
                        className={`w-6 h-6 rounded-md border-2 transition ${
                          funnelForm.cor === c
                            ? "border-fg scale-110"
                            : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </FormField>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFunnelForm(null)}
                  >
                    <XIcon className="w-3.5 h-3.5" /> Cancelar
                  </Button>
                  <Button size="sm" onClick={() => void saveFunnel()}>
                    <Check className="w-3.5 h-3.5" /> Salvar funil
                  </Button>
                </div>
              </div>
            )}

            {/* ----------- Produtos ----------- */}
            <div className="flex items-center gap-2 mb-1 pt-2">
              <Package className="w-4 h-4 text-fg-muted" />
              <h3 className="text-sm font-semibold">Produtos</h3>
              <span className="text-xs text-fg-subtle">({products.length})</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setProductForm({ nome: "", tier: "low" })}
                className="ml-auto"
              >
                <Plus className="w-3 h-3" /> Produto
              </Button>
            </div>

            {products.length === 0 ? (
              <p className="text-xs text-fg-subtle text-center py-3 border border-dashed border-border rounded-lg">
                Nenhum produto. Crie um e vincule a um funil.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {products.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2 bg-bg border border-border rounded-lg"
                  >
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        backgroundColor: TIER_COLOR[p.tier] + "20",
                        color: TIER_COLOR[p.tier]
                      }}
                    >
                      {TIER_LABEL[p.tier]}
                    </span>
                    <p className="text-sm font-medium flex-1 truncate">
                      {p.nome}
                    </p>
                    <Select
                      value={p.funnel_id ?? ""}
                      onChange={(e) =>
                        updateProductFunnel(p, e.target.value || null)
                      }
                      className="text-xs max-w-[160px]"
                    >
                      <option value="">— Sem funil —</option>
                      {funnels.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </Select>
                    <button
                      onClick={() => setProductForm({ ...p })}
                      className="p-1 text-fg-subtle hover:text-fg"
                      title="Editar"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteProduct(p)}
                      className="p-1 text-fg-subtle hover:text-priority-urgent"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Product form inline */}
            {productForm && (
              <div className="bg-bg-muted border border-border rounded-xl p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Nome">
                    <Input
                      value={productForm.nome ?? ""}
                      onChange={(e) =>
                        setProductForm({
                          ...productForm,
                          nome: e.target.value
                        })
                      }
                      placeholder="Nome do produto"
                      autoFocus
                    />
                  </FormField>
                  <FormField label="Tier">
                    <Select
                      value={productForm.tier ?? ""}
                      onChange={(e) =>
                        setProductForm({
                          ...productForm,
                          tier: e.target.value as TicketTier
                        })
                      }
                    >
                      <option value="low">Lowticket</option>
                      <option value="medio">Médio ticket</option>
                      <option value="high">Highticket</option>
                    </Select>
                  </FormField>
                  <FormField label="Vincular a funil">
                    <Select
                      value={productForm.funnel_id ?? ""}
                      onChange={(e) =>
                        setProductForm({
                          ...productForm,
                          funnel_id: e.target.value || null
                        })
                      }
                    >
                      <option value="">— Nenhum —</option>
                      {funnels.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                <FormField label="Descrição (opcional)">
                  <Textarea
                    value={productForm.descricao ?? ""}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        descricao: e.target.value
                      })
                    }
                  />
                </FormField>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setProductForm(null)}
                  >
                    <XIcon className="w-3.5 h-3.5" /> Cancelar
                  </Button>
                  <Button size="sm" onClick={() => void saveProduct()}>
                    <Check className="w-3.5 h-3.5" /> Salvar produto
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {!project && form.tipo === "infoproduto" && (
          <p className="text-xs text-fg-subtle italic">
            Funis e produtos podem ser cadastrados depois de criar o projeto.
          </p>
        )}
        {!project && form.tipo !== "infoproduto" && (
          <p className="text-xs text-fg-subtle italic">
            Este projeto será apenas um mapa mental para organizar tarefas —
            sem funis nem produtos.
          </p>
        )}
        {project && form.tipo !== "infoproduto" && (
          <p className="text-xs text-fg-subtle italic border-t border-border pt-4">
            Este projeto é {form.tipo === "saas" ? "um SaaS" : "um produto físico"}
            {" "}— funis e produtos não se aplicam.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TipoCard({
  active,
  onClick,
  disabled,
  icon: Icon,
  label,
  hint
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`text-left rounded-xl border p-3 transition ${
        active
          ? "border-brand bg-brand-subtle/50 text-brand"
          : "border-border bg-bg-subtle text-fg-muted hover:border-border-strong hover:text-fg"
      } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4" />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="text-[10px] leading-tight opacity-80">{hint}</p>
    </button>
  );
}
