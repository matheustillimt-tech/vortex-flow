import { cleanEnv } from "@/lib/env";
import { appUrl } from "@/lib/app-url";
import { APP_INITIALS, APP_NAME } from "@/lib/brand";

/**
 * Sistema simples de e-mail transacional via Resend.
 *
 * Configuração:
 *   - RESEND_API_KEY (obrigatória pra enviar)
 *   - EMAIL_FROM (ex: "Sua Empresa <nao-responda@seu-dominio.com.br>")
 *   - NEXT_PUBLIC_APP_URL (ex: "https://seu-dominio.com.br") — ver lib/app-url.ts
 *
 * Se RESEND_API_KEY não estiver presente, o envio é silenciosamente ignorado
 * (mas o restante do app continua funcionando).
 */

const RESEND_URL = "https://api.resend.com/emails";

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
  id?: string;
}> {
  const key = cleanEnv(process.env.RESEND_API_KEY);
  const from = cleanEnv(process.env.EMAIL_FROM) ?? `${APP_NAME} <onboarding@resend.dev>`;
  if (!key) {
    console.warn(
      "[email] RESEND_API_KEY ausente — e-mail ignorado:",
      args.subject
    );
    return { ok: false, skipped: true };
  }

  try {
    const r = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        html: args.html,
        reply_to: args.replyTo
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("[email] resend error:", data);
      return { ok: false, error: data?.message ?? "Falha ao enviar" };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error("[email] exception:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Erro" };
  }
}

// =====================================================
// Templates
// =====================================================

function baseHTML(title: string, body: string, ctaUrl?: string, ctaLabel?: string) {
  return `
  <!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;border-radius:10px;background:#6366f1;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${escapeHtml(APP_INITIALS)}</div>
        <h1 style="margin:0;font-size:18px;font-weight:600;">${escapeHtml(APP_NAME)}</h1>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
        <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;line-height:1.3;">${escapeHtml(title)}</h2>
        ${body}
        ${
          ctaUrl && ctaLabel
            ? `<div style="margin-top:24px;">
                <a href="${ctaUrl}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
              </div>`
            : ""
        }
      </div>
      <p style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center;">
        ${escapeHtml(APP_NAME)} · Gestão de projetos e tarefas da equipe
      </p>
    </div>
  </body>
  </html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inviteEmailHTML(args: {
  nome: string;
  email: string;
  password: string;
}) {
  return baseHTML(
    `Bem-vindo(a) ao ${APP_NAME}`,
    `
    <p style="margin:0 0 12px;color:#475569;">Olá <strong>${escapeHtml(args.nome)}</strong>,</p>
    <p style="margin:0 0 12px;color:#475569;">Você foi adicionado(a) ao ${escapeHtml(APP_NAME)}. Use o acesso abaixo para entrar:</p>
    <div style="margin:16px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;">
      <div><span style="color:#64748b;">E-mail:</span> <strong>${escapeHtml(args.email)}</strong></div>
      <div style="margin-top:6px;"><span style="color:#64748b;">Senha temporária:</span> <strong>${escapeHtml(args.password)}</strong></div>
    </div>
    <p style="margin:0 0 12px;color:#475569;font-size:13px;">No primeiro acesso você vai criar a sua própria senha e ativar a verificação em duas etapas.</p>
    `,
    `${appUrl()}/login`,
    "Entrar agora"
  );
}

export function forgotPasswordEmailHTML(args: {
  nome: string;
  code: string;
  resetUrl: string;
}) {
  return baseHTML(
    "Código para redefinir sua senha",
    `
    <p style="margin:0 0 12px;color:#475569;">Olá <strong>${escapeHtml(args.nome)}</strong>,</p>
    <p style="margin:0 0 12px;color:#475569;">Recebemos um pedido para redefinir a senha da sua conta no ${escapeHtml(APP_NAME)}.</p>
    <p style="margin:0 0 8px;color:#475569;">Use o código abaixo para criar uma nova senha:</p>
    <div style="margin:18px 0;padding:18px;background:#f8fafc;border:2px dashed #6366f1;border-radius:12px;text-align:center;">
      <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#1e293b;">
        ${escapeHtml(args.code)}
      </div>
      <p style="margin:8px 0 0;font-size:11px;color:#64748b;">Válido por 60 minutos</p>
    </div>
    <p style="margin:0 0 12px;color:#475569;font-size:13px;">Ou clique no botão abaixo — o código já vai preenchido:</p>
    <div style="margin:16px 0;padding:12px 14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;font-size:12px;color:#92400e;">
      ⚠️ Se você não pediu para trocar a senha, ignore este e-mail. Sua senha atual continua válida.
    </div>
    `,
    args.resetUrl,
    "Abrir página de redefinição"
  );
}

export function taskAssignedEmailHTML(args: {
  responsavelNome: string;
  taskTitle: string;
  projectName: string | null;
  priority: string;
  prazo: string | null;
  descricao?: string | null;
  projectId: string | null;
}) {
  const link = args.projectId
    ? `${appUrl()}/projetos/${args.projectId}`
    : `${appUrl()}/minha-area`;
  const prazoLine = args.prazo
    ? `<div><span style="color:#64748b;">Prazo:</span> <strong>${new Date(args.prazo).toLocaleDateString("pt-BR")}</strong></div>`
    : "";
  const descricaoBlock = args.descricao
    ? `<p style="margin:14px 0 0;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;color:#475569;font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(args.descricao)}</p>`
    : "";
  return baseHTML(
    "Nova tarefa atribuída a você",
    `
    <p style="margin:0 0 12px;color:#475569;">Olá <strong>${escapeHtml(args.responsavelNome)}</strong>,</p>
    <p style="margin:0 0 12px;color:#475569;">Você foi atribuído(a) a uma nova tarefa:</p>
    <div style="margin:16px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13px;">
      <div style="font-weight:600;font-size:15px;color:#0f172a;margin-bottom:6px;">${escapeHtml(args.taskTitle)}</div>
      ${args.projectName ? `<div><span style="color:#64748b;">Projeto:</span> <strong>${escapeHtml(args.projectName)}</strong></div>` : ""}
      <div><span style="color:#64748b;">Prioridade:</span> <strong>${escapeHtml(args.priority)}</strong></div>
      ${prazoLine}
    </div>
    ${descricaoBlock}
    `,
    link,
    `Abrir no ${APP_NAME}`
  );
}
