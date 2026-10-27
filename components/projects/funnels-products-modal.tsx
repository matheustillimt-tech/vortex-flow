"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Edit3,
  Filter as FilterIcon,
  GitBranch,
  Layers,
  Package,
  Plus,
  Trash2
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TIER_COLOR,
  TIER_LABEL,
  type Funnel,
  type Product,
  type TicketTier
} from "@/lib/types";

const COLORS = [
  "#3b82f6", "#10b981", "#f97316", "#ec4899",
  "#a855f7", "#eab308", "#06b6d4", "#ef4444",
  "#6366f1", "#14b8a6"
];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onChanged?: () => void;
}

type Tab = "funis" | "produtos";

export function FunnelsProductsModal({ open, onClose, projectId, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>("funis");
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const [funnelForm, setFunnelForm] = useState<Partial<Funnel> | null>(null);
  const [productForm, setProductForm] = useState<Partial<Product> | null>(null);
  const [filterTier, setFilterTier] = useState<TicketTier | "">("");
  const [filterFunnel, setFilterFunnel] = useState<string>("");

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [f, p] = await Promise.all([
      supabase
        .from("funnels")
        .select("*")
        .eq("project_id", projectId)
        .order("ordem")
        .order("created_at"),
      supabase
        .from("products")
        .select("*")
        .eq("project_id", projectId)
        .order("nome")
    ]);
    setFunnels((f.data as Funnel[]) ?? []);
    setProducts((p.data as Product[]) ?? []);
    setLoading(false);
  }

  // ---------- FUNNELS ----------
  async function saveFunnel() {
    if (!funnelForm) return;
    if (!funnelForm.nome?.trim()) return toast.error("Nome é obrigatório");
    const supabase = createClient();
    const payload = {
      project_id: projectId,
      nome: funnelForm.nome.trim(),
      tier: funnelForm.tier || null,
      cor: funnelForm.cor || "#6366f1",
      descricao: funnelForm.descricao?.trim() || null,
      ordem: funnelForm.ordem ?? funnels.length
    };
    const { error } = funnelForm.id
      ? await supabase.from("funnels").update(payload).eq("id", funnelForm.id)
      : await supabase.from("funnels").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(funnelForm.id ? "Funil atualizado" : "Funil criado");
    setFunnelForm(null);
    await load();
    onChanged?.();
  }

  async function deleteFunnel(f: Funnel) {
    const products = await createClient()
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("funnel_id", f.id);
    if (!confirm(`Excluir "${f.nome}"? Tarefas vinculadas perdem o funil.`))
      return;
    const supabase = createClient();
    const { error } = await supabase.from("funnels").delete().eq("id", f.id);
    if (error) return toast.error(error.message);
    toast.success("Funil removido");
    await load();
    onChanged?.();
  }

  // ---------- PRODUCTS ----------
  async function saveProduct() {
    if (!productForm) return;
    if (!productForm.nome?.trim()) return toast.error("Nome é obrigatório");
    if (!productForm.tier) return toast.error("Selecione um tier");
    const supabase = createClient();
    const payload = {
      project_id: projectId,
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
    toast.success(productForm.id ? "Produto atualizado" : "Produto criado");
    setProductForm(null);
    await load();
    onChanged?.();
  }

  async function deleteProduct(p: Product) {
    if (!confirm(`Excluir "${p.nome}"?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Produto removido");
    await load();
    onChanged?.();
  }

  // -- filtered list de produtos
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (filterTier && p.tier !== filterTier) return false;
      if (filterFunnel && p.funnel_id !== filterFunnel) return false;
      return true;
    });
  }, [products, filterTier, filterFunnel]);

  return (
    <Modal open={open} onClose={onClose} title="Funis & Produtos" size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex border-b border-border -mx-6 px-6 -mt-2">
          {(["funis", "produtos"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
                tab === t
                  ? "border-brand text-fg"
                  : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {t === "funis" ? (
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5" /> Funis
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Produtos
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "funis" ? (
          <FunnelsList
            funnels={funnels}
            loading={loading}
            onNew={() =>
              setFunnelForm({ nome: "", tier: null, cor: COLORS[0], descricao: "" })
            }
            onEdit={(f) => setFunnelForm({ ...f })}
            onDelete={(f) => void deleteFunnel(f)}
            productsByFunnel={products.reduce<Record<string, number>>((acc, p) => {
              if (p.funnel_id) acc[p.funnel_id] = (acc[p.funnel_id] ?? 0) + 1;
              return acc;
            }, {})}
          />
        ) : (
          <ProductsList
            products={filteredProducts}
            funnels={funnels}
            loading={loading}
            filterTier={filterTier}
            setFilterTier={setFilterTier}
            filterFunnel={filterFunnel}
            setFilterFunnel={setFilterFunnel}
            onNew={() => setProductForm({ nome: "", tier: "low" })}
            onEdit={(p) => setProductForm({ ...p })}
            onDelete={(p) => void deleteProduct(p)}
          />
        )}

        {/* Form Funil inline */}
        {funnelForm && (
          <FunnelForm
            form={funnelForm}
            onChange={setFunnelForm}
            onSave={() => void saveFunnel()}
            onCancel={() => setFunnelForm(null)}
          />
        )}

        {/* Form Produto inline */}
        {productForm && (
          <ProductForm
            form={productForm}
            funnels={funnels}
            onChange={setProductForm}
            onSave={() => void saveProduct()}
            onCancel={() => setProductForm(null)}
          />
        )}
      </div>
    </Modal>
  );
}

function FunnelsList({
  funnels,
  loading,
  onNew,
  onEdit,
  onDelete,
  productsByFunnel
}: {
  funnels: Funnel[];
  loading: boolean;
  onNew: () => void;
  onEdit: (f: Funnel) => void;
  onDelete: (f: Funnel) => void;
  productsByFunnel: Record<string, number>;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">
          Funis representam etapas comerciais do projeto (lowticket, médio, highticket).
        </p>
        <Button size="sm" onClick={onNew}>
          <Plus className="w-3.5 h-3.5" /> Novo funil
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-fg-muted py-4">Carregando...</p>
      ) : funnels.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="Sem funis"
          description="Crie um funil para começar a organizar tarefas e produtos."
        />
      ) : (
        <ul className="border border-border rounded-xl overflow-hidden divide-y divide-border bg-bg">
          {funnels.map((f) => (
            <li
              key={f.id}
              className="px-4 py-3 flex items-center gap-3 hover:bg-bg-muted/50 group"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: f.cor }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{f.nome}</p>
                <p className="text-xs text-fg-subtle truncate">
                  {f.descricao || "Sem descrição"}
                </p>
              </div>
              {f.tier && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: TIER_COLOR[f.tier] + "20",
                    color: TIER_COLOR[f.tier]
                  }}
                >
                  {TIER_LABEL[f.tier]}
                </span>
              )}
              <span className="text-xs text-fg-subtle">
                {productsByFunnel[f.id] ?? 0} produto(s)
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => onEdit(f)}
                  className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onDelete(f)}
                  className="p-1.5 rounded-md hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function FunnelForm({
  form,
  onChange,
  onSave,
  onCancel
}: {
  form: Partial<Funnel>;
  onChange: (v: Partial<Funnel>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="border border-brand/40 rounded-xl p-4 space-y-3 bg-brand-subtle/30">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">
        {form.id ? "Editar funil" : "Novo funil"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Nome">
          <Input
            value={form.nome ?? ""}
            onChange={(e) => onChange({ ...form, nome: e.target.value })}
            placeholder="Ex: Lowticket"
            autoFocus
          />
        </FormField>
        <FormField label="Tier">
          <Select
            value={form.tier ?? ""}
            onChange={(e) =>
              onChange({ ...form, tier: (e.target.value || null) as TicketTier | null })
            }
          >
            <option value="">— sem tier</option>
            {(Object.keys(TIER_LABEL) as TicketTier[]).map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Descrição">
        <Textarea
          value={form.descricao ?? ""}
          onChange={(e) => onChange({ ...form, descricao: e.target.value })}
          placeholder="Para que serve este funil?"
        />
      </FormField>
      <FormField label="Cor">
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...form, cor: c })}
              className={`w-6 h-6 rounded-md border-2 transition ${
                form.cor === c ? "border-fg scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </FormField>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onSave}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

function ProductsList({
  products,
  funnels,
  loading,
  filterTier,
  setFilterTier,
  filterFunnel,
  setFilterFunnel,
  onNew,
  onEdit,
  onDelete
}: {
  products: Product[];
  funnels: Funnel[];
  loading: boolean;
  filterTier: TicketTier | "";
  setFilterTier: (v: TicketTier | "") => void;
  filterFunnel: string;
  setFilterFunnel: (v: string) => void;
  onNew: () => void;
  onEdit: (p: Product) => void;
  onDelete: (p: Product) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <FilterIcon className="w-3.5 h-3.5 text-fg-subtle" />
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value as TicketTier | "")}
            className="px-2.5 py-1 bg-bg border border-border rounded-md text-xs"
          >
            <option value="">Todos os tiers</option>
            <option value="low">Lowticket</option>
            <option value="medio">Médio ticket</option>
            <option value="high">Highticket</option>
          </select>
          <select
            value={filterFunnel}
            onChange={(e) => setFilterFunnel(e.target.value)}
            className="px-2.5 py-1 bg-bg border border-border rounded-md text-xs"
          >
            <option value="">Todos os funis</option>
            {funnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" onClick={onNew}>
          <Plus className="w-3.5 h-3.5" /> Novo produto
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-fg-muted py-4">Carregando...</p>
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Sem produtos"
          description="Cadastre produtos e atribua a um funil específico."
        />
      ) : (
        <ul className="border border-border rounded-xl overflow-hidden divide-y divide-border bg-bg">
          {products.map((p) => {
            const funnel = funnels.find((f) => f.id === p.funnel_id);
            return (
              <li
                key={p.id}
                className="px-4 py-3 flex items-center gap-3 hover:bg-bg-muted/50 group"
              >
                <Layers className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{p.nome}</p>
                  <p className="text-xs text-fg-subtle truncate">
                    {funnel?.nome ?? "Sem funil"} ·{" "}
                    {p.descricao || "Sem descrição"}
                  </p>
                </div>
                <span
                  className="text-[10px] px-2 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: TIER_COLOR[p.tier] + "20",
                    color: TIER_COLOR[p.tier]
                  }}
                >
                  {TIER_LABEL[p.tier]}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => onEdit(p)}
                    className="p-1.5 rounded-md hover:bg-bg-muted text-fg-muted hover:text-fg"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(p)}
                    className="p-1.5 rounded-md hover:bg-priority-urgent/15 text-fg-muted hover:text-priority-urgent"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ProductForm({
  form,
  funnels,
  onChange,
  onSave,
  onCancel
}: {
  form: Partial<Product>;
  funnels: Funnel[];
  onChange: (v: Partial<Product>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Quando troca o tier, limpa funnel se não for compatível
  const filteredFunnels = funnels.filter(
    (f) => !f.tier || !form.tier || f.tier === form.tier
  );
  return (
    <div className="border border-brand/40 rounded-xl p-4 space-y-3 bg-brand-subtle/30">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">
        {form.id ? "Editar produto" : "Novo produto"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Nome">
          <Input
            value={form.nome ?? ""}
            onChange={(e) => onChange({ ...form, nome: e.target.value })}
            placeholder="Ex: Curso de confeitaria"
            autoFocus
          />
        </FormField>
        <FormField label="Tier *">
          <Select
            value={form.tier ?? ""}
            onChange={(e) => {
              const newTier = e.target.value as TicketTier;
              const funnel = funnels.find((f) => f.id === form.funnel_id);
              const keepFunnel = !funnel?.tier || funnel.tier === newTier;
              onChange({
                ...form,
                tier: newTier,
                funnel_id: keepFunnel ? form.funnel_id : null
              });
            }}
          >
            <option value="" disabled>
              Selecione
            </option>
            <option value="low">Lowticket</option>
            <option value="medio">Médio ticket</option>
            <option value="high">Highticket</option>
          </Select>
        </FormField>
        <FormField
          label="Funil"
          hint={
            form.tier
              ? "Apenas funis compatíveis com o tier selecionado"
              : undefined
          }
        >
          <Select
            value={form.funnel_id ?? ""}
            onChange={(e) =>
              onChange({ ...form, funnel_id: e.target.value || null })
            }
          >
            <option value="">— sem funil</option>
            {filteredFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.tier ? ` (${TIER_LABEL[f.tier]})` : ""}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label="Descrição">
        <Textarea
          value={form.descricao ?? ""}
          onChange={(e) => onChange({ ...form, descricao: e.target.value })}
          placeholder="Detalhes do produto"
        />
      </FormField>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onSave}>
          Salvar
        </Button>
      </div>
    </div>
  );
}
