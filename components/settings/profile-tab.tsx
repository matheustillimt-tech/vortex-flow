"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { FormField, Input, Select } from "@/components/ui/input";
import type { Sector, UserProfile } from "@/lib/types";

export function ProfileTab() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const [meRes, sRes] = await Promise.all([
      supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("sectors").select("*").eq("status", "ativo").order("nome")
    ]);
    setMe((meRes.data as UserProfile) ?? null);
    setSectors((sRes.data as Sector[]) ?? []);
    setLoading(false);
  }

  async function updateMe(patch: Partial<UserProfile>) {
    if (!me) return;
    const supabase = createClient();
    setMe({ ...me, ...patch });
    const { error } = await supabase
      .from("users")
      .update(patch)
      .eq("id", me.id);
    if (error) toast.error(error.message);
  }

  if (loading || !me)
    return <p className="p-6 text-sm text-fg-muted">Carregando...</p>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="bg-bg-subtle border border-border rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Nome">
          <Input
            value={me.nome}
            onChange={(e) => setMe({ ...me, nome: e.target.value })}
            onBlur={() => updateMe({ nome: me.nome })}
          />
        </FormField>
        <FormField label="Cargo">
          <Input
            value={me.cargo ?? ""}
            onChange={(e) => setMe({ ...me, cargo: e.target.value })}
            onBlur={() => updateMe({ cargo: me.cargo })}
            placeholder="Ex: Gestor de Tráfego"
          />
        </FormField>
        <FormField label="Setor principal">
          <Select
            value={me.setor_principal_id ?? ""}
            onChange={(e) =>
              updateMe({ setor_principal_id: e.target.value || null })
            }
          >
            <option value="">—</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="E-mail">
          <Input value={me.email} disabled />
        </FormField>
      </div>
    </div>
  );
}
