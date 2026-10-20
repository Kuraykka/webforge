import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeApp,
  cuentaVerificada,
  get,
  makeApp,
  mutate,
  post,
  type TestApp,
} from "../testing.ts";
import { userByEmail } from "../repositories/users.ts";

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

interface Uso {
  usage: { projects: number; files: number; bytes: number };
  limits: { maxProjectsPerUser: number; maxBytesPerProject: number };
}

async function account(email: string): Promise<string> {
  return cuentaVerificada(target, email);
}

/** Sube de categoría a la cuenta recién registrada: su cookie sigue sirviendo. */
async function adminAccount(email = "root@dominio.dev"): Promise<string> {
  const cookie = await account(email);
  const row = userByEmail(target.db, email);
  if (!row) throw new Error("El registro no dejó usuario en base.");
  target.db.run("update users set role = 'admin' where id = ?", row.id);
  return cookie;
}

async function crearProyecto(cookie: string, files: Record<string, string>, name = "Mi tienda"): Promise<string> {
  const res = await post(app, "/api/projects", { name, stack: "static", files }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

describe("/api/account/usage", () => {
  it("sin sesión no enseña el uso de nadie", async () => {
    const res = await get(app, "/api/account/usage");
    expect(res.statusCode).toBe(401);
  });

  it("suma los archivos y los bytes reales del contenido propio", async () => {
    const cookie = await account("ana@dominio.dev");
    await crearProyecto(cookie, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{color:red}" });

    const res = await get(app, "/api/account/usage", cookie);
    const body = data<Uso>(res);
    expect(res.statusCode).toBe(200);
    expect(body.usage.projects).toBe(1);
    expect(body.usage.files).toBe(2);
    expect(body.usage.bytes).toBe("<h1>Hola</h1>".length + "body{color:red}".length);
    expect(body.limits).toEqual({ maxProjectsPerUser: 25, maxBytesPerProject: 5 * 1024 * 1024 });
  });

  it("el uso de una cuenta no incluye lo que guarda otra", async () => {
    const ana = await account("ana@dominio.dev");
    const bob = await account("bob@dominio.dev");
    await crearProyecto(bob, { "index.html": "x".repeat(4096) }, "Tienda de bob");

    const body = data<Uso>(await get(app, "/api/account/usage", ana));
    expect(body.usage.projects).toBe(0);
    expect(body.usage.bytes).toBe(0);
  });

  it("un proyecto borrado deja de ocupar cuota", async () => {
    const cookie = await account("ana@dominio.dev");
    const id = await crearProyecto(cookie, { "index.html": "contenido" });
    expect(data<Uso>(await get(app, "/api/account/usage", cookie)).usage.projects).toBe(1);

    await mutate(app, "DELETE", `/api/projects/${id}`, undefined, cookie);
    const body = data<Uso>(await get(app, "/api/account/usage", cookie));
    expect(body.usage).toEqual({ projects: 0, files: 0, bytes: 0 });
  });

  it("la cuota la manda el servidor, no el navegador", async () => {
    const cookie = await account("ana@dominio.dev");
    await mutate(app, "PATCH", "/api/admin/settings", { maxProjectsPerUser: 3 }, await adminAccount());

    const body = data<Uso>(await get(app, "/api/account/usage", cookie));
    expect(body.limits.maxProjectsPerUser).toBe(3);
  });
});
