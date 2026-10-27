"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { invalidate } from "@/lib/cache";
import { initials } from "@/lib/utils";
import {
  UFS,
  fromWhatsappE164,
  isValidCPF,
  maskCEP,
  maskCPF,
  maskTelefone,
  onlyDigits,
  toWhatsappE164,
  validateChavePix,
  validateWhatsapp
} from "@/lib/br-validations";
import type {
  ColaboradorDados,
  Sector,
  TipoChavePix,
  UserProfile
} from "@/lib/types";

interface Props {
  /** Perfil a editar. No popup é sempre o próprio usuário. */
  user: UserProfile;
  sectors: Sector[];
  /** Chamado após salvar com sucesso. */
  onSaved: () => void;
  /** No popup obrigatório não existe "cancelar". */
  onCancel?: () => void;
  /** Texto do botão principal. */
  submitLabel?: string;
}

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_MB = 5;

export function CadastroForm({
  user,
  sectors,
  onSaved,
  onCancel,
  submitLabel = "Salvar cadastro"
}: Props) {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // users
  const [nome, setNome] = useState(user.nome ?? "");
  const [cargo, setCargo] = useState(user.cargo ?? "");
  const [setorId, setSetorId] = useState(user.setor_principal_id ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [uploading, setUploading] = useState(false);

  // colaborador_dados
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cep, setCep] = useState("");
  const [logradouro, setLogradouro] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [tipoPix, setTipoPix] = useState<TipoChavePix | "">("");
  const [chavePix, setChavePix] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  useEffect(() => {
    void loadDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function loadDados() {
    setLoading(true);
    const { data } = await supabase
      .from("colaborador_dados")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    const d = data as ColaboradorDados | null;
    if (d) {
      setCpf(d.cpf ? maskCPF(d.cpf) : "");
      setNascimento(d.data_nascimento ?? "");
      setWhatsapp(d.whatsapp ? maskTelefone(fromWhatsappE164(d.whatsapp)) : "");
      setCep(d.cep ? maskCEP(d.cep) : "");
      setLogradouro(d.logradouro ?? "");
      setNumero(d.numero ?? "");
      setComplemento(d.complemento ?? "");
      setBairro(d.bairro ?? "");
      setCidade(d.cidade ?? "");
      setEstado(d.estado ?? "");
      setTipoPix(d.tipo_chave_pix ?? "");
      setChavePix(d.chave_pix ?? "");
    }
    setLoading(false);
  }

  /** Busca endereço no ViaCEP ao completar 8 dígitos. */
  async function handleCepBlur() {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const json = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (!json.erro) {
        if (json.logradouro) setLogradouro(json.logradouro);
        if (json.bairro) setBairro(json.bairro);
        if (json.localidade) setCidade(json.localidade);
        if (json.uf) setEstado(json.uf);
      }
    } catch {
      // Sem internet ou ViaCEP fora — usuário preenche na mão.
    }
    setCepLoading(false);
  }

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      toast.error(`A foto deve ter no máximo ${MAX_AVATAR_MB}MB.`);
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(false);
      toast.error("Falha ao enviar a foto: " + error.message);
      return;
    }
    const { data: pub } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path);
    setAvatarUrl(pub.publicUrl);
    setUploading(false);
    toast.success("Foto carregada. Não esqueça de salvar.");
  }

  function validate(): string | null {
    if (!nome.trim()) return "Informe seu nome completo.";
    if (!cpf.trim()) return "Informe seu CPF.";
    if (!isValidCPF(cpf)) return "CPF inválido — confira os números.";
    if (!nascimento) return "Informe sua data de nascimento.";
    // Sanidade: nascimento não pode ser no futuro nem absurdo
    const nasc = new Date(nascimento);
    const hoje = new Date();
    if (nasc > hoje) return "Data de nascimento não pode ser no futuro.";
    if (hoje.getFullYear() - nasc.getFullYear() > 120)
      return "Data de nascimento inválida.";
    const zapErr = validateWhatsapp(whatsapp);
    if (zapErr) return zapErr;
    if (!cargo.trim()) return "Informe sua função.";
    if (!setorId) return "Selecione seu setor.";
    if (onlyDigits(cep).length !== 8) return "Informe um CEP válido.";
    if (!logradouro.trim()) return "Informe o endereço (rua/avenida).";
    if (!numero.trim()) return "Informe o número.";
    if (!bairro.trim()) return "Informe o bairro.";
    if (!cidade.trim()) return "Informe a cidade.";
    if (!estado) return "Selecione o estado.";
    if (!tipoPix) return "Selecione o tipo da chave PIX.";
    const pixErr = validateChavePix(tipoPix, chavePix);
    if (pixErr) return pixErr;
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);

    // 1) Dados públicos no perfil
    const { error: uErr } = await supabase
      .from("users")
      .update({
        nome: nome.trim(),
        cargo: cargo.trim(),
        setor_principal_id: setorId,
        avatar_url: avatarUrl || null,
        cadastro_completo: true
      })
      .eq("id", user.id);
    if (uErr) {
      setSaving(false);
      toast.error("Erro ao salvar perfil: " + uErr.message);
      return;
    }

    // 2) Dados sensíveis (tabela protegida por RLS)
    const { error: cErr } = await supabase.from("colaborador_dados").upsert(
      {
        user_id: user.id,
        cpf: onlyDigits(cpf),
        data_nascimento: nascimento,
        whatsapp: toWhatsappE164(whatsapp),
        cep: onlyDigits(cep),
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        complemento: complemento.trim() || null,
        bairro: bairro.trim(),
        cidade: cidade.trim(),
        estado,
        tipo_chave_pix: tipoPix,
        chave_pix: chavePix.trim(),
        preenchido_em: new Date().toISOString()
      },
      { onConflict: "user_id" }
    );
    if (cErr) {
      setSaving(false);
      // CPF duplicado cai aqui (índice único)
      if (cErr.code === "23505") {
        toast.error("Esse CPF já está cadastrado para outro colaborador.");
      } else {
        toast.error("Erro ao salvar dados: " + cErr.message);
      }
      // Reverte a flag pra não travar o usuário num estado inconsistente
      await supabase
        .from("users")
        .update({ cadastro_completo: false })
        .eq("id", user.id);
      return;
    }

    invalidate("users");
    invalidate("me");
    setSaving(false);
    toast.success("Cadastro salvo. Obrigado!");
    onSaved();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Aviso de privacidade */}
      <div className="flex items-start gap-2 text-[11px] text-fg-muted bg-bg-subtle border border-border rounded-lg p-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-status-done shrink-0 mt-0.5" />
        <span>
          Seu <strong className="text-fg">CPF, WhatsApp, endereço e chave PIX</strong> são
          visíveis apenas para você e para os administradores do financeiro.
          Nenhum outro colaborador tem acesso.
        </span>
      </div>

      {/* Foto */}
      <div className="flex items-center gap-4">
        <div className="relative">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={nome}
              className="w-20 h-20 rounded-full object-cover border-2 border-border"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-brand/15 text-brand flex items-center justify-center text-xl font-bold uppercase border-2 border-border">
              {initials(nome || user.email)}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-brand hover:bg-brand-hover text-white flex items-center justify-center shadow-md disabled:opacity-60"
            title="Trocar foto"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Camera className="w-3.5 h-3.5" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarPick}
            className="hidden"
          />
        </div>
        <div className="text-xs text-fg-muted">
          <p className="font-medium text-fg mb-0.5">Foto de perfil</p>
          <p>JPG ou PNG, até {MAX_AVATAR_MB}MB.</p>
        </div>
      </div>

      {/* Dados pessoais */}
      <Section title="Dados pessoais">
        <Grid>
          <FieldWrap label="Nome completo" required className="col-span-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Seu nome completo"
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="CPF" required>
            <input
              value={cpf}
              onChange={(e) => setCpf(maskCPF(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Data de nascimento" required>
            <input
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="WhatsApp" required className="col-span-2">
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(maskTelefone(e.target.value))}
              placeholder="(00) 00000-0000"
              inputMode="tel"
              className={inputCls}
            />
            <p className="text-[11px] text-fg-subtle mt-1">
              Usado para avisar você no WhatsApp quando receber uma tarefa nova.
            </p>
          </FieldWrap>
          <FieldWrap label="E-mail" className="col-span-2">
            <div className="relative">
              <input
                value={user.email}
                readOnly
                disabled
                className={`${inputCls} pr-8 opacity-70 cursor-not-allowed`}
              />
              <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
            </div>
            <p className="text-[11px] text-fg-subtle mt-1">
              É o seu login — para alterar, fale com um administrador.
            </p>
          </FieldWrap>
        </Grid>
      </Section>

      {/* Função e setor */}
      <Section title="Função na empresa">
        <Grid>
          <FieldWrap label="Função / cargo" required>
            <input
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder="Ex: Gestor de tráfego"
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Setor" required>
            <select
              value={setorId}
              onChange={(e) => setSetorId(e.target.value)}
              className={inputCls}
            >
              <option value="">Selecione...</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          </FieldWrap>
        </Grid>
      </Section>

      {/* Endereço */}
      <Section title="Endereço">
        <Grid>
          <FieldWrap label="CEP" required>
            <div className="relative">
              <input
                value={cep}
                onChange={(e) => setCep(maskCEP(e.target.value))}
                onBlur={handleCepBlur}
                placeholder="00000-000"
                inputMode="numeric"
                className={inputCls}
              />
              {cepLoading && (
                <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-fg-subtle" />
              )}
            </div>
          </FieldWrap>
          <FieldWrap label="Número" required>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="123"
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Rua / Avenida" required className="col-span-2">
            <input
              value={logradouro}
              onChange={(e) => setLogradouro(e.target.value)}
              placeholder="Preenche sozinho pelo CEP"
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Complemento">
            <input
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              placeholder="Apto, bloco..."
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Bairro" required>
            <input
              value={bairro}
              onChange={(e) => setBairro(e.target.value)}
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Cidade" required>
            <input
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              className={inputCls}
            />
          </FieldWrap>
          <FieldWrap label="Estado" required>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className={inputCls}
            >
              <option value="">UF</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </FieldWrap>
        </Grid>
      </Section>

      {/* PIX */}
      <Section title="Dados para pagamento">
        <Grid>
          <FieldWrap label="Tipo da chave PIX" required>
            <select
              value={tipoPix}
              onChange={(e) => {
                setTipoPix(e.target.value as TipoChavePix | "");
                setChavePix("");
              }}
              className={inputCls}
            >
              <option value="">Selecione...</option>
              <option value="cpf">CPF</option>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
          </FieldWrap>
          <FieldWrap label="Chave PIX" required>
            <input
              value={chavePix}
              onChange={(e) => {
                const v = e.target.value;
                if (tipoPix === "cpf") setChavePix(maskCPF(v));
                else if (tipoPix === "telefone") setChavePix(maskTelefone(v));
                else setChavePix(v);
              }}
              placeholder={
                tipoPix === "cpf"
                  ? "000.000.000-00"
                  : tipoPix === "email"
                    ? "voce@email.com"
                    : tipoPix === "telefone"
                      ? "(00) 00000-0000"
                      : tipoPix === "aleatoria"
                        ? "00000000-0000-0000-0000-000000000000"
                        : "Escolha o tipo primeiro"
              }
              disabled={!tipoPix}
              className={`${inputCls} disabled:opacity-60`}
            />
          </FieldWrap>
        </Grid>
        {tipoPix === "cpf" && cpf && chavePix && onlyDigits(cpf) !== onlyDigits(chavePix) && (
          <p className="text-[11px] text-priority-medium mt-1.5">
            Atenção: a chave PIX está diferente do CPF informado acima.
          </p>
        )}
      </Section>

      {/* Ações */}
      <div className="flex gap-2 justify-end pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving || uploading}
          className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function FieldWrap({
  label,
  required,
  className,
  children
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-medium text-fg-muted mb-1">
        {label}
        {required && <span className="text-status-blocked ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
