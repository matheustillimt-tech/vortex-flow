"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Building2,
  Hash,
  Image as ImageIcon,
  Layers,
  Mic,
  Paperclip,
  Send,
  Square,
  Trash2,
  Users as UsersIcon,
  Video as VideoIcon
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  parseChatContent,
  sendMessage,
  uploadAttachment,
  type ChatSegment
} from "@/lib/chat";
import { cn, initials } from "@/lib/utils";
import { ChatEditor, type ChatEditorHandle } from "@/components/chat/chat-editor";
import type {
  ChatAttachment,
  ChatChannel,
  ChatMessage,
  Project,
  Sector,
  Task,
  UserProfile
} from "@/lib/types";
import { MentionPicker } from "@/components/chat/mention-picker";
import { InlineMentionsDropdown } from "@/components/chat/inline-mentions";

interface Props {
  channelId: string;
  channels: ChatChannel[];
  sectors: Sector[];
  users: UserProfile[];
  me: UserProfile;
  directs: Array<{ channel: ChatChannel; other: UserProfile | null }>;
  onOpenTask: (taskId: string) => void;
}

export function ChatRoom({
  channelId,
  channels,
  sectors,
  users,
  me,
  directs,
  onOpenTask
}: Props) {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plainText, setPlainText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [pickerKind, setPickerKind] = useState<"user" | "task" | null>(null);
  const [inlineAt, setInlineAt] = useState<{ query: string; index: number } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStart = useRef<number>(0);
  const listEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<ChatEditorHandle>(null);

  const channel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channels, channelId]
  );

  // Load messages + tasks
  useEffect(() => {
    if (!channelId) return;
    void loadMessages();
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Realtime subscription
  useEffect(() => {
    if (!channelId) return;
    const supabase = supabaseRef.current;
    const ch = supabase
      .channel(`chat:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
          filter: `channel_id=eq.${channelId}`
        },
        (payload) => {
          const msg = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [channelId]);

  // Auto-scroll
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const supabase = supabaseRef.current;
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessages((data as ChatMessage[]) ?? []);
  }

  async function loadTasks() {
    const supabase = supabaseRef.current;
    const [tRes, pRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, titulo, project_id, status, prioridade, prazo, data_conclusao, descricao, sector_id, responsavel_id, created_by, created_at, updated_at, funnel_id, product_id")
        .limit(800),
      supabase.from("projects").select("*").eq("status", "ativo").order("nome")
    ]);
    setTasks((tRes.data as Task[]) ?? []);
    setProjects((pRes.data as Project[]) ?? []);
  }

  async function handleSend() {
    const serialized = editorRef.current?.serialize() ?? "";
    if (!serialized.trim() && pendingAttachments.length === 0) return;
    setSending(true);

    const userMentions: string[] = [];
    const taskMentions: string[] = [];
    const re = /(@\[[^\]]+\]\(([0-9a-f-]+)\))|(#\[[^\]]+\]\(([0-9a-f-]+)\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(serialized)) !== null) {
      if (m[1]) userMentions.push(m[2]);
      else if (m[3]) taskMentions.push(m[4]);
    }

    const { data, error } = await sendMessage({
      channelId,
      userId: me.id,
      content: serialized,
      attachments: pendingAttachments,
      userMentions,
      taskMentions
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Insere localmente já (optimistic) — Realtime depois deduplica por id.
    if (data) {
      const inserted = data as ChatMessage;
      setMessages((prev) =>
        prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
      );
    }
    editorRef.current?.clear();
    setPlainText("");
    setInlineAt(null);
    setPendingAttachments([]);
    editorRef.current?.focus();
  }

  function handleActiveTrigger(
    trigger: { kind: "@" | "#"; query: string } | null
  ) {
    if (!trigger) {
      setInlineAt(null);
      return;
    }
    if (trigger.kind === "@") {
      setInlineAt({ query: trigger.query, index: 0 });
    } else if (trigger.kind === "#") {
      // Abre modal de tarefas só uma vez por trigger
      if (!pickerKind && trigger.query.length === 0) {
        setPickerKind("task");
      }
    }
  }

  function selectInlineUser(index?: number) {
    if (!inlineAt) return;
    const q = inlineAt.query.toLowerCase();
    const candidates = users
      .filter((u) => u.id !== me.id)
      .filter((u) =>
        q
          ? u.nome.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
          : true
      )
      .slice(0, 8);
    const i = index ?? inlineAt.index;
    const chosen = candidates[i];
    if (!chosen) {
      setInlineAt(null);
      return;
    }
    editorRef.current?.insertMention("user", chosen.id, chosen.nome);
    setInlineAt(null);
  }

  function onEditorEnter(e: React.KeyboardEvent) {
    if (inlineAt) {
      selectInlineUser();
      return;
    }
    void handleSend();
  }

  function onEditorKeyDown(e: React.KeyboardEvent) {
    if (inlineAt) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setInlineAt({ ...inlineAt, index: inlineAt.index + 1 });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setInlineAt({
          ...inlineAt,
          index: Math.max(0, inlineAt.index - 1)
        });
      } else if (e.key === "Escape") {
        e.preventDefault();
        setInlineAt(null);
      }
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const arr = Array.from(files);
    const uploaded: ChatAttachment[] = [];
    for (const f of arr) {
      const type: ChatAttachment["type"] = f.type.startsWith("image/")
        ? "image"
        : f.type.startsWith("video/")
        ? "video"
        : f.type.startsWith("audio/")
        ? "audio"
        : "file";
      try {
        const att = await uploadAttachment(f, {
          type,
          userId: me.id,
          name: f.name
        });
        uploaded.push(att);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Falha no upload");
      }
    }
    setPendingAttachments((prev) => [...prev, ...uploaded]);
    setUploading(false);
  }

  function pickFile(accept: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => {
      if (input.files) void handleFiles(input.files);
    };
    input.click();
  }

  // ========== Áudio ==========
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        try {
          setUploading(true);
          const att = await uploadAttachment(blob, {
            type: "audio",
            userId: me.id,
            name: `audio-${Date.now()}.webm`,
            duration: Math.round((Date.now() - recordStart.current) / 1000)
          });
          setPendingAttachments((prev) => [...prev, att]);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Erro no upload");
        }
        setUploading(false);
      };
      rec.start();
      recorderRef.current = rec;
      recordStart.current = Date.now();
      setRecordSeconds(0);
      recordTimer.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
      setIsRecording(true);
    } catch (err: unknown) {
      toast.error("Não foi possível acessar o microfone");
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (recordTimer.current) clearInterval(recordTimer.current);
    setIsRecording(false);
    setRecordSeconds(0);
  }

  function cancelRecording() {
    chunksRef.current = []; // descarta
    stopRecording();
  }

  // ========== Drag & Drop ==========
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  }

  // ========== Mentions ==========
  function insertMention(kind: "user" | "task", id: string, label: string) {
    editorRef.current?.insertMention(kind, id, label);
    editorRef.current?.focus();
    setPickerKind(null);
  }

  async function handleDeleteMessage(id: string) {
    if (!confirm("Excluir mensagem?")) return;
    const supabase = supabaseRef.current;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("chat_messages").delete().eq("id", id);
  }

  function handleClickTask(taskId: string) {
    const t = tasks.find((tt) => tt.id === taskId);
    if (t?.project_id) {
      router.push(`/projetos/${t.project_id}`);
    }
    onOpenTask(taskId);
  }

  // ========== Header ==========
  const header = useMemo(() => {
    if (!channel) return null;
    if (channel.kind === "company") {
      return {
        icon: <Building2 className="w-4 h-4" />,
        title: "Empresa",
        subtitle: `${users.length} membros`
      };
    }
    if (channel.kind === "sector") {
      const sec = sectors.find((s) => s.id === channel.sector_id);
      return {
        icon: (
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: sec?.cor ?? "#6366f1" }}
          />
        ),
        title: sec?.nome ?? "Setor",
        subtitle: sec?.descricao ?? "Canal do setor"
      };
    }
    const dm = directs.find((d) => d.channel.id === channel.id);
    return {
      icon: (
        <div className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase">
          {initials(dm?.other?.nome)}
        </div>
      ),
      title: dm?.other?.nome ?? "Conversa",
      subtitle: dm?.other?.cargo ?? dm?.other?.email ?? ""
    };
  }, [channel, sectors, users, directs]);

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="h-14 px-5 border-b border-border flex items-center gap-3 shrink-0">
        {header?.icon}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{header?.title}</p>
          <p className="text-xs text-fg-subtle truncate">{header?.subtitle}</p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-fg-muted text-sm">
            <div className="text-center">
              <p className="font-medium">Sem mensagens ainda</p>
              <p className="text-xs mt-1">Comece a conversa.</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const author = users.find((u) => u.id === msg.user_id);
            const prev = messages[i - 1];
            const sameAuthor =
              prev &&
              prev.user_id === msg.user_id &&
              new Date(msg.created_at).getTime() -
                new Date(prev.created_at).getTime() <
                5 * 60_000;
            const isMine = msg.user_id === me.id;
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                author={author}
                users={users}
                tasks={tasks}
                isMine={isMine}
                sameAuthor={!!sameAuthor}
                onClickTask={handleClickTask}
                onDelete={() => handleDeleteMessage(msg.id)}
              />
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Pending attachments preview */}
      {pendingAttachments.length > 0 && (
        <div className="px-5 py-2 border-t border-border bg-bg-subtle/40 flex gap-2 overflow-x-auto">
          {pendingAttachments.map((a, i) => (
            <div
              key={i}
              className="relative bg-bg border border-border rounded-lg p-2 min-w-[88px] max-w-[140px]"
            >
              <button
                onClick={() =>
                  setPendingAttachments((prev) =>
                    prev.filter((_, j) => j !== i)
                  )
                }
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-priority-urgent text-white flex items-center justify-center"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
              {a.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt={a.name}
                  className="w-20 h-20 object-cover rounded"
                />
              ) : a.type === "video" ? (
                <video src={a.url} className="w-20 h-20 object-cover rounded" />
              ) : a.type === "audio" ? (
                <div className="text-xs text-fg-muted px-2 py-1">🎤 áudio</div>
              ) : (
                <div className="text-xs text-fg-muted px-2 py-1">📎 {a.name}</div>
              )}
              <p className="text-[10px] text-fg-subtle truncate mt-1">
                {a.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-3 bg-bg-subtle/40 shrink-0">
        {isRecording ? (
          <div className="flex items-center gap-3 bg-priority-urgent/10 border border-priority-urgent/30 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-priority-urgent animate-pulse" />
            <p className="text-sm font-medium text-priority-urgent flex-1">
              Gravando... {formatDuration(recordSeconds)}
            </p>
            <button
              onClick={cancelRecording}
              className="text-xs text-fg-muted hover:text-fg px-2"
            >
              Cancelar
            </button>
            <button
              onClick={stopRecording}
              className="inline-flex items-center gap-1 bg-priority-urgent text-white text-xs font-medium px-3 py-1.5 rounded-md"
            >
              <Square className="w-3 h-3" /> Enviar
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-0.5 pb-1.5">
                <IconBtn onClick={() => pickFile("image/*")} title="Imagem">
                  <ImageIcon className="w-4 h-4" />
                </IconBtn>
                <IconBtn onClick={() => pickFile("video/*")} title="Vídeo">
                  <VideoIcon className="w-4 h-4" />
                </IconBtn>
                <IconBtn onClick={() => pickFile("*/*")} title="Arquivo">
                  <Paperclip className="w-4 h-4" />
                </IconBtn>
                <IconBtn onClick={() => setPickerKind("user")} title="Mencionar pessoa">
                  <AtSign className="w-4 h-4" />
                </IconBtn>
                <IconBtn onClick={() => setPickerKind("task")} title="Mencionar tarefa">
                  <Hash className="w-4 h-4" />
                </IconBtn>
              </div>
              <div className="flex-1 relative">
                {inlineAt && (
                  <InlineMentionsDropdown
                    users={users.filter((u) => u.id !== me.id)}
                    query={inlineAt.query}
                    index={inlineAt.index}
                    onChangeIndex={(i) =>
                      setInlineAt(inlineAt ? { ...inlineAt, index: i } : null)
                    }
                    onSelect={(u) => {
                      editorRef.current?.insertMention("user", u.id, u.nome);
                      setInlineAt(null);
                      editorRef.current?.focus();
                    }}
                  />
                )}
                <ChatEditor
                  ref={editorRef}
                  placeholder="Mensagem... (@ para mencionar, # para tarefa)"
                  onChange={setPlainText}
                  onActiveTrigger={handleActiveTrigger}
                  onEnter={onEditorEnter}
                />
              </div>
              {plainText.trim() || pendingAttachments.length > 0 ? (
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-brand text-white hover:bg-brand-hover transition disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-bg-muted text-fg-muted hover:text-fg hover:bg-border transition"
                  title="Gravar áudio"
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
            {uploading && (
              <p className="text-[10px] text-fg-subtle mt-1.5">
                Enviando anexo(s)...
              </p>
            )}
          </>
        )}
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 bg-brand/15 border-4 border-dashed border-brand flex items-center justify-center pointer-events-none">
          <div className="bg-bg-subtle border border-border rounded-2xl px-6 py-4 shadow-2xl">
            <ImageIcon className="w-8 h-8 text-brand mx-auto mb-2" />
            <p className="font-medium">Solte para enviar</p>
          </div>
        </div>
      )}

      <MentionPicker
        kind={pickerKind}
        users={users.filter((u) => u.id !== me.id)}
        tasks={tasks}
        projects={projects}
        onPick={(kind, id, label) => insertMention(kind, id, label)}
        onClose={() => setPickerKind(null)}
      />
    </div>
  );
}

// ============================================================
// MessageBubble
// ============================================================

function MessageBubble({
  msg,
  author,
  users,
  tasks,
  isMine,
  sameAuthor,
  onClickTask,
  onDelete
}: {
  msg: ChatMessage;
  author: UserProfile | undefined;
  users: UserProfile[];
  tasks: Task[];
  isMine: boolean;
  sameAuthor: boolean;
  onClickTask: (id: string) => void;
  onDelete: () => void;
}) {
  const segments: ChatSegment[] = useMemo(
    () => parseChatContent(msg.content),
    [msg.content]
  );
  return (
    <div
      className={cn(
        "flex gap-2.5 group",
        isMine ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div className={cn("shrink-0 w-8", sameAuthor && "opacity-0")}>
        {!sameAuthor && (
          <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase">
            {initials(author?.nome)}
          </div>
        )}
      </div>
      <div className={cn("max-w-[70%]", isMine && "items-end")}>
        {!sameAuthor && (
          <div
            className={cn(
              "flex items-center gap-2 mb-1 text-[11px] text-fg-subtle",
              isMine && "justify-end"
            )}
          >
            <span className="font-medium text-fg">{author?.nome ?? "?"}</span>
            <span>{formatTime(msg.created_at)}</span>
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isMine
              ? "bg-brand text-white rounded-tr-sm"
              : "bg-bg-subtle border border-border rounded-tl-sm"
          )}
        >
          {/* Attachments first */}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-1">
              {msg.attachments.map((a, i) => (
                <Attachment key={i} att={a} isMine={isMine} />
              ))}
            </div>
          )}

          {/* Content */}
          {segments.length > 0 && (
            <p>
              {segments.map((seg, i) => {
                if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
                if (seg.kind === "user") {
                  const exists = users.some((u) => u.id === seg.id);
                  return (
                    <span
                      key={i}
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded-md font-medium",
                        isMine
                          ? "bg-white/20 text-white"
                          : "bg-brand-subtle text-brand"
                      )}
                    >
                      @{seg.name}
                      {!exists && " (?)"}
                    </span>
                  );
                }
                return (
                  <button
                    key={i}
                    onClick={() => onClickTask(seg.id)}
                    className={cn(
                      "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md font-medium underline-offset-2 hover:underline",
                      isMine
                        ? "bg-white/20 text-white"
                        : "bg-brand-subtle text-brand"
                    )}
                  >
                    <Hash className="w-3 h-3" />
                    {seg.title}
                  </button>
                );
              })}
            </p>
          )}
        </div>
        {sameAuthor && (
          <p
            className={cn(
              "text-[10px] text-fg-subtle mt-0.5 opacity-0 group-hover:opacity-100 transition",
              isMine ? "text-right" : "text-left"
            )}
          >
            {formatTime(msg.created_at)}
          </p>
        )}
      </div>
      {isMine && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 self-center p-1 text-fg-subtle hover:text-priority-urgent transition"
          title="Excluir"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function Attachment({ att, isMine }: { att: ChatAttachment; isMine: boolean }) {
  if (att.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={att.url}
        alt={att.name}
        className="max-w-[260px] max-h-[260px] rounded-lg object-cover"
      />
    );
  }
  if (att.type === "video") {
    return (
      <video
        src={att.url}
        controls
        className="max-w-[300px] max-h-[260px] rounded-lg"
      />
    );
  }
  if (att.type === "audio") {
    return (
      <audio
        src={att.url}
        controls
        className={cn("h-9", isMine ? "w-56" : "w-56")}
      />
    );
  }
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
        isMine ? "bg-white/15" : "bg-bg-muted"
      )}
    >
      <Paperclip className="w-3.5 h-3.5" />
      <span className="truncate max-w-[180px]">{att.name}</span>
    </a>
  );
}

function IconBtn({
  onClick,
  title,
  children
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted transition"
    >
      {children}
    </button>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
