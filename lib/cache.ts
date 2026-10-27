"use client";

/**
 * Cache em memória pra dados que mudam pouco (users, projects, sectors) e
 * são consumidos por várias páginas. Sem isso, cada troca de aba re-fetcha
 * tudo do zero — fica visivelmente lento.
 *
 * Strat: cache com TTL curto (60s). Páginas chamam ensureXxx() que retorna
 * imediatamente se tem cache válido; senão dispara fetch e cacheia.
 */

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Project, Sector, UserProfile } from "@/lib/types";

const TTL_MS = 60_000;

interface CacheState {
  users: UserProfile[];
  usersAt: number;
  projects: Project[];
  projectsAt: number;
  sectors: Sector[];
  sectorsAt: number;
  me: UserProfile | null;
  meAt: number;
  inflight: Record<string, Promise<unknown> | undefined>;
}

const useStore = create<CacheState>(() => ({
  users: [],
  usersAt: 0,
  projects: [],
  projectsAt: 0,
  sectors: [],
  sectorsAt: 0,
  me: null,
  meAt: 0,
  inflight: {}
}));

function fresh(at: number) {
  return at > 0 && Date.now() - at < TTL_MS;
}

async function ensureKey<T>(
  key: "users" | "projects" | "sectors" | "me",
  doFetch: () => Promise<T>
): Promise<T> {
  const state = useStore.getState();
  const existing = state.inflight[key];
  if (existing) return existing as Promise<T>;
  const p = doFetch().finally(() => {
    useStore.setState((s) => ({ inflight: { ...s.inflight, [key]: undefined } }));
  });
  useStore.setState((s) => ({ inflight: { ...s.inflight, [key]: p } }));
  return p;
}

export async function ensureUsers(force = false): Promise<UserProfile[]> {
  const s = useStore.getState();
  if (!force && fresh(s.usersAt)) return s.users;
  return ensureKey("users", async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("ativo", true)
      .order("nome");
    const list = (data as UserProfile[]) ?? [];
    useStore.setState({ users: list, usersAt: Date.now() });
    return list;
  });
}

export async function ensureProjects(force = false): Promise<Project[]> {
  const s = useStore.getState();
  if (!force && fresh(s.projectsAt)) return s.projects;
  return ensureKey("projects", async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "ativo")
      .order("nome");
    const list = (data as Project[]) ?? [];
    useStore.setState({ projects: list, projectsAt: Date.now() });
    return list;
  });
}

export async function ensureMe(force = false): Promise<UserProfile | null> {
  const s = useStore.getState();
  if (!force && s.me && fresh(s.meAt)) return s.me;
  return ensureKey("me", async () => {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      useStore.setState({ me: null, meAt: Date.now() });
      return null;
    }
    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    const me = (data as UserProfile) ?? null;
    useStore.setState({ me, meAt: Date.now() });
    return me;
  });
}

export async function ensureSectors(force = false): Promise<Sector[]> {
  const s = useStore.getState();
  if (!force && fresh(s.sectorsAt)) return s.sectors;
  return ensureKey("sectors", async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("sectors")
      .select("*")
      .order("nome");
    const list = (data as Sector[]) ?? [];
    useStore.setState({ sectors: list, sectorsAt: Date.now() });
    return list;
  });
}

/** Invalida todas as caches — chamar quando o usuário cria/edita esses recursos. */
export function invalidateAll() {
  useStore.setState({ usersAt: 0, projectsAt: 0, sectorsAt: 0, meAt: 0 });
}

export function invalidate(key: "users" | "projects" | "sectors" | "me") {
  if (key === "users") useStore.setState({ usersAt: 0 });
  else if (key === "projects") useStore.setState({ projectsAt: 0 });
  else if (key === "sectors") useStore.setState({ sectorsAt: 0 });
  else if (key === "me") useStore.setState({ meAt: 0 });
}

/** Pré-aquece o cache (chamar no app shell logo após login). */
export function warmCache() {
  void ensureMe();
  void ensureUsers();
  void ensureProjects();
  void ensureSectors();
}

/** Snapshot atual do cache (não dispara fetch). */
export function snapshot() {
  const s = useStore.getState();
  return {
    users: s.users,
    projects: s.projects,
    sectors: s.sectors,
    me: s.me
  };
}
