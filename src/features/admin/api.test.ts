import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, type FetchLike } from "../../lib/api";
import { createAdminApi, type AdminAccount, type AdminSettings } from "./api";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

const ACCOUNT: AdminAccount = {
  id: "u1",
  email: "ana@dominio.dev",
  username: "ana",
  role: "user",
  status: "activa",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z",
  verifiedAt: null,
  lastLoginAt: null,
  lockedUntil: null,
  failedAttempts: 2,
  twoFactorEnabled: false,
  projects: 2,
  files: 5,
  bytes: 1024
};

const SETTINGS: AdminSettings = {
  allowRegistration: true,
  maxProjectsPerUser: 25,
  maxBytesPerProject: 5242880
};

const METRICS = {
  accounts: { total: 3, admins: 1, suspended: 0, verified: 2 },
  projects: { total: 7, byStatus: { borrador: 4, en_desarrollo: 2, listo: 1 } },
  files: { total: 40, bytes: 120_000 },
  sessions: { active: 5 },
  activity: { events: 9 }
};

const SERVICES = {
  database: { status: "ok", writable: true, file: "/tmp/webforge.sqlite" },
  mail: { status: "sin-proveedor" },
  outbox: { pending: 2 },
  app: { env: "development", node: "v24.18.0", uptimeSeconds: 12 }
};

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
  return { api: createAdminApi(createApiClient(fetchImpl)), calls };
}

function sentBody(call: Recorded | undefined): unknown {
  return JSON.parse(call?.body ?? "{}");
}

describe("createAdminApi", () => {
  it("lee las métricas de uso", async () => {
    const { api, calls } = harness({ "GET /api/admin/metrics": { payload: { metrics: METRICS } } });
    await expect(api.metrics()).resolves.toEqual(METRICS);
    expect(calls[0]?.url).toBe("/api/admin/metrics");
  });

  it("lee el estado de los servicios", async () => {
    const { api } = harness({ "GET /api/admin/services": { payload: { services: SERVICES } } });
    await expect(api.services()).resolves.toEqual(SERVICES);
  });

  it("lista las cuentas con su uso", async () => {
    const { api } = harness({ "GET /api/admin/users": { payload: { users: [ACCOUNT] } } });
    await expect(api.users()).resolves.toEqual([ACCOUNT]);
  });

  it("pide la actividad con el límite que se le indique", async () => {
    const events = [{ id: "e1", actorId: "u1", actorEmail: "root@dominio.dev", action: "usuario.suspendido", targetUserId: "u2", detail: "1 sesiones cerradas", at: "2026-03-01T10:00:00.000Z" }];
    const { api, calls } = harness({ "GET /api/admin/activity?limit=25": { payload: { events } } });
    await expect(api.activity(25)).resolves.toEqual(events);
    expect(calls[0]?.url).toBe("/api/admin/activity?limit=25");
  });

  it("sin límite pedido deja decidir al servidor", async () => {
    const { api, calls } = harness({ "GET /api/admin/activity": { payload: { events: [] } } });
    await expect(api.activity()).resolves.toEqual([]);
    expect(calls[0]?.url).toBe("/api/admin/activity");
  });

  it("lee la configuración general", async () => {
    const { api } = harness({ "GET /api/admin/settings": { payload: { settings: SETTINGS } } });
    await expect(api.settings()).resolves.toEqual(SETTINGS);
  });

  it("manda solo los campos que han cambiado", async () => {
    const { api, calls } = harness({
      "PATCH /api/admin/settings": { payload: { settings: { ...SETTINGS, allowRegistration: false } } }
    });
    await expect(api.updateSettings({ allowRegistration: false })).resolves.toEqual({
      ...SETTINGS,
      allowRegistration: false
    });
    expect(sentBody(calls[0])).toEqual({ allowRegistration: false });
  });

  it("cambia el rol de una cuenta", async () => {
    const { api, calls } = harness({
      "PATCH /api/admin/users/u1": { payload: { user: { ...ACCOUNT, role: "admin" } } }
    });
    await expect(api.setRole("u1", "admin")).resolves.toEqual({ ...ACCOUNT, role: "admin" });
    expect(sentBody(calls[0])).toEqual({ role: "admin" });
  });

  it("cambia el estado de una cuenta", async () => {
    const { api, calls } = harness({
      "PATCH /api/admin/users/u1": { payload: { user: { ...ACCOUNT, status: "suspendida" } } }
    });
    await expect(api.setStatus("u1", "suspendida")).resolves.toEqual({ ...ACCOUNT, status: "suspendida" });
    expect(sentBody(calls[0])).toEqual({ status: "suspendida" });
  });

  it("desbloquear una cuenta llama a su ruta y devuelve la cuenta sin bloqueo", async () => {
    const { api, calls } = harness({
      "POST /api/admin/users/u1/unblock": { payload: { user: { ...ACCOUNT, lockedUntil: null, failedAttempts: 0 } } }
    });
    await expect(api.unblock("u1")).resolves.toEqual({ ...ACCOUNT, lockedUntil: null, failedAttempts: 0 });
    expect(calls[0]?.url).toBe("/api/admin/users/u1/unblock");
  });

  it("el borrado manda la confirmación con el correo", async () => {
    const { api, calls } = harness({ "DELETE /api/admin/users/u1": { status: 204 } });
    await expect(api.removeUser("u1", "ana@dominio.dev")).resolves.toBeUndefined();
    expect(sentBody(calls[0])).toEqual({ confirm: "ana@dominio.dev" });
  });

  it("un 403 se propaga con el mensaje del servidor", async () => {
    const { api } = harness({
      "GET /api/admin/users": { status: 403, payload: { error: "Hace falta un rol de administración." } }
    });
    const error = await api.users().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("Hace falta un rol de administración.");
  });
});
