import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeApp, cuentaVerificada, get, makeApp, mutate, PASSWORD, post, type TestApp } from "../testing.ts";
import { userByEmail } from "../repositories/users.ts";
import type { AdminEvent } from "../repositories/admin-events.ts";

interface AdminUserDto {
  id: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  projects: number;
  bytes: number;
  lockedUntil: string | null;
  failedAttempts: number;
}

interface MetricsDto {
  accounts: { total: number; admins: number; suspended: number; verified: number };
  projects: { total: number; byStatus: Record<string, number> };
  files: { total: number; bytes: number };
  sessions: { active: number };
  activity: { events: number };
  analytics: { enabledProjects: number };
}

interface SettingsDto {
  allowRegistration: boolean;
  maxProjectsPerUser: number;
  maxBytesPerProject: number;
}

let target: TestApp;
let app: FastifyInstance;

beforeEach(() => {
  target = makeApp();
  app = target.app;
});

afterEach(async () => {
  await closeApp(target);
});

function data<T>(res: { payload: string }): T {
  return JSON.parse(res.payload) as T;
}

async function account(email = "ana@dominio.dev"): Promise<string> {
  return cuentaVerificada(target, email);
}

/** Sube de categoría a la cuenta y devuelve su cookie, que sigue válida. */
async function adminAccount(email = "root@dominio.dev"): Promise<string> {
  const cookie = await account(email);
  const row = userByEmail(target.db, email);
  if (!row) throw new Error("El registro no dejó usuario en base.");
  target.db.run("update users set role = 'admin' where id = ?", row.id);
  return cookie;
}

async function createProject(cookie: string, name = "Mi tienda"): Promise<string> {
  const res = await post(app, "/api/projects", { name, stack: "static" }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

function idOf(email: string): string {
  const row = userByEmail(target.db, email);
  if (!row) throw new Error(`No existe la cuenta ${email}.`);
  return row.id;
}

describe("administración · acceso", () => {
  it("sin sesión las rutas de administración responden 401", async () => {
    for (const url of ["/api/admin/metrics", "/api/admin/users", "/api/admin/activity", "/api/admin/settings"]) {
      expect((await get(app, url)).statusCode).toBe(401);
    }
  });

  it("un usuario normal recibe 403 sin revelar qué haría falta", async () => {
    const cookie = await account("ana@dominio.dev");
    const res = await get(app, "/api/admin/users", cookie);
    expect(res.statusCode).toBe(403);
    expect(data<{ error: string }>(res).error).toMatch(/administración/i);
    expect(res.payload.toLowerCase()).not.toContain("select");
  });

  it("el administrador sí entra", async () => {
    const cookie = await adminAccount();
    expect((await get(app, "/api/admin/metrics", cookie)).statusCode).toBe(200);
  });

  it("una mutación sin la cabecera propia sigue siendo 403", async () => {
    const cookie = await adminAccount();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/admin/settings",
      headers: { cookie, "content-type": "application/json" },
      payload: JSON.stringify({ allowRegistration: false })
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("administración · métricas y estado", () => {
  it("cuenta los proyectos con analítica sin exponer su configuración", async () => {
    const cookie = await adminAccount();
    const usuaria = await account("luis@dominio.dev");
    const creado = await post(
      app,
      "/api/projects",
      { name: "Con GA", stack: "static", files: { "index.html": "<html><body><h1>Hola</h1></body></html>" } },
      usuaria
    );
    const id = data<{ project: { id: string } }>(creado).project.id;
    const activada = await mutate(app, "PUT", `/api/projects/${id}/analitica`, { enabled: true, measurementId: "G-ABC123XYZ" }, usuaria);
    expect(activada.statusCode).toBe(200);

    const metrics = data<{ metrics: MetricsDto }>(await get(app, "/api/admin/metrics", cookie)).metrics;
    expect(metrics.analytics.enabledProjects).toBe(1);
    expect(JSON.stringify(metrics)).not.toContain("G-ABC123XYZ");
  });

  it("cuenta cuentas, proyectos, archivos y sesiones reales", async () => {
    const cookie = await adminAccount("root@dominio.dev");
    const otra = await account("luis@dominio.dev");
    const projectId = await createProject(otra);
    await post(app, `/api/projects/${projectId}/files`, { path: "notas.md", content: "# hola" }, otra);

    const res = await get(app, "/api/admin/metrics", cookie);
    const metrics = data<{ metrics: MetricsDto }>(res).metrics;
    expect(metrics.accounts.total).toBe(2);
    expect(metrics.accounts.admins).toBe(1);
    expect(metrics.projects.total).toBe(1);
    expect(metrics.projects.byStatus.borrador).toBe(1);
    expect(metrics.files.total).toBe(1);
    expect(metrics.files.bytes).toBeGreaterThan(0);
    expect(metrics.sessions.active).toBe(2);
  });

  it("el estado de los servicios dice la verdad sobre el correo", async () => {
    const cookie = await adminAccount();
    const res = await get(app, "/api/admin/services", cookie);
    const services = data<{ services: Record<string, unknown> }>(res).services;
    expect(services.database).toEqual(expect.objectContaining({ status: "ok", writable: true }));
    expect(services.mail).toEqual(expect.objectContaining({ status: "sin-proveedor" }));
    expect(services.outbox).toEqual(expect.objectContaining({ pending: expect.any(Number) }));
  });
});

describe("administración · cuentas", () => {
  it("lista las cuentas con su uso y sin datos internos", async () => {
    const cookie = await adminAccount();
    const otra = await account("luis@dominio.dev");
    await createProject(otra, "Tienda");
    await createProject(otra, "Blog");

    const res = await get(app, "/api/admin/users", cookie);
    const list = data<{ users: (AdminUserDto & Record<string, unknown>)[] }>(res).users;
    const luis = list.find((u) => u.email === "luis@dominio.dev");
    expect(luis?.projects).toBe(2);
    expect(luis?.role).toBe("user");
    expect(luis?.passwordHash).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain("password");
  });

  it("cambia el rol y queda registrado en la actividad", async () => {
    const cookie = await adminAccount();
    await account("luis@dominio.dev");
    const id = idOf("luis@dominio.dev");

    const res = await mutate(app, "PATCH", `/api/admin/users/${id}`, { role: "admin" }, cookie);
    expect(res.statusCode).toBe(200);
    expect(data<{ user: AdminUserDto }>(res).user.role).toBe("admin");

    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]).toEqual(
      expect.objectContaining({ action: "usuario.rol_cambiado", targetUserId: id, actorEmail: "root@dominio.dev" })
    );
  });

  it("no permite dejar la plataforma sin ningún administrador", async () => {
    const cookie = await adminAccount();
    await adminAccount("jefa@dominio.dev");
    const raiz = idOf("root@dominio.dev");

    // Con dos administradoras se puede bajar de categoría a una.
    expect((await mutate(app, "PATCH", `/api/admin/users/${idOf("jefa@dominio.dev")}`, { role: "user" }, cookie)).statusCode).toBe(200);

    // La que queda es la última: ni ella misma puede bajarse.
    const ultimo = await mutate(app, "PATCH", `/api/admin/users/${raiz}`, { role: "user" }, cookie);
    expect(ultimo.statusCode).toBe(409);
    expect(data<{ error: string }>(ultimo).error).toMatch(/administrador/i);
    expect(userByEmail(target.db, "root@dominio.dev")?.role).toBe("admin");
  });

  it("suspender una cuenta cierra sus sesiones y bloquea su cookie", async () => {
    const cookie = await adminAccount();
    const victim = await account("luis@dominio.dev");
    const id = idOf("luis@dominio.dev");

    const res = await mutate(app, "PATCH", `/api/admin/users/${id}`, { status: "suspendida" }, cookie);
    expect(res.statusCode).toBe(200);
    expect(data<{ user: AdminUserDto }>(res).user.status).toBe("suspendida");
    expect((await get(app, "/api/projects", victim)).statusCode).toBe(401);

    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]?.detail).toMatch(/sesiones cerradas/i);
  });

  it("reactivar devuelve el acceso al iniciar sesión de nuevo", async () => {
    const cookie = await adminAccount();
    await account("luis@dominio.dev");
    const id = idOf("luis@dominio.dev");
    await mutate(app, "PATCH", `/api/admin/users/${id}`, { status: "suspendida" }, cookie);

    // Mientras está suspendida no entra, con el mismo mensaje que una contraseña mala.
    expect((await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: PASSWORD })).statusCode).toBe(401);

    const back = await mutate(app, "PATCH", `/api/admin/users/${id}`, { status: "activa" }, cookie);
    expect(data<{ user: AdminUserDto }>(back).user.status).toBe("activa");
    const login = await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: PASSWORD });
    expect(login.statusCode).toBe(200);
  });

  it("la lista dice qué cuenta está bloqueada y cuánto le queda", async () => {
    const cookie = await adminAccount();
    await account("luis@dominio.dev");
    for (let intento = 0; intento < 3; intento++) {
      await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: "otra-contrasena-1234" });
    }

    const list = data<{ users: (AdminUserDto & Record<string, unknown>)[] }>(
      await get(app, "/api/admin/users", cookie)
    ).users;
    const luis = list.find((u) => u.email === "luis@dominio.dev");
    expect(luis?.lockedUntil).toBeTypeOf("string");
    expect(luis?.failedAttempts).toBe(3);
    expect((list.find((u) => u.email === "root@dominio.dev")?.lockedUntil ?? null)).toBeNull();
  });

  it("desbloquear borra los intentos y deja volver a entrar", async () => {
    const cookie = await adminAccount();
    await account("luis@dominio.dev");
    for (let intento = 0; intento < 3; intento++) {
      await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: "otra-contrasena-1234" });
    }
    expect((await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: PASSWORD })).statusCode).toBe(429);

    const id = idOf("luis@dominio.dev");
    const res = await mutate(app, "POST", `/api/admin/users/${id}/unblock`, {}, cookie);
    expect(res.statusCode).toBe(200);
    expect(data<{ user: AdminUserDto }>(res).user.lockedUntil).toBeNull();
    expect(target.db.get("select key from login_attempts")).toBeUndefined();
    expect((await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: PASSWORD })).statusCode).toBe(200);

    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]).toEqual(
      expect.objectContaining({ action: "usuario.desbloqueada", targetUserId: id, actorEmail: "root@dominio.dev" })
    );
  });

  it("desbloquear una cuenta inexistente responde 404 y sin sesión 401", async () => {
    const cookie = await adminAccount();
    expect((await mutate(app, "POST", "/api/admin/users/no-existe/unblock", {}, cookie)).statusCode).toBe(404);
    expect((await mutate(app, "POST", "/api/admin/users/whatever/unblock", {}, null)).statusCode).toBe(401);
  });

  it("la actividad de una cuenta guarda sesiones, IPs y resultados", async () => {
    const cookie = await adminAccount();
    const victima = await account("luis@dominio.dev");
    const id = idOf("luis@dominio.dev");
    await post(app, "/api/auth/login", { email: "luis@dominio.dev", password: "mala-clave-1234" });

    const actividad = data<{
      sessions: { id: string; ip: string; current: boolean }[];
      ips: { ip: string; count: number }[];
      events: { result: string; ip: string; userAgent: string }[];
    }>(await get(app, `/api/admin/users/${id}/activity`, cookie));
    expect(actividad.sessions.length).toBeGreaterThan(0);
    expect(actividad.sessions.every((s) => s.current === false)).toBe(true);
    expect(actividad.ips[0]).toMatchObject({ ip: "127.0.0.1" });
    expect(actividad.events[0]).toMatchObject({ result: "fallo", ip: "127.0.0.1" });
    expect((await get(app, "/api/auth/session", victima)).statusCode).toBe(200);
  });

  it("cerrar todas las sesiones de una cuenta las invalida", async () => {
    const cookie = await adminAccount();
    const victima = await account("luis@dominio.dev");
    const id = idOf("luis@dominio.dev");
    const res = await mutate(app, "POST", `/api/admin/users/${id}/revoke-sessions`, {}, cookie);
    expect(res.statusCode).toBe(200);
    expect(data<{ revoked: number }>(res).revoked).toBeGreaterThan(0);
    expect((await get(app, "/api/auth/session", victima)).statusCode).toBe(401);
    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]?.action).toBe("usuario.sesiones_cerradas");
  });

  it("la bandeja de correo se lista y sin SMTP no se finge el reenvío", async () => {
    const cookie = await adminAccount();
    const bandeja = data<{ messages: { recipient: string; sentAt: string | null; error: string | null }[] }>(
      await get(app, "/api/admin/outbox", cookie)
    ).messages;
    expect(bandeja.length).toBeGreaterThan(0);
    expect(bandeja.every((m) => m.sentAt === null)).toBe(true);

    const reintento = await mutate(app, "POST", "/api/admin/outbox/reintentar", {}, cookie);
    expect(reintento.statusCode).toBe(409);
    expect(data<{ error: string }>(reintento).error).toMatch(/SMTP/i);
  });

  it("borrar exige escribir el correo exacto y se lleva sus proyectos", async () => {
    const cookie = await adminAccount();
    const otra = await account("luis@dominio.dev");
    const projectId = await createProject(otra);
    const id = idOf("luis@dominio.dev");

    const bad = await mutate(app, "DELETE", `/api/admin/users/${id}`, { confirm: "otro@dominio.dev" }, cookie);
    expect(bad.statusCode).toBe(400);
    expect(userByEmail(target.db, "luis@dominio.dev")).toBeDefined();

    const ok = await mutate(app, "DELETE", `/api/admin/users/${id}`, { confirm: "luis@dominio.dev" }, cookie);
    expect(ok.statusCode).toBe(204);
    expect(userByEmail(target.db, "luis@dominio.dev")).toBeUndefined();
    expect(target.db.get("select path from project_files where project_id = ?", projectId)).toBeUndefined();
    expect((await get(app, "/api/projects", otra)).statusCode).toBe(401);

    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]?.action).toBe("usuario.eliminado");
  });

  it("no se puede borrar a sí mismo", async () => {
    const cookie = await adminAccount();
    const id = idOf("root@dominio.dev");
    const res = await mutate(app, "DELETE", `/api/admin/users/${id}`, { confirm: "root@dominio.dev" }, cookie);
    expect(res.statusCode).toBe(409);
    expect(data<{ error: string }>(res).error).toMatch(/tu propia cuenta/i);
  });

  it("una cuenta inexistente responde 404, no 500", async () => {
    const cookie = await adminAccount();
    expect((await mutate(app, "PATCH", "/api/admin/users/no-existe", { role: "admin" }, cookie)).statusCode).toBe(404);
    expect((await mutate(app, "DELETE", "/api/admin/users/no-existe", { confirm: "x@y.dev" }, cookie)).statusCode).toBe(404);
  });
});

describe("administración · configuración", () => {
  it("la configuración expone el registro y los límites", async () => {
    const cookie = await adminAccount();
    const res = await get(app, "/api/admin/settings", cookie);
    const settings = data<{ settings: SettingsDto }>(res).settings;
    expect(settings.allowRegistration).toBe(true);
    expect(settings.maxProjectsPerUser).toBeGreaterThan(0);
    expect(settings.maxBytesPerProject).toBeGreaterThan(settings.maxProjectsPerUser);
  });

  it("cerrar el registro desde el panel se nota en la API pública", async () => {
    const cookie = await adminAccount();
    const patched = await mutate(app, "PATCH", "/api/admin/settings", { allowRegistration: false }, cookie);
    expect(patched.statusCode).toBe(200);
    expect(data<{ settings: SettingsDto }>(patched).settings.allowRegistration).toBe(false);

    const res = await post(app, "/api/auth/register", { email: "nuevo@dominio.dev", password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(data<{ error: string }>(res).error).toMatch(/desactivado/i);
    expect((await get(app, "/api/auth/config")).payload).toContain('"registrationAllowed":false');

    const events = data<{ events: AdminEvent[] }>(await get(app, "/api/admin/activity", cookie)).events;
    expect(events[0]?.action).toBe("configuracion.actualizada");
  });

  it("rechaza límites absurdos con un mensaje claro", async () => {
    const cookie = await adminAccount();
    const res = await mutate(app, "PATCH", "/api/admin/settings", { maxProjectsPerUser: 0 }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/proyectos/i);
  });
});

describe("administración · cuota por cuenta", () => {
  it("un proyecto por encima del límite de bytes se rechaza", async () => {
    const cookie = await adminAccount();
    const usuaria = await account("luis@dominio.dev");
    await mutate(app, "PATCH", "/api/admin/settings", { maxBytesPerProject: 1500 }, cookie);

    const projectId = await createProject(usuaria);
    const first = await post(
      app,
      `/api/projects/${projectId}/files`,
      { path: "index.html", content: "x".repeat(1000) },
      usuaria
    );
    expect(first.statusCode).toBe(201);
    const second = await post(
      app,
      `/api/projects/${projectId}/files`,
      { path: "extra.html", content: "y".repeat(600) },
      usuaria
    );
    expect(second.statusCode).toBe(409);
    expect(data<{ error: string }>(second).error).toMatch(/límite de bytes del proyecto/i);
  });

  it("reescribir un archivo usa el hueco que deja el contenido viejo", async () => {
    const cookie = await adminAccount();
    const usuaria = await account("luis@dominio.dev");
    await mutate(app, "PATCH", "/api/admin/settings", { maxBytesPerProject: 1500 }, cookie);

    const projectId = await createProject(usuaria);
    await post(app, `/api/projects/${projectId}/files`, { path: "index.html", content: "x".repeat(1000) }, usuaria);
    const grown = await mutate(
      app,
      "PUT",
      `/api/projects/${projectId}/files/content?path=index.html`,
      { content: "z".repeat(1500) },
      usuaria
    );
    expect(grown.statusCode).toBe(200);
    const tooBig = await mutate(
      app,
      "PUT",
      `/api/projects/${projectId}/files/content?path=index.html`,
      { content: "z".repeat(1501) },
      usuaria
    );
    expect(tooBig.statusCode).toBe(409);
  });

  it("el límite de proyectos por cuenta se aplica al crear", async () => {
    const cookie = await adminAccount();
    const usuaria = await account("luis@dominio.dev");
    await mutate(app, "PATCH", "/api/admin/settings", { maxProjectsPerUser: 2 }, cookie);

    expect((await post(app, "/api/projects", { name: "Uno", stack: "static" }, usuaria)).statusCode).toBe(201);
    expect((await post(app, "/api/projects", { name: "Dos", stack: "static" }, usuaria)).statusCode).toBe(201);
    const third = await post(app, "/api/projects", { name: "Tres", stack: "static" }, usuaria);
    expect(third.statusCode).toBe(409);
    expect(data<{ error: string }>(third).error).toMatch(/límite de proyectos/i);
    // El administrador no se queda fuera de la plataforma por su propio límite.
    expect((await post(app, "/api/projects", { name: "Libre", stack: "static" }, cookie)).statusCode).toBe(201);
  });

  it("duplicar un proyecto también gasta la cuota", async () => {
    const cookie = await adminAccount();
    const usuaria = await account("luis@dominio.dev");
    const projectId = await createProject(usuaria);
    await mutate(app, "PATCH", "/api/admin/settings", { maxProjectsPerUser: 1 }, cookie);

    const res = await post(app, `/api/projects/${projectId}/duplicate`, {}, usuaria);
    expect(res.statusCode).toBe(409);
    expect(data<{ error: string }>(res).error).toMatch(/límite de proyectos/i);
  });
});

