"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock,
  GitBranch,
  Sparkles,
  Volume2,
  VolumeX
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  isMuted,
  playNotificationSound,
  setMuted as persistMuted
} from "@/lib/notification-sound";
import { cn } from "@/lib/utils";
import type { Notification, NotificationKind } from "@/lib/types";

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [muted, setMutedState] = useState(false);
  const [loading, setLoading] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMutedState(isMuted()), []);

  // Carrega notificações + assina realtime
  useEffect(() => {
    let userId: string | null = null;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      userId = user.id;
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      setItems((data as Notification[]) ?? []);
      setLoading(false);

      channel = supabase
        .channel(`notif:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            const nn = payload.new as Notification;
            setItems((prev) => [nn, ...prev].slice(0, 100));
            // som agradável + opcional vibrar
            playNotificationSound();
            try {
              navigator.vibrate?.([60, 30, 60]);
            } catch {
              /* ignore */
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            const nn = payload.new as Notification;
            setItems((prev) =>
              prev.map((it) => (it.id === nn.id ? nn : it))
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            const old = payload.old as { id: string };
            setItems((prev) => prev.filter((it) => it.id !== old.id));
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  // Fecha ao clicar fora
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const unread = useMemo(() => items.filter((i) => !i.read), [items]);

  const markRead = useCallback(async (id: string) => {
    const supabase = createClient();
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, read: true, read_at: new Date().toISOString() } : it
      )
    );
    await supabase
      .from("notifications")
      .update({ read: true, read_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

  async function markAllRead() {
    if (unread.length === 0) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    setItems((prev) => prev.map((it) => ({ ...it, read: true, read_at: it.read_at ?? now })));
    await supabase
      .from("notifications")
      .update({ read: true, read_at: now })
      .in(
        "id",
        unread.map((u) => u.id)
      );
  }

  function toggleMute() {
    const next = !muted;
    setMutedState(next);
    persistMuted(next);
    if (!next) playNotificationSound(); // preview
  }

  function handleClick(n: Notification) {
    void markRead(n.id);
    setOpen(false);
    // Toda notificação que referencia uma tarefa abre o modal dela
    // dentro de "Minhas Tarefas" (UX unificada).
    if (n.task_id) {
      router.push(`/minha-area?task=${n.task_id}`);
    } else if (n.project_id) {
      router.push(`/projetos/${n.project_id}`);
    } else {
      router.push("/minha-area");
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "p-1.5 rounded-lg transition relative",
          open
            ? "bg-bg-muted text-fg"
            : "hover:bg-bg-muted text-fg-muted hover:text-fg"
        )}
        title="Notificações"
        aria-label="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-priority-urgent text-white text-[9px] font-bold flex items-center justify-center">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-[360px] bg-bg-subtle border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-fadeIn">
          <header className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="font-semibold text-sm">Notificações</p>
              <p className="text-[10px] text-fg-subtle">
                {unread.length === 0
                  ? "Tudo em dia"
                  : `${unread.length} não lida(s)`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleMute}
                title={muted ? "Reativar som" : "Silenciar som"}
                className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted transition"
              >
                {muted ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={markAllRead}
                title="Marcar todas como lidas"
                disabled={unread.length === 0}
                className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-bg-muted transition disabled:opacity-30"
              >
                <CheckCheck className="w-3.5 h-3.5" />
              </button>
            </div>
          </header>

          <ul className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <li className="px-4 py-8 text-center text-xs text-fg-subtle">
                Carregando...
              </li>
            ) : items.length === 0 ? (
              <li className="px-4 py-10 text-center text-xs text-fg-subtle">
                <BellOff className="w-5 h-5 mx-auto mb-2 opacity-50" />
                Sem notificações por enquanto.
              </li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={cn(
                      "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-bg-muted transition border-b border-border/40",
                      !n.read && "bg-brand-subtle/30"
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      <KindIcon kind={n.kind} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm leading-tight",
                          n.read ? "font-normal" : "font-semibold"
                        )}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      )}
                      <p className="text-[10px] text-fg-subtle mt-1">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const cls = "w-4 h-4";
  switch (kind) {
    case "task_assigned":
      return <Sparkles className={cn(cls, "text-brand")} />;
    case "task_completed":
      return <Check className={cn(cls, "text-status-done")} />;
    case "dependency_completed":
      return <GitBranch className={cn(cls, "text-status-progress")} />;
    case "task_due_soon":
      return <Clock className={cn(cls, "text-priority-high")} />;
    case "mention":
      return <AtSign className={cn(cls, "text-brand")} />;
    default:
      return <Bell className={cls} />;
  }
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86400) return `há ${Math.round(diff / 86400)} d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
