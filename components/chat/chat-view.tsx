"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Layers, MessageSquare, Users, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getOrCreateDirectChannel } from "@/lib/chat";
import { initials } from "@/lib/utils";
import { ChatRoom } from "@/components/chat/chat-room";
import { TaskPanel } from "@/components/side-panel/task-panel";
import { playMessageSound } from "@/lib/message-sound";
import type {
  ChatChannel,
  ChatMessage,
  Sector,
  UserProfile
} from "@/lib/types";
import { usePermissions } from "@/components/permissions/permissions-provider";

type Tab = "empresa" | "setor" | "individual";

const LAST_SEEN_KEY = "vf-chat-last-seen";

function readLastSeen(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeLastSeen(map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota errors */
  }
}

export function ChatView() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [tab, setTab] = useState<Tab>("empresa");
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [directs, setDirects] = useState<
    Array<{ channel: ChatChannel; other: UserProfile | null }>
  >([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [companyChannelId, setCompanyChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [taskPanelId, setTaskPanelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const selectedChannelRef = useRef<string | null>(null);
  const meRef = useRef<UserProfile | null>(null);

  useEffect(() => {
    selectedChannelRef.current = selectedChannelId;
  }, [selectedChannelId]);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;

    const [meRes, chRes, secRes, uRes, membRes] = await Promise.all([
      supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("chat_channels").select("*").order("created_at"),
      supabase.from("sectors").select("*").eq("status", "ativo").order("nome"),
      supabase.from("users").select("*").eq("ativo", true).order("nome"),
      supabase
        .from("chat_channel_members")
        .select("channel_id, user_id")
        .eq("user_id", user.id)
    ]);

    setMe((meRes.data as UserProfile) ?? null);
    const allChannels = (chRes.data as ChatChannel[]) ?? [];
    setChannels(allChannels);
    setSectors((secRes.data as Sector[]) ?? []);
    setUsers((uRes.data as UserProfile[]) ?? []);

    const company = allChannels.find((c) => c.kind === "company");
    setCompanyChannelId(company?.id ?? null);

    // DMs deste usuário
    const myDirectMembIds = ((membRes.data as Array<{ channel_id: string }>) ?? [])
      .map((m) => m.channel_id);
    const directChannels = allChannels.filter(
      (c) => c.kind === "direct" && myDirectMembIds.includes(c.id)
    );
    if (directChannels.length > 0) {
      const { data: otherMembs } = await supabase
        .from("chat_channel_members")
        .select("channel_id, user_id")
        .in(
          "channel_id",
          directChannels.map((c) => c.id)
        );
      const usersById = new Map(
        ((uRes.data as UserProfile[]) ?? []).map((u) => [u.id, u])
      );
      const dms = directChannels.map((c) => {
        const otherMemb = ((otherMembs as Array<{ channel_id: string; user_id: string }>) ?? [])
          .find((m) => m.channel_id === c.id && m.user_id !== user.id);
        return {
          channel: c,
          other: otherMemb ? usersById.get(otherMemb.user_id) ?? null : null
        };
      });
      setDirects(dms);
    } else {
      setDirects([]);
    }

    setLoading(false);

    // calcula contagens de não-lidas para os canais visíveis (antes de selecionar)
    await computeInitialUnread(user.id, allChannels, directChannels);

    // selecionar canal default (e marcar como visto)
    if (!selectedChannelId && company?.id) {
      setSelectedChannelId(company.id);
      const map = readLastSeen();
      map[company.id] = new Date().toISOString();
      writeLastSeen(map);
      setUnreadByChannel((prev) => {
        if (!prev[company.id]) return prev;
        const next = { ...prev };
        delete next[company.id];
        return next;
      });
    }
  }

  /** Soma mensagens criadas após o `last_seen` salvo (por canal). */
  async function computeInitialUnread(
    myId: string,
    allChannels: ChatChannel[],
    myDirectChannels: ChatChannel[]
  ) {
    const supabase = createClient();
    const ids = Array.from(
      new Set([
        ...allChannels.filter((c) => c.kind === "company").map((c) => c.id),
        ...allChannels.filter((c) => c.kind === "sector").map((c) => c.id),
        ...myDirectChannels.map((c) => c.id)
      ])
    );
    if (ids.length === 0) return;
    const lookback = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("chat_messages")
      .select("channel_id, user_id, created_at")
      .in("channel_id", ids)
      .gte("created_at", lookback)
      .neq("user_id", myId)
      .order("created_at", { ascending: false });
    if (!data) return;
    const seen = readLastSeen();
    const counts: Record<string, number> = {};
    for (const r of data as Array<{ channel_id: string; user_id: string; created_at: string }>) {
      const seenAt = seen[r.channel_id];
      if (seenAt && new Date(r.created_at) <= new Date(seenAt)) continue;
      counts[r.channel_id] = (counts[r.channel_id] ?? 0) + 1;
    }
    setUnreadByChannel(counts);
  }

  // Subscribe global para incrementar badges + tocar som ao receber msgs
  useEffect(() => {
    if (!me) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`chat-view:unread:${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const msg = payload.new as ChatMessage;
          const myId = meRef.current?.id;
          if (!myId) return;
          // Minhas próprias mensagens não contam.
          if (msg.user_id === myId) {
            // Marca esse canal como visto (afinal eu acabei de mandar).
            const map = readLastSeen();
            map[msg.channel_id] = new Date(msg.created_at).toISOString();
            writeLastSeen(map);
            return;
          }
          // Mensagem no canal aberto: marca como visto, não incrementa nem toca.
          if (msg.channel_id === selectedChannelRef.current) {
            const map = readLastSeen();
            map[msg.channel_id] = new Date(msg.created_at).toISOString();
            writeLastSeen(map);
            return;
          }
          // Nova mensagem em canal inativo → badge + som.
          setUnreadByChannel((prev) => ({
            ...prev,
            [msg.channel_id]: (prev[msg.channel_id] ?? 0) + 1
          }));
          playMessageSound();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me]);

  function markChannelSeen(channelId: string) {
    const map = readLastSeen();
    map[channelId] = new Date().toISOString();
    writeLastSeen(map);
    setUnreadByChannel((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }

  function selectChannel(id: string | null) {
    setSelectedChannelId(id);
    if (id) markChannelSeen(id);
  }

  // Acesso total vê os canais de todos os setores; os demais, o do próprio setor.
  // Decidido pelo perfil, não mais pelo role legado.
  const veTodosOsSetores = usePermissions()?.fullAccess ?? false;

  const visibleSectors = veTodosOsSetores
    ? sectors
    : sectors.filter((s) => s.id === me?.setor_principal_id);
  const visibleSectorChannels = channels.filter(
    (c) => c.kind === "sector" && visibleSectors.some((s) => s.id === c.sector_id)
  );

  async function openDirectWith(otherUser: UserProfile) {
    if (!otherUser || !me || otherUser.id === me.id) return;
    const id = await getOrCreateDirectChannel(otherUser.id);
    await load();
    setTab("individual");
    selectChannel(id);
  }

  // Agregados por aba
  const unreadEmpresa = companyChannelId ? unreadByChannel[companyChannelId] ?? 0 : 0;
  const unreadSetor = useMemo(
    () =>
      visibleSectorChannels.reduce(
        (acc, c) => acc + (unreadByChannel[c.id] ?? 0),
        0
      ),
    [visibleSectorChannels, unreadByChannel]
  );
  const unreadIndividual = useMemo(
    () =>
      directs.reduce(
        (acc, d) => acc + (unreadByChannel[d.channel.id] ?? 0),
        0
      ),
    [directs, unreadByChannel]
  );

  const filteredUsers = users
    .filter((u) => u.id !== me?.id)
    .filter((u) =>
      search.trim() === ""
        ? true
        : u.nome.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h))]">
      {/* Sidebar do chat */}
      <aside className="w-72 shrink-0 border-r border-border bg-bg-subtle/40 flex flex-col">
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="flex bg-bg-subtle border border-border rounded-lg p-0.5 gap-0.5">
            <TabButton
              active={tab === "empresa"}
              badge={unreadEmpresa}
              onClick={() => {
                setTab("empresa");
                if (companyChannelId) selectChannel(companyChannelId);
              }}
            >
              <Building2 className="w-3 h-3" /> Empresa
            </TabButton>
            <TabButton
              active={tab === "setor"}
              badge={unreadSetor}
              onClick={() => setTab("setor")}
            >
              <Layers className="w-3 h-3" /> Setor
            </TabButton>
            <TabButton
              active={tab === "individual"}
              badge={unreadIndividual}
              onClick={() => setTab("individual")}
            >
              <Users className="w-3 h-3" /> Individual
            </TabButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-xs text-fg-muted">Carregando...</p>
          ) : tab === "empresa" ? (
            companyChannelId ? (
              <ChannelItem
                title="Empresa"
                subtitle="Todos os membros do time"
                icon={<Building2 className="w-4 h-4" />}
                active={selectedChannelId === companyChannelId}
                unread={unreadByChannel[companyChannelId] ?? 0}
                onClick={() => selectChannel(companyChannelId)}
              />
            ) : (
              <p className="p-4 text-xs text-fg-muted">Canal Empresa não encontrado.</p>
            )
          ) : tab === "setor" ? (
            visibleSectorChannels.length === 0 ? (
              <p className="p-4 text-xs text-fg-muted">
                Você não pertence a nenhum setor visível.
              </p>
            ) : (
              <ul>
                {visibleSectorChannels.map((c) => {
                  const sec = sectors.find((s) => s.id === c.sector_id);
                  return (
                    <li key={c.id}>
                      <ChannelItem
                        title={sec?.nome ?? c.name ?? "Setor"}
                        subtitle={sec?.descricao ?? "Canal do setor"}
                        icon={
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: sec?.cor ?? "#6366f1" }}
                          />
                        }
                        active={selectedChannelId === c.id}
                        unread={unreadByChannel[c.id] ?? 0}
                        onClick={() => selectChannel(c.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div>
              <div className="px-3 py-2 border-b border-border">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
                  <input
                    placeholder="Buscar pessoa..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-2 py-1.5 bg-bg border border-border rounded-md text-xs focus:outline-none focus:border-brand"
                  />
                </div>
              </div>
              {directs.length > 0 && (
                <>
                  <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                    Conversas
                  </p>
                  <ul>
                    {directs
                      .filter((d) =>
                        search
                          ? d.other?.nome
                              .toLowerCase()
                              .includes(search.toLowerCase()) ?? false
                          : true
                      )
                      .map((d) => (
                        <li key={d.channel.id}>
                          <ChannelItem
                            title={d.other?.nome ?? "?"}
                            subtitle={d.other?.cargo ?? d.other?.email ?? ""}
                            icon={
                              <div className="w-7 h-7 rounded-full bg-brand/20 text-brand flex items-center justify-center text-[10px] font-bold uppercase">
                                {initials(d.other?.nome)}
                              </div>
                            }
                            active={selectedChannelId === d.channel.id}
                            unread={unreadByChannel[d.channel.id] ?? 0}
                            onClick={() => selectChannel(d.channel.id)}
                            compact
                          />
                        </li>
                      ))}
                  </ul>
                </>
              )}

              <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                Iniciar conversa
              </p>
              <ul>
                {filteredUsers.map((u) => {
                  const alreadyChat = directs.some((d) => d.other?.id === u.id);
                  if (alreadyChat) return null;
                  return (
                    <li key={u.id}>
                      <button
                        onClick={() => openDirectWith(u)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-muted transition text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-bg-muted text-fg-muted flex items-center justify-center text-[10px] font-bold uppercase">
                          {initials(u.nome)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{u.nome}</p>
                          <p className="text-[10px] text-fg-subtle truncate">
                            {u.cargo || u.email}
                          </p>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-fg-subtle" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </aside>

      {/* Room */}
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedChannelId && me ? (
          <ChatRoom
            channelId={selectedChannelId}
            channels={channels}
            sectors={sectors}
            users={users}
            me={me}
            directs={directs}
            onOpenTask={(taskId) => setTaskPanelId(taskId)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-fg-muted">
            <div className="text-center">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Selecione um canal ou conversa para começar.</p>
            </div>
          </div>
        )}
      </div>

      <TaskPanel
        taskId={taskPanelId}
        onClose={() => setTaskPanelId(null)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  badge
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition ${
        active
          ? "bg-bg text-fg shadow-sm"
          : "text-fg-muted hover:text-fg"
      }`}
    >
      {children}
      {!!badge && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-priority-urgent text-white text-[9px] font-bold flex items-center justify-center leading-none shadow">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function ChannelItem({
  title,
  subtitle,
  icon,
  active,
  onClick,
  compact,
  unread
}: {
  title: string;
  subtitle?: string | null;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
  unread?: number;
}) {
  const hasUnread = !!unread && unread > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 ${
        compact ? "py-2" : "py-2.5"
      } text-left hover:bg-bg-muted transition ${
        active ? "bg-brand-subtle/40 border-l-2 border-l-brand pl-[10px]" : ""
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm truncate ${
            hasUnread ? "font-semibold text-fg" : "font-medium"
          }`}
        >
          {title}
        </p>
        {subtitle && (
          <p className="text-[10px] text-fg-subtle truncate">{subtitle}</p>
        )}
      </div>
      {hasUnread && (
        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-priority-urgent text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-sm">
          {unread! > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
