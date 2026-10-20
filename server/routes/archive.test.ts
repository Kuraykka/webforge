import type { FastifyInstance } from "fastify";
import { unzipSync, zipSync, strToU8 } from "fflate";
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
import { MANIFEST_PATH } from "../repositories/zip.ts";

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

async function account(email: string): Promise<string> {
  return cuentaVerificada(target, email);
}

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

const ARCHIVO = `/api/projects`;
const exportUrl = (id: string) => `${ARCHIVO}/${id}/export`;
const importUrl = `/api/projects/import`;

/** Sube un ZIP tal cual: el servidor lo recibe como bytes crudos. */
function subir(cookie: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return mutate(app, "POST", importUrl, bytes, cookie, { "content-type": "application/zip", ...headers });
}

const sinCabecera = (bytes: Uint8Array, cookie: string) =>
  app.inject({ method: "POST", url: importUrl, payload: bytes, headers: { "content-type": "application/zip", cookie } });

async function exportar(cookie: string, id: string) {
  return get(app, exportUrl(id), cookie);
}

const ficha = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(unzipSync(bytes)[MANIFEST_PATH])) as object;

describe("/api/projects/:id/export", () => {
  it("sin sesión no se descarga ningún proyecto", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "<h1>Hola</h1>" });
    expect((await exportar("", id)).statusCode).toBe(401);
  });

  it("lo que no es tuyo no se descarga", async () => {
    const ana = await account("ana@dominio.dev");
    const bob = await account("bob@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "secreto" });
    expect((await exportar(bob, id)).statusCode).toBe(404);
  });

  it("el dueño descarga un ZIP con sus archivos de texto", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{color:red}" });

    const res = await exportar(ana, id);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    const abiert = unzipSync(new Uint8Array(res.rawPayload));
    expect(new TextDecoder().decode(abiert["index.html"])).toBe("<h1>Hola</h1>");
    expect(new TextDecoder().decode(abiert["css/base.css"])).toBe("body{color:red}");
  });

  it("la ficha del ZIP describe el proyecto", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "x" }, "Tienda de Barrio");
    await mutate(app, "PATCH", `/api/projects/${id}`, { tags: ["tienda"], status: "listo" }, ana);

    const cuerpo = ficha(new Uint8Array((await exportar(ana, id)).rawPayload)) as Record<string, unknown>;
    expect(cuerpo.name).toBe("Tienda de Barrio");
    expect(cuerpo.stack).toBe("static");
    expect(cuerpo.status).toBe("listo");
    expect(cuerpo.tags).toEqual(["tienda"]);
  });

  it("el nombre propuesto para la descarga sale del nombre del proyecto", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "x" }, "Tienda de Barrio");
    const disposition = String((await exportar(ana, id)).headers["content-disposition"]);
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("tienda-de-barrio.zip");
  });

  it("exportar deja rastro en el historial", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "x" });
    await exportar(ana, id);
    const history = data<{ history: { action: string }[] }>(await get(app, `/api/projects/${id}/history`, ana)).history;
    expect(history.some((entry) => entry.action === "Proyecto exportado")).toBe(true);
  });

  it("un proyecto sin archivos también se exporta", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, {});
    const res = await exportar(ana, id);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(unzipSync(new Uint8Array(res.rawPayload)))).toEqual([MANIFEST_PATH]);
  });
});

describe("/api/projects/import", () => {
  it("sin sesión no se importa nada", async () => {
    const ana = await account("ana@dominio.dev");
    const bytes = new Uint8Array((await exportar(ana, await crearProyecto(ana, { "index.html": "x" }))).rawPayload);
    expect((await subir("", bytes)).statusCode).toBe(401);
  });

  it("sin la cabecera de la aplicación no se importa", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "x" });
    const bytes = new Uint8Array((await exportar(ana, id)).rawPayload);
    expect((await sinCabecera(bytes, ana)).statusCode).toBe(403);
  });

  it("importar crea un proyecto con sus archivos", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{color:red}" }, "Tienda");
    const bytes = new Uint8Array((await exportar(ana, id)).rawPayload);

    const bob = await account("bob@dominio.dev");
    const res = await subir(bob, bytes);
    expect(res.statusCode).toBe(201);
    const nuevo = data<{ project: { id: string; name: string; stack: string } }>(res).project;
    expect(nuevo.name).toBe("Tienda");
    expect(nuevo.stack).toBe("static");

    const files = data<{ files: { path: string }[] }>(await get(app, `/api/projects/${nuevo.id}/files`, bob)).files;
    expect(files.map((file) => file.path).sort()).toEqual(["css/base.css", "index.html"]);
    const content = data<{ file: { content: string } }>(
      await get(app, `/api/projects/${nuevo.id}/files/content?path=index.html`, bob)
    );
    expect(content.file.content).toBe("<h1>Hola</h1>");
  });

  it("lo importado pertenece a quien importa, no a quien lo exportó", async () => {
    const ana = await account("ana@dominio.dev");
    const id = await crearProyecto(ana, { "index.html": "x" });
    const bytes = new Uint8Array((await exportar(ana, id)).rawPayload);

    const bob = await account("bob@dominio.dev");
    const nuevo = data<{ project: { id: string } }>(await subir(bob, bytes)).project;

    expect((await get(app, `/api/projects/${nuevo.id}`, ana)).statusCode).toBe(404);
    expect((await get(app, `/api/projects/${nuevo.id}`, bob)).statusCode).toBe(200);
  });

  it("la importación queda contada en el historial", async () => {
    const ana = await account("ana@dominio.dev");
    const bytes = new Uint8Array((await exportar(ana, await crearProyecto(ana, { "index.html": "x" }))).rawPayload);
    const bob = await account("bob@dominio.dev");
    const nuevo = data<{ project: { id: string } }>(await subir(bob, bytes)).project;
    const history = data<{ history: { action: string }[] }>(await get(app, `/api/projects/${nuevo.id}/history`, bob)).history;
    expect(history.some((entry) => /Creado desde un ZIP/.test(entry.action))).toBe(true);
  });

  it("unos bytes que no son un ZIP se rechazan", async () => {
    const bob = await account("bob@dominio.dev");
    const res = await subir(bob, strToU8("esto no es un zip"));
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toContain("ZIP");
  });

  it("un ZIP sin la ficha de WebForge se rechaza", async () => {
    const bob = await account("bob@dominio.dev");
    const ajeno = buildZipSueltos({ "index.html": "<h1>Sueltos</h1>" });
    expect((await subir(bob, ajeno)).statusCode).toBe(400);
  });

  it("una pila que no existe en la plataforma se rechaza", async () => {
    const bob = await account("bob@dominio.dev");
    const inventada = buildZipSueltos({
      [MANIFEST_PATH]: JSON.stringify({ format: "webforge.project", version: 1, name: "Raro", stack: "cobol" }),
      "index.html": "x"
    });
    const res = await subir(bob, inventada);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toContain("cobol");
  });

  it("la cuota de proyectos se aplica también al importar", async () => {
    await mutate(app, "PATCH", "/api/admin/settings", { maxProjectsPerUser: 1 }, await adminAccount());
    const ana = await account("ana@dominio.dev");
    const bytes = new Uint8Array((await exportar(ana, await crearProyecto(ana, { "index.html": "x" }))).rawPayload);
    expect((await subir(ana, bytes)).statusCode).toBe(409);
  });

  it("un proyecto sin archivos no se puede importar", async () => {
    const ana = await account("ana@dominio.dev");
    const bytes = new Uint8Array((await exportar(ana, await crearProyecto(ana, {}))).rawPayload);
    const bob = await account("bob@dominio.dev");
    expect((await subir(bob, bytes)).statusCode).toBe(400);
  });
});

/** ZIP fabricado a mano para probar rechazos, sin pasar por el exportador. */
function buildZipSueltos(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])));
}
