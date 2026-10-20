import type { AdminAccount, AdminApi, AdminEvent, AdminSettings, PlatformMetrics, ServiceStatus } from "./api";

export const ACCOUNTS: AdminAccount[] = [
  {
    id: "u1",
    email: "root@dominio.dev",
    username: "root",
    role: "admin",
    status: "activa",
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    verifiedAt: "2026-03-01T11:00:00.000Z",
    lastLoginAt: "2026-03-08T09:00:00.000Z",
    lockedUntil: null,
    failedAttempts: 0,
    twoFactorEnabled: true,
    projects: 3,
    files: 6,
    bytes: 2048
  },
  {
    id: "u2",
    email: "luis@dominio.dev",
    username: "luis",
    role: "user",
    status: "activa",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
    verifiedAt: null,
    lastLoginAt: null,
    lockedUntil: null,
    failedAttempts: 0,
    twoFactorEnabled: false,
    projects: 2,
    files: 12,
    bytes: 120_000
  }
];

export const METRICS: PlatformMetrics = {
  accounts: { total: 2, admins: 1, suspended: 0, verified: 1 },
  projects: { total: 5, byStatus: { borrador: 3, en_desarrollo: 1, listo: 1 } },
  files: { total: 18, bytes: 120_000 },
  sessions: { active: 4 },
  activity: { events: 2 },
  analytics: { enabledProjects: 1 }
};

export const SERVICES: ServiceStatus = {
  database: { status: "ok", writable: true, file: "/tmp/webforge.sqlite" },
  mail: { status: "sin-proveedor" },
  outbox: { pending: 3 },
  app: { env: "development", node: "v24.18.0", uptimeSeconds: 90 }
};

export const EVENTS: AdminEvent[] = [
  {
    id: "e2",
    actorId: "u1",
    actorEmail: "root@dominio.dev",
    action: "usuario.rol_cambiado",
    targetUserId: "u2",
    detail: "Rol: user → admin",
    at: "2026-03-08T09:30:00.000Z"
  },
  {
    id: "e1",
    actorId: "u1",
    actorEmail: "root@dominio.dev",
    action: "configuracion.actualizada",
    targetUserId: null,
    detail: "registro cerrado",
    at: "2026-03-07T09:00:00.000Z"
  }
];

export const SETTINGS: AdminSettings = {
  allowRegistration: true,
  maxProjectsPerUser: 25,
  maxBytesPerProject: 5242880
};

export function fakeAdmin(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    metrics: async () => METRICS,
    services: async () => SERVICES,
    users: async () => ACCOUNTS,
    activity: async () => EVENTS,
    settings: async () => SETTINGS,
    updateSettings: async (patch) => ({ ...SETTINGS, ...patch }),
    setRole: async (id, role) => ({ ...ACCOUNTS.find((a) => a.id === id)!, role }),
    setStatus: async (id, status) => ({ ...ACCOUNTS.find((a) => a.id === id)!, status }),
    unblock: async (id) => ({ ...ACCOUNTS.find((a) => a.id === id)!, lockedUntil: null, failedAttempts: 0 }),
    accountActivity: async () => ({ sessions: [], ips: [], events: [] }),
    revokeSessions: async () => ({ revoked: 0 }),
    outbox: async () => [],
    retryOutbox: async () => ({ delivered: 0, failed: 0 }),
    removeUser: async () => undefined,
    ...overrides
  };
}
