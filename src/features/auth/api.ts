import { isApiError, type ApiClient } from "../../lib/api";

export type UserRole = "user" | "admin";

export type UserStatus = "activa" | "suspendida";

export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  lastLoginAt: string | null;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
  current: boolean;
}

export interface SessionInfo {
  user: SessionUser;
  sessions: ActiveSession[];
}

export interface PasswordChangeResult {
  changed: boolean;
  revokedSessions: number;
}

/** Lo que ocupa una cuenta y el techo que se le ha puesto: los dos los decide el servidor. */
export interface AccountUsage {
  projects: number;
  files: number;
  bytes: number;
  maxProjectsPerUser: number;
  maxBytesPerProject: number;
}

export interface RegisterResult {
  user: SessionUser;
  /** La cuenta existe pero no entra en nada hasta confirmar el correo. */
  verificationRequired: boolean;
}

/** El acceso pide el segundo factor: todavía no hay sesión, solo un desafío de cinco minutos. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
}

export type LoginOutcome = SessionUser | TwoFactorChallenge;

export function isTwoFactorChallenge(value: LoginOutcome | SessionUser): value is TwoFactorChallenge {
  return (value as TwoFactorChallenge).twoFactorRequired === true;
}

export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
  recoveryCodes: number;
}

export interface TwoFactorSetup {
  secret: string;
  otpauth: string;
}

export interface AuthApi {
  config(): Promise<{ registrationAllowed: boolean }>;
  register(email: string, password: string, username?: string): Promise<RegisterResult>;
  login(identifier: string, password: string): Promise<LoginOutcome>;
  login2fa(challenge: string, code: string): Promise<SessionUser>;
  twoFactor(): Promise<TwoFactorStatus>;
  setupTwoFactor(): Promise<TwoFactorSetup>;
  confirmTwoFactor(code: string): Promise<{ enabled: boolean; recoveryCodes: string[] }>;
  disableTwoFactor(password: string, code: string): Promise<void>;
  logout(): Promise<void>;
  whoami(): Promise<SessionInfo | null>;
  sessions(): Promise<ActiveSession[]>;
  usage(): Promise<AccountUsage>;
  revokeSession(id: string): Promise<{ revoked: string }>;
  changePassword(currentPassword: string, newPassword: string): Promise<PasswordChangeResult>;
  requestReset(email: string): Promise<{ accepted: boolean }>;
  confirmReset(token: string, newPassword: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  resendVerification(email: string): Promise<{ accepted: boolean }>;
}

interface UserPayload {
  user: SessionUser;
}

interface SessionsPayload {
  sessions: ActiveSession[];
}

interface UsagePayload {
  usage: { projects: number; files: number; bytes: number };
  limits: { maxProjectsPerUser: number; maxBytesPerProject: number };
}

/** El estado de la sesión se comprueba en cada arranque: el 401 es «anónimo», no un fallo. */
export function createAuthApi(api: ApiClient): AuthApi {
  return {
    config: async () => api.get<{ registrationAllowed: boolean }>("/api/auth/config"),

    register: async (email, password, username) =>
      api.post<RegisterResult>("/api/auth/register", {
        email,
        password,
        ...(username === undefined || username.trim() === "" ? {} : { username: username.trim() })
      }),

    login: async (identifier, password) => {
      const payload = await api.post<{ user?: SessionUser; twoFactorRequired?: boolean; challenge?: string }>(
        "/api/auth/login",
        { identifier, password }
      );
      if (payload.twoFactorRequired) {
        return { twoFactorRequired: true, challenge: payload.challenge ?? "" };
      }
      if (!payload.user) throw new Error("El servidor no devolvió la identidad.");
      return payload.user;
    },

    login2fa: async (challenge, code) =>
      (await api.post<UserPayload>("/api/auth/login/2fa", { challenge, code })).user,

    twoFactor: async () => (await api.get<{ twoFactor: TwoFactorStatus }>("/api/auth/2fa")).twoFactor,

    setupTwoFactor: async () => api.post<TwoFactorSetup>("/api/auth/2fa/setup", {}),

    confirmTwoFactor: async (code) =>
      api.post<{ enabled: boolean; recoveryCodes: string[] }>("/api/auth/2fa/confirm", { code }),

    disableTwoFactor: async (password, code) => api.post<void>("/api/auth/2fa/disable", { password, code }),

    logout: async () => api.post<void>("/api/auth/logout"),

    async whoami() {
      try {
        const payload = await api.get<SessionInfo>("/api/auth/session");
        return { user: payload.user, sessions: payload.sessions };
      } catch (error) {
        if (isApiError(error, 401)) return null;
        throw error;
      }
    },

    sessions: async () => (await api.get<SessionsPayload>("/api/auth/sessions")).sessions,

    usage: async () => {
      const payload = await api.get<UsagePayload>("/api/account/usage");
      return { ...payload.usage, ...payload.limits };
    },

    revokeSession: async (id) => api.post<{ revoked: string }>("/api/auth/sessions/revoke", { id }),

    changePassword: async (currentPassword, newPassword) =>
      api.post<PasswordChangeResult>("/api/auth/password", { currentPassword, newPassword }),

    requestReset: async (email) => api.post<{ accepted: boolean }>("/api/auth/password/reset", { email }),

    confirmReset: async (token, newPassword) =>
      api.post<void>("/api/auth/password/reset/confirm", { token, newPassword }),

    verifyEmail: async (token) => api.post<void>("/api/auth/verify-email", { token }),

    resendVerification: async (email) => api.post<{ accepted: boolean }>("/api/auth/verify-email/resend", { email })
  };
}
