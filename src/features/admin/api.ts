import type { ApiClient } from "../../lib/api";
import type { ActiveSession, SessionUser, UserRole, UserStatus } from "../auth/api";

/** Una cuenta vista por la administración: la identidad pública más lo que ocupa. */
export interface AdminAccount extends SessionUser {
  projects: number;
  files: number;
  bytes: number;
  /** Fecha de fin del bloqueo por intentos fallidos; `null` cuando puede intentar. */
  lockedUntil: string | null;
  failedAttempts: number;
  twoFactorEnabled: boolean;
}

export interface PlatformMetrics {
  accounts: { total: number; admins: number; suspended: number; verified: number };
  projects: { total: number; byStatus: Record<"borrador" | "en_desarrollo" | "listo", number> };
  files: { total: number; bytes: number };
  sessions: { active: number };
  activity: { events: number };
  analytics: { enabledProjects: number };
}

export interface ServiceStatus {
  database: { status: string; writable: boolean; file: string };
  mail: { status: string };
  outbox: { pending: number };
  app: { env: string; node: string; uptimeSeconds: number };
}

export interface AdminEvent {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetUserId: string | null;
  detail: string | null;
  at: string;
}

export interface LoginEvent {
  id: string;
  identifier: string;
  ip: string;
  userAgent: string;
  result: "exito" | "fallo" | "bloqueado" | "segundo-factor" | "segundo-factor-fallido";
  at: string;
}

export interface IpSummary {
  ip: string;
  lastAt: string;
  count: number;
}

export interface AccountActivity {
  sessions: ActiveSession[];
  ips: IpSummary[];
  events: LoginEvent[];
}

export interface OutboxMessage {
  id: string;
  recipient: string;
  subject: string;
  createdAt: string;
  sentAt: string | null;
  attemptedAt: string | null;
  error: string | null;
}

export interface AdminSettings {
  allowRegistration: boolean;
  maxProjectsPerUser: number;
  maxBytesPerProject: number;
}

export interface AdminApi {
  metrics(): Promise<PlatformMetrics>;
  services(): Promise<ServiceStatus>;
  users(): Promise<AdminAccount[]>;
  activity(limit?: number): Promise<AdminEvent[]>;
  settings(): Promise<AdminSettings>;
  updateSettings(patch: Partial<AdminSettings>): Promise<AdminSettings>;
  setRole(id: string, role: UserRole): Promise<AdminAccount>;
  setStatus(id: string, status: UserStatus): Promise<AdminAccount>;
  unblock(id: string): Promise<AdminAccount>;
  accountActivity(id: string): Promise<AccountActivity>;
  revokeSessions(id: string): Promise<{ revoked: number }>;
  outbox(): Promise<OutboxMessage[]>;
  retryOutbox(): Promise<{ delivered: number; failed: number }>;
  removeUser(id: string, confirm: string): Promise<void>;
}

/**
 * Todo lo que lee o cambia la administración vive en `/api/admin`, donde el servidor
 * comprueba el rol: la interfaz no decide permisos, solo los refleja.
 */
export function createAdminApi(api: ApiClient): AdminApi {
  return {
    metrics: async () => (await api.get<{ metrics: PlatformMetrics }>("/api/admin/metrics")).metrics,

    services: async () => (await api.get<{ services: ServiceStatus }>("/api/admin/services")).services,

    users: async () => (await api.get<{ users: AdminAccount[] }>("/api/admin/users")).users,

    activity: async (limit) =>
      (await api.get<{ events: AdminEvent[] }>(`/api/admin/activity${limit === undefined ? "" : `?limit=${limit}`}`))
        .events,

    settings: async () => (await api.get<{ settings: AdminSettings }>("/api/admin/settings")).settings,

    updateSettings: async (patch) =>
      (await api.patch<{ settings: AdminSettings }>("/api/admin/settings", patch)).settings,

    setRole: async (id, role) => (await api.patch<{ user: AdminAccount }>(`/api/admin/users/${id}`, { role })).user,

    setStatus: async (id, status) =>
      (await api.patch<{ user: AdminAccount }>(`/api/admin/users/${id}`, { status })).user,

    unblock: async (id) => (await api.post<{ user: AdminAccount }>(`/api/admin/users/${id}/unblock`)).user,

    accountActivity: async (id) => api.get<AccountActivity>(`/api/admin/users/${encodeURIComponent(id)}/activity`),

    revokeSessions: async (id) => api.post<{ revoked: number }>(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, {}),

    outbox: async () => (await api.get<{ messages: OutboxMessage[] }>("/api/admin/outbox")).messages,

    retryOutbox: async () => api.post<{ delivered: number; failed: number }>("/api/admin/outbox/reintentar", {}),

    removeUser: async (id, confirm) => api.remove(`/api/admin/users/${id}`, { confirm })
  };
}
