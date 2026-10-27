import { createClient } from "@/lib/supabase/client";
import type { ChatAttachment } from "@/lib/types";

const BUCKET = "chat-media";

/**
 * Upload de arquivo para o bucket chat-media e retorna o ChatAttachment.
 */
export async function uploadAttachment(
  file: File | Blob,
  opts: { type: ChatAttachment["type"]; userId: string; name?: string; duration?: number }
): Promise<ChatAttachment> {
  const supabase = createClient();
  const ext =
    "name" in file && file.name
      ? file.name.split(".").pop() ?? ""
      : (opts.type === "audio" ? "webm" : opts.type === "image" ? "png" : "bin");
  const safeName = opts.name ?? ("file" in file ? (file as File).name : `media.${ext}`);
  const key = `${opts.userId}/${Date.now()}-${crypto
    .randomUUID()
    .slice(0, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, file, {
      contentType: (file as File).type || undefined,
      upsert: false,
      cacheControl: "31536000"
    });
  if (error) throw error;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return {
    type: opts.type,
    url: pub.publicUrl,
    name: safeName,
    size: (file as File).size,
    mime: (file as File).type || undefined,
    duration: opts.duration
  };
}

/**
 * Insere mensagem em um canal.
 */
export async function sendMessage(args: {
  channelId: string;
  userId: string;
  content?: string | null;
  attachments?: ChatAttachment[];
  userMentions?: string[];
  taskMentions?: string[];
}) {
  const supabase = createClient();
  return await supabase
    .from("chat_messages")
    .insert({
      channel_id: args.channelId,
      user_id: args.userId,
      content: args.content?.trim() ? args.content : null,
      attachments: args.attachments ?? [],
      mentions: {
        users: args.userMentions ?? [],
        tasks: args.taskMentions ?? []
      }
    })
    .select()
    .single();
}

/**
 * Pega ou cria um canal direto (DM) com outro usuário.
 */
export async function getOrCreateDirectChannel(otherUserId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_or_create_direct_channel", {
    other_user: otherUserId
  });
  if (error) throw error;
  return data as string;
}

/**
 * Parse de texto contendo mentions no formato @[nome](user-id) e #[título](task-id).
 * Retorna array de segmentos para renderizar.
 */
export type ChatSegment =
  | { kind: "text"; value: string }
  | { kind: "user"; id: string; name: string }
  | { kind: "task"; id: string; title: string };

/**
 * Detecta se há um trigger @/# ativo antes do cursor (sem espaços no meio).
 * Útil para abrir dropdown inline ao digitar.
 */
export function detectMentionTrigger(
  text: string,
  cursor: number
): { kind: "@" | "#"; start: number; query: string } | null {
  let i = cursor - 1;
  while (i >= 0) {
    const c = text[i];
    if (c === " " || c === "\n" || c === "\t") return null;
    if (c === "@" || c === "#") {
      const before = i > 0 ? text[i - 1] : "";
      if (i === 0 || /\s/.test(before)) {
        return {
          kind: c as "@" | "#",
          start: i,
          query: text.slice(i + 1, cursor)
        };
      }
      return null;
    }
    i--;
  }
  return null;
}

export function parseChatContent(content: string | null | undefined): ChatSegment[] {
  if (!content) return [];
  const out: ChatSegment[] = [];
  let last = 0;
  const re = /(@\[[^\]]+\]\([0-9a-f-]+\))|(#\[[^\]]+\]\([0-9a-f-]+\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const start = m.index;
    if (start > last)
      out.push({ kind: "text", value: content.slice(last, start) });
    const token = m[0];
    const isUser = token.startsWith("@");
    const innerMatch = token.match(/\[([^\]]+)\]\(([0-9a-f-]+)\)/);
    if (innerMatch) {
      const [, label, id] = innerMatch;
      out.push(
        isUser
          ? { kind: "user", id, name: label }
          : { kind: "task", id, title: label }
      );
    }
    last = start + token.length;
  }
  if (last < content.length)
    out.push({ kind: "text", value: content.slice(last) });
  return out;
}
