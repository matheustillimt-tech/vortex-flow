export type UserRole = "admin" | "gestor" | "colaborador";
export type ProjectStatus = "ativo" | "arquivado";
export type TaskStatus =
  | "pendente"
  | "em_andamento"
  | "em_revisao"
  | "concluido"
  | "travado";
export type TaskPriority = "baixa" | "media" | "alta" | "urgente";
export type SectorStatus = "ativo" | "arquivado";
export type MapScope = "company" | "project";
export type NodeType =
  | "setor"
  | "etapa"
  | "tarefa"
  | "subtarefa"
  | "anotacao"
  | "ideia"
  | "checklist"
  | "problema"
  | "prioridade"
  | "projeto";

export type TicketTier = "low" | "medio" | "high";

export const TIER_LABEL: Record<TicketTier, string> = {
  low: "Lowticket",
  medio: "Médio ticket",
  high: "Highticket"
};

export const TIER_COLOR: Record<TicketTier, string> = {
  low: "#10b981",
  medio: "#eab308",
  high: "#a855f7"
};

export interface Funnel {
  id: string;
  project_id: string;
  nome: string;
  tier: TicketTier | null;
  cor: string;
  descricao: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  project_id: string;
  funnel_id: string | null;
  nome: string;
  descricao: string | null;
  tier: TicketTier;
  cor: string | null;
  created_at: string;
  updated_at: string;
}

export type ChatChannelKind = "company" | "sector" | "direct";

export interface ChatChannel {
  id: string;
  kind: ChatChannelKind;
  sector_id: string | null;
  name: string | null;
  created_at: string;
}

export interface ChatChannelMember {
  channel_id: string;
  user_id: string;
  joined_at: string;
}

export interface ChatAttachment {
  type: "image" | "video" | "audio" | "file";
  url: string;
  name: string;
  size?: number;
  mime?: string;
  duration?: number; // segundos (áudio/vídeo)
}

export interface ChatMentions {
  users: string[];
  tasks: string[];
}

export type NotificationKind =
  | "task_assigned"
  | "task_completed"
  | "dependency_completed"
  | "task_due_soon"
  | "mention";

export interface Notification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  task_id: string | null;
  project_id: string | null;
  actor_id: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  user_id: string;
  content: string | null;
  attachments: ChatAttachment[];
  mentions: ChatMentions;
  reply_to_id: string | null;
  edited_at: string | null;
  created_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  nome: string;
  avatar_url: string | null;
  cargo: string | null;
  setor_principal_id: string | null;
  ativo: boolean;
  /** Derivado do perfil pelo banco (migration 043). Não gravar direto. */
  role: UserRole;
  /** Perfil de permissão atribuído — a autoridade de acesso. */
  permission_profile_id?: string | null;
  password_changed?: boolean;
  mfa_enabled?: boolean;
  /** Preencheu o cadastro completo (CPF, PIX, endereço...). */
  cadastro_completo?: boolean;
  created_at: string;
  updated_at: string;
}

export type TipoChavePix = "cpf" | "email" | "telefone" | "aleatoria";

export const TIPO_PIX_LABEL: Record<TipoChavePix, string> = {
  cpf: "CPF",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória"
};

/**
 * Dados sensíveis do colaborador (LGPD) — tabela separada de `users` com
 * RLS estrita: só o próprio dono e admins conseguem ler.
 */
export interface ColaboradorDados {
  user_id: string;
  cpf: string | null;
  data_nascimento: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  chave_pix: string | null;
  tipo_chave_pix: TipoChavePix | null;
  whatsapp: string | null;
  preenchido_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tool {
  id: string;
  nome: string;
  /** URL ocultada para usuários não-admin — só vem após TOTP via /api/tools/access */
  url?: string | null;
  descricao: string | null;
  icon: string | null;
  cor: string;
  /** Credenciais — só presentes em rotas admin/access (server-side) */
  login?: string | null;
  senha?: string | null;
  /** Há senha salva — informado a quem gere sem poder vê-la. */
  tem_senha?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolSector {
  tool_id: string;
  sector_id: string;
}

export interface ToolUserAccess {
  tool_id: string;
  user_id: string;
  granted_by?: string | null;
  granted_at?: string;
}

export type ActivityAction =
  | "tools_page_open"
  | "tool_view_attempt"
  | "tool_view_success"
  | "tool_view_failed_totp"
  | "tool_created"
  | "tool_updated"
  | "tool_deleted"
  | "tool_users_changed"
  | "webhook_updated"
  | "claude_conector";

export interface ActivityLog {
  id: string;
  user_id: string | null;
  user_nome: string | null;
  user_email: string | null;
  action: ActivityAction;
  tool_id: string | null;
  tool_nome: string | null;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Sector {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  status: SectorStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type ProjectTipo = "infoproduto" | "saas" | "produto_fisico";

export interface Project {
  id: string;
  nome: string;
  descricao: string | null;
  setor_principal_id: string | null;
  responsavel_id: string | null;
  status: ProjectStatus;
  prioridade: TaskPriority;
  cor: string;
  tags: string[];
  data_inicio: string | null;
  prazo: string | null;
  /** Tipo do projeto. Só "infoproduto" usa funis + tickets low/mid/high.
   *  "saas" e "produto_fisico" são só mapa mental de tarefas. */
  tipo: ProjectTipo;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Task {
  id: string;
  titulo: string;
  descricao: string | null;
  project_id: string | null;
  sector_id: string | null;
  responsavel_id: string | null;
  status: TaskStatus;
  prioridade: TaskPriority;
  prazo: string | null;
  /** Quando false, a UI mostra apenas a data (sem hora). */
  prazo_has_time: boolean;
  /** Aviso no WhatsApp às 08:00 do dia do prazo (migration 052). */
  lembrete_padrao?: boolean;
  data_conclusao: string | null;
  /** IDs de todos os responsáveis (1 ou mais).
   *  O primeiro é o "principal" (= responsavel_id). Vem do join com
   *  task_assignees quando explicitamente buscado. */
  assignee_ids?: string[];
  /** Coluna no quadro kanban (só projetos SaaS usam). */
  kanban_column_id?: string | null;
  /** Marcada como template — aparece no picker pra ser clonada em outros projetos. */
  is_template?: boolean;
  created_by: string | null;
  funnel_id: string | null;
  product_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskAttachmentType = "image" | "video" | "audio" | "file";

export interface TaskAttachment {
  id: string;
  task_id: string;
  type: TaskAttachmentType;
  url: string;
  storage_path: string | null;
  name: string;
  size: number | null;
  mime: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface KanbanColumn {
  id: string;
  project_id: string;
  nome: string;
  ordem: number;
  cor: string;
  /** Status aplicado ao mover um card para esta coluna.
   *  null = a coluna não altera o status da tarefa. */
  status_ao_mover: TaskStatus | null;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignee {
  task_id: string;
  user_id: string;
  primary_assignee: boolean;
  assigned_by: string | null;
  assigned_at: string;
}

export interface MapEntity {
  id: string;
  nome: string;
  scope: MapScope;
  project_id: string | null;
  is_default: boolean;
  view_mode: string | null;
  filters: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NodeEntity {
  id: string;
  map_id: string;
  parent_node_id: string | null;
  tipo: NodeType;
  titulo: string;
  descricao: string | null;
  cor: string | null;
  pos_x: number;
  pos_y: number;
  width: number | null;
  height: number | null;
  task_id: string | null;
  project_ref_id: string | null;
  sector_ref_id: string | null;
  user_ref_id: string | null;
  funnel_id: string | null;
  product_id: string | null;
  collapsed?: boolean;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EdgeEntity {
  id: string;
  map_id: string;
  source_node_id: string;
  target_node_id: string;
  label: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  titulo: string;
  done: boolean;
  ordem: number;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string | null;
  conteudo: string;
  created_at: string;
}

export interface TaskLink {
  id: string;
  task_id: string;
  url: string;
  titulo: string | null;
  created_at: string;
}

export interface TaskActivityLog {
  id: string;
  task_id: string;
  user_id: string | null;
  acao: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgente: "#ef4444",
  alta: "#f97316",
  media: "#eab308",
  baixa: "#10b981"
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa"
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  em_revisao: "Em revisão",
  concluido: "Concluído",
  travado: "Travado"
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  pendente: "#94a3b8",
  em_andamento: "#3b82f6",
  em_revisao: "#a855f7",
  concluido: "#10b981",
  travado: "#ef4444"
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  ativo: "Ativo",
  arquivado: "Arquivado"
};


// ---------------------------------------------------------------- permissões

/**
 * Perfil de permissão. Substitui `UserRole` como autoridade de acesso:
 * `full_access` e `can_manage` são o que is_admin() e is_admin_or_gestor()
 * passam a consultar (migration 042). O catálogo de recursos e ações vive em
 * lib/permissions.ts, não no banco.
 */
export interface PermissionProfile {
  id: string;
  nome: string;
  descricao: string | null;
  /** Perfil de sistema: não pode ser excluído nem renomeado. */
  is_system: boolean;
  /** Acesso irrestrito — dispensa concessões. */
  full_access: boolean;
  /** Pode editar/arquivar conteúdo de qualquer projeto. */
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

/** Uma concessão gravada: perfil × recurso × ação. */
export interface PermissionGrantRow {
  profile_id: string;
  resource: string;
  action: string;
}

/** Perfil já acompanhado das concessões e de quantas pessoas o usam. */
export interface PermissionProfileWithGrants extends PermissionProfile {
  grants: Array<{ resource: string; action: string }>;
  user_count: number;
}
