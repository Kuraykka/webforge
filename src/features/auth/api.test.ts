import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, type FetchLike } from "../../lib/api";
import { createAuthApi, type SessionUser } from "./api";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

const USER: SessionUser = {
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

const SESSIONS = [
  {
    id: "s1",
    createdAt: "2026-03-01T10:00:00.000Z",
    lastSeenAt: "2026-03-01T10:00:00.000Z",
    expiresAt: "2026-03-08T10:00:00.000Z",
    userAgent: "Mozilla/5.0",
    ip: "127.0.0.1",
    current: true
  }
];

function harness(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    // Estas pruebas solo miran cuerpos JSON: un ZIP no se anota como texto.
    calls.push({ method: init.method, url, body: typeof init.body === "string" ? init.body : undefined });
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    if ((route.status ?? 200) === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { api: createAuthApi(createApiClient(fetchImpl)), calls };
}

function sentBody(call: Recorded | undefined): unknown {
  return JSON.parse(call?.body ?? "{}");
}

describe("createAuthApi", () => {
  it("lee si el auto-registro está abierto", async () => {
    const { api, calls } = harness({ "GET /api/auth/config": { payload: { registrationAllowed: false } } });
    await expect(api.config()).resolves.toEqual({ registrationAllowed: false });
    expect(calls[0]?.url).toBe("/api/auth/config");
  });

  it("el registro manda correo y contraseña y deja claro que falta verificar", async () => {
    const { api, calls } = harness({
      "POST /api/auth/register": { status: 201, payload: { user: USER, verificationRequired: true } }
    });
    await expect(api.register("ana@dominio.dev", "S3creta-fuerte")).resolves.toEqual({
      user: USER,
      verificationRequired: true
    });
    expect(sentBody(calls[0])).toEqual({ email: "ana@dominio.dev", password: "S3creta-fuerte" });
  });

  it("el reenvío del enlace se pide con el correo", async () => {
    const { api, calls } = harness({ "POST /api/auth/verify-email/resend": { status: 202, payload: { accepted: true } } });
    await expect(api.resendVerification("ana@dominio.dev")).resolves.toEqual({ accepted: true });
    expect(calls[0]?.url).toBe("/api/auth/verify-email/resend");
    expect(sentBody(calls[0])).toEqual({ email: "ana@dominio.dev" });
  });

  it("el acceso manda las credenciales y devuelve la identidad", async () => {
    const { api, calls } = harness({ "POST /api/auth/login": { payload: { user: USER } } });
    await expect(api.login("ana@dominio.dev", "S3creta-fuerte")).resolves.toEqual(USER);
    expect(calls[0]?.url).toBe("/api/auth/login");
  });

  it("una sesión válida se traduce en identidad y sesiones abiertas", async () => {
    const { api } = harness({ "GET /api/auth/session": { payload: { user: USER, sessions: SESSIONS } } });
    await expect(api.whoami()).resolves.toEqual({ user: USER, sessions: SESSIONS });
  });

  it("sin sesión no es un error: devuelve null", async () => {
    const { api } = harness({ "GET /api/auth/session": { status: 401, payload: { error: "Inicia sesión para continuar." } } });
    await expect(api.whoami()).resolves.toBeNull();
  });

  it("un fallo de red al mirar la sesión se propaga: el servidor no responde", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(createAuthApi(createApiClient(fetchImpl)).whoami()).rejects.toBeInstanceOf(ApiError);
  });

  it("el cierre usa la ruta de logout y no espera cuerpo", async () => {
    const { api, calls } = harness({ "POST /api/auth/logout": { status: 204 } });
    await expect(api.logout()).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe("/api/auth/logout");
  });

  it("lista las sesiones abiertas", async () => {
    const { api } = harness({ "GET /api/auth/sessions": { payload: { sessions: SESSIONS } } });
    await expect(api.sessions()).resolves.toEqual(SESSIONS);
  });

  it("cierra una sesión concreta por su id", async () => {
    const { api, calls } = harness({ "POST /api/auth/sessions/revoke": { payload: { revoked: "s2" } } });
    await expect(api.revokeSession("s2")).resolves.toEqual({ revoked: "s2" });
    expect(sentBody(calls[0])).toEqual({ id: "s2" });
  });

  it("cambia la contraseña con la actual y la nueva", async () => {
    const { api, calls } = harness({ "POST /api/auth/password": { payload: { changed: true, revokedSessions: 2 } } });
    await expect(api.changePassword("Vieja-1234", "Nueva-1234")).resolves.toEqual({
      changed: true,
      revokedSessions: 2
    });
    expect(sentBody(calls[0])).toEqual({ currentPassword: "Vieja-1234", newPassword: "Nueva-1234" });
  });

  it("pedir un restablecimiento acepta cualquier correo sin revelar cuentas", async () => {
    const { api, calls } = harness({ "POST /api/auth/password/reset": { status: 202, payload: { accepted: true } } });
    await expect(api.requestReset("ana@dominio.dev")).resolves.toEqual({ accepted: true });
    expect(sentBody(calls[0])).toEqual({ email: "ana@dominio.dev" });
  });

  it("confirmar el restablecimiento manda token y contraseña nueva", async () => {
    const { api, calls } = harness({ "POST /api/auth/password/reset/confirm": { status: 204 } });
    await expect(api.confirmReset("abc", "Nueva-1234")).resolves.toBeUndefined();
    expect(sentBody(calls[0])).toEqual({ token: "abc", newPassword: "Nueva-1234" });
  });

  it("verificar el correo manda el token del enlace", async () => {
    const { api, calls } = harness({ "POST /api/auth/verify-email": { status: 204 } });
    await expect(api.verifyEmail("abc")).resolves.toBeUndefined();
    expect(sentBody(calls[0])).toEqual({ token: "abc" });
  });

  it("un enlace usado se traduce en el aviso del servidor", async () => {
    const { api } = harness({
      "POST /api/auth/verify-email": { status: 400, payload: { error: "El enlace no es válido o ya se usó." } }
    });
    const error = await api.verifyEmail("usado").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("El enlace no es válido o ya se usó.");
  });

  it("lee lo que ocupa la cuenta y lo que se le permite ocupar", async () => {
    const { api, calls } = harness({
      "GET /api/account/usage": {
        payload: {
          usage: { projects: 3, files: 9, bytes: 1200 },
          limits: { maxProjectsPerUser: 25, maxBytesPerProject: 5242880 }
        }
      }
    });
    await expect(api.usage()).resolves.toEqual({
      projects: 3,
      files: 9,
      bytes: 1200,
      maxProjectsPerUser: 25,
      maxBytesPerProject: 5242880
    });
    expect(calls[0]?.url).toBe("/api/account/usage");
  });

  it("el bloqueo por intentos se propaga como ApiError", async () => {
    const { api } = harness({ "POST /api/auth/login": { status: 429, payload: { error: "Demasiados intentos fallidos." } } });
    const error = await api.login("ana@dominio.dev", "S3creta-fuerte").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
  });
});
