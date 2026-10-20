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

interface ProjectDto {
  id: string;
  name: string;
  description: string;
  folder: string;
  tags: string[];
  stack: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface FileDto {
  path: string;
  bytes: number;
  updatedAt: string;
  content?: string;
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

async function createProject(cookie: string, name = "Mi tienda", extra: Record<string, unknown> = {}) {
  const res = await post(app, "/api/projects", { name, stack: "static", ...extra }, cookie);
  return data<{ project: ProjectDto }>(res).project;
}

function filesUrl(id: string, path?: string) {
  const base = `/api/projects/${id}/files`;
  return path === undefined ? base : `${base}?path=${encodeURIComponent(path)}`;
}

async function withProject(cookie: string) {
  const project = await createProject(cookie);
  return project.id;
}

describe("proyectos · acceso", () => {
  it("sin sesión la lista responde 401", async () => {
    const res = await get(app, "/api/projects");
    expect(res.statusCode).toBe(401);
    expect(data<{ error: string }>(res).error).toMatch(/sesión/i);
  });

  it("cada cuenta ve solo sus proyectos", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await createProject(ana);
    await createProject(luis, "Tienda de Luis");
    const list = data<{ projects: ProjectDto[] }>(await get(app, "/api/projects", ana)).projects;
    expect(list.map((p) => p.id)).toEqual([deAna.id]);
    expect(data<{ projects: ProjectDto[] }>(await get(app, "/api/projects", luis)).projects).toHaveLength(1);
  });

  it("el proyecto de otra cuenta no existe", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await createProject(ana);
    expect((await get(app, `/api/projects/${deAna.id}`, luis)).statusCode).toBe(404);
    expect((await mutate(app, "PATCH", `/api/projects/${deAna.id}`, { name: "Secuestrado" }, luis)).statusCode).toBe(
      404
    );
    expect((await mutate(app, "DELETE", filesUrl(deAna.id, "index.html"), undefined, luis)).statusCode).toBe(404);
  });

  it("rechaza una pila que la plataforma no conoce", async () => {
    const cookie = await account();
    const res = await post(app, "/api/projects", { name: "Raro", stack: "cobol" }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/cobol/);
  });

  it("crea el proyecto con sus archivos iniciales en la misma petición", async () => {
    const cookie = await account();
    const res = await post(
      app,
      "/api/projects",
      { name: "Con plantilla", stack: "static", files: { "index.html": "<h1>Inicio</h1>", "styles.css": "body{}" } },
      cookie
    );
    expect(res.statusCode).toBe(201);
    const project = data<{ project: ProjectDto }>(res).project;
    const files = data<{ files: FileDto[] }>(await get(app, filesUrl(project.id), cookie)).files;
    expect(files.map((f) => f.path)).toEqual(["index.html", "styles.css"]);
  });

  it("una ruta insegura en los archivos iniciales es 400 y no deja proyecto", async () => {
    const cookie = await account();
    const res = await post(
      app,
      "/api/projects",
      { name: "Raro", stack: "static", files: { "../escape.txt": "x" } },
      cookie
    );
    expect(res.statusCode).toBe(400);
    expect(data<{ projects: ProjectDto[] }>(await get(app, "/api/projects", cookie)).projects).toEqual([]);
  });

  it("rechaza archivos iniciales que no son texto", async () => {
    const cookie = await account();
    const res = await post(
      app,
      "/api/projects",
      { name: "Raro", stack: "static", files: { "a.txt": 42 } },
      cookie
    );
    expect(res.statusCode).toBe(400);
  });

  it("rechaza un cuerpo que no es un objeto", async () => {
    const cookie = await account();
    expect((await post(app, "/api/projects", [], cookie)).statusCode).toBe(400);
  });

  it("rechaza un nombre vacío", async () => {
    const cookie = await account();
    expect((await post(app, "/api/projects", { name: "  ", stack: "static" }, cookie)).statusCode).toBe(400);
  });
});

describe("proyectos · editar", () => {
  it("devuelve el proyecto creado con sus campos", async () => {
    const cookie = await account();
    const created = await createProject(cookie, "Tienda", {
      description: "Inicio y contacto",
      folder: "clientes",
      tags: ["cliente"]
    });
    expect(created).toMatchObject({
      name: "Tienda",
      description: "Inicio y contacto",
      folder: "clientes",
      tags: ["cliente"],
      stack: "static",
      status: "borrador"
    });
    const detail = data<{ project: ProjectDto }>(await get(app, `/api/projects/${created.id}`, cookie));
    expect(detail.project.id).toBe(created.id);
  });

  it("renombrar deja nota en el historial", async () => {
    const cookie = await account();
    const project = await createProject(cookie);
    const res = await mutate(app, "PATCH", `/api/projects/${project.id}`, { name: "Renovado" }, cookie);
    expect(data<{ project: ProjectDto }>(res).project.name).toBe("Renovado");
    const history = data<{ history: { action: string }[] }>(
      await get(app, `/api/projects/${project.id}/history`, cookie)
    ).history;
    expect(history.map((h) => h.action)).toEqual(['Renombrado a "Renovado"', "Proyecto creado"]);
  });

  it("cambia el estado", async () => {
    const cookie = await account();
    const project = await createProject(cookie);
    const res = await mutate(app, "PATCH", `/api/projects/${project.id}`, { status: "listo" }, cookie);
    expect(data<{ project: ProjectDto }>(res).project.status).toBe("listo");
  });

  it("un estado imposible es 400", async () => {
    const cookie = await account();
    const project = await createProject(cookie);
    expect(
      (await mutate(app, "PATCH", `/api/projects/${project.id}`, { status: "publicado" }, cookie)).statusCode
    ).toBe(400);
  });
});

describe("proyectos · duplicar y borrar", () => {
  it("duplicar copia los archivos con otro nombre", async () => {
    const cookie = await account();
    const project = await createProject(cookie);
    await mutate(app, "PUT", `/api/projects/${project.id}/files/content?path=index.html`, { content: "<h1>Inicio</h1>" }, cookie);
    const copy = data<{ project: ProjectDto }>(
      await post(app, `/api/projects/${project.id}/duplicate`, {}, cookie)
    ).project;
    expect(copy.name).toBe(`${project.name} (copia)`);
    expect(copy.id).not.toBe(project.id);
    const list = data<{ files: FileDto[] }>(await get(app, filesUrl(copy.id), cookie)).files;
    expect(list.map((f) => f.path)).toEqual(["index.html"]);
    const content = data<{ file: FileDto }>(
      await get(app, `/api/projects/${copy.id}/files/content?path=index.html`, cookie)
    ).file;
    expect(content.content).toBe("<h1>Inicio</h1>");
  });

  it("borrar lo saca de la lista", async () => {
    const cookie = await account();
    const project = await createProject(cookie);
    expect((await mutate(app, "DELETE", `/api/projects/${project.id}`, undefined, cookie)).statusCode).toBe(204);
    expect(data<{ projects: ProjectDto[] }>(await get(app, "/api/projects", cookie)).projects).toEqual([]);
    expect((await get(app, `/api/projects/${project.id}`, cookie)).statusCode).toBe(404);
  });

  it("no se puede duplicar el proyecto de otra cuenta", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await createProject(ana);
    expect((await post(app, `/api/projects/${deAna.id}/duplicate`, {}, luis)).statusCode).toBe(404);
  });
});

describe("archivos", () => {
  it("escribe y lee el contenido de una ruta", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    const written = await mutate(app, "PUT", `/api/projects/${id}/files/content?path=src/app.js`, {
      content: "console.log(1)"
    }, cookie);
    expect(written.statusCode).toBe(200);
    expect(data<{ file: FileDto }>(written).file).toMatchObject({ path: "src/app.js", bytes: 14 });
    const read = await get(app, `/api/projects/${id}/files/content?path=src/app.js`, cookie);
    expect(data<{ file: FileDto }>(read).file.content).toBe("console.log(1)");
  });

  it("la lista no trae el contenido", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=index.html`, { content: "<h1>Hola</h1>" }, cookie);
    const list = data<{ files: FileDto[] }>(await get(app, filesUrl(id), cookie)).files;
    expect(list).toHaveLength(1);
    expect(list[0]?.content).toBeUndefined();
  });

  it("crear una ruta libre y fallar si ya está ocupada", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    const created = await post(app, filesUrl(id), { path: "nuevo.txt", content: "vacio" }, cookie);
    expect(created.statusCode).toBe(201);
    const again = await post(app, filesUrl(id), { path: "nuevo.txt", content: "otro" }, cookie);
    expect(again.statusCode).toBe(409);
    expect(data<{ file: FileDto }>(await get(app, `/api/projects/${id}/files/content?path=nuevo.txt`, cookie)).file.content).toBe(
      "vacio"
    );
  });

  it("renombrar mueve el contenido", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=a.html`, { content: "uno" }, cookie);
    const res = await mutate(app, "PATCH", filesUrl(id), { from: "a.html", to: "b.html" }, cookie);
    expect(data<{ file: FileDto }>(res).file.path).toBe("b.html");
    expect((await get(app, `/api/projects/${id}/files/content?path=a.html`, cookie)).statusCode).toBe(404);
  });

  it("renombrar a una ruta ocupada es 409", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=a.html`, { content: "uno" }, cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=b.html`, { content: "dos" }, cookie);
    expect((await mutate(app, "PATCH", filesUrl(id), { from: "a.html", to: "b.html" }, cookie)).statusCode).toBe(409);
  });

  it("borrar deja de enumerar la ruta", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=a.html`, { content: "uno" }, cookie);
    expect((await mutate(app, "DELETE", filesUrl(id, "a.html"), undefined, cookie)).statusCode).toBe(204);
    expect(data<{ files: FileDto[] }>(await get(app, filesUrl(id), cookie)).files).toEqual([]);
    expect((await mutate(app, "DELETE", filesUrl(id, "a.html"), undefined, cookie)).statusCode).toBe(404);
  });

  it("rechaza rutas que salen del proyecto", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    const res = await mutate(app, "PUT", `/api/projects/${id}/files/content?path=../../etc/passwd`, {
      content: "x"
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/fuera del proyecto/);
  });

  it("rechaza un archivo por encima del límite", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    const res = await mutate(app, "PUT", `/api/projects/${id}/files/content?path=grande.txt`, {
      content: "x".repeat(513 * 1024)
    }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/512 KB/);
  });

  it("sin la cabecera de la aplicación, escribir es 403", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}/files/content?path=a.html`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ content: "uno" })
    });
    expect(res.statusCode).toBe(403);
  });

  it("sin sesión no se lee ningún archivo", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    await mutate(app, "PUT", `/api/projects/${id}/files/content?path=a.html`, { content: "uno" }, cookie);
    expect((await get(app, `/api/projects/${id}/files/content?path=a.html`)).statusCode).toBe(401);
    expect((await get(app, filesUrl(id))).statusCode).toBe(401);
  });

  it("falta el contenido en el cuerpo: 400", async () => {
    const cookie = await account();
    const id = await withProject(cookie);
    expect((await mutate(app, "PUT", `/api/projects/${id}/files/content?path=a.html`, {}, cookie)).statusCode).toBe(
      400
    );
  });
});
