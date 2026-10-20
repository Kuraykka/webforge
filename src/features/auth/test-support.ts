import type { AccountUsage, ActiveSession, AuthApi, SessionUser } from "./api";

export const USER: SessionUser = {
  id: "u1",
  email: "ana@dominio.dev",
  username: "ana",
  role: "user",
  status: "activa",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  verifiedAt: null,
  lastLoginAt: null
};

export const CURRENT: ActiveSession = {
  id: "s1",
  createdAt: "2026-03-01T10:00:00.000Z",
  lastSeenAt: "2026-03-01T10:00:00.000Z",
  expiresAt: "2026-03-02T10:00:00.000Z",
  userAgent: "Chrome en este equipo",
  ip: "127.0.0.1",
  current: true
};

export const OTHER_SESSION: ActiveSession = {
  ...CURRENT,
  id: "s2",
  userAgent: "Firefox en el portátil",
  ip: "10.0.0.9",
  current: false
};

export type UsageFixture = () => Promise<AccountUsage>;

export function fakeAuth(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    config: async () => ({ registrationAllowed: true }),
    register: async () => ({ user: USER, verificationRequired: true }),
    login: async () => USER,
    login2fa: async () => USER,
    twoFactor: async () => ({ enabled: false, pending: false, recoveryCodes: 0 }),
    setupTwoFactor: async () => ({ secret: "GEZDGNBVGY3TQOJQ", otpauth: "otpauth://totp/WebForge:ana" }),
    confirmTwoFactor: async () => ({ enabled: true, recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] }),
    disableTwoFactor: async () => undefined,
    logout: async () => undefined,
    whoami: async () => null,
    sessions: async () => [],
    usage: async () => ({ projects: 0, files: 0, bytes: 0, maxProjectsPerUser: 25, maxBytesPerProject: 5_242_880 }),
    revokeSession: async () => ({ revoked: "" }),
    changePassword: async () => ({ changed: true, revokedSessions: 0 }),
    requestReset: async () => ({ accepted: true }),
    confirmReset: async () => undefined,
    verifyEmail: async () => undefined,
    resendVerification: async () => ({ accepted: true }),
    ...overrides
  };
}
