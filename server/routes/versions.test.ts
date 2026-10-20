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

interface VersionDto {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  files: number;
  bytes: number;
}

interface FileDto {
  path: string;
  bytes: number;
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

async function proyecto(cookie: string, files: Record<string, string>): Promise<string> {
  const res = await post(app, "/api/projects", { name: "Mi tienda", stack: "static", files }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

const url = (id: string, versionId?: string) => `/api/projects/${id}/versions${versionId ? `/${versionId}` : ""}`;

async function guardar(cookie: string, projectId: string, label?: string) {
  return post(app, url(projectId), label === undefined ? {} : { label }, cookie);
}

async function versiones(cookie: string, projectId: string): Promise<VersionDto[]> {
  return data<{ versions: VersionDto[] }>(await get(app, url(projectId), cookie)).versions;
}

async function contenido(cookie: string, projectId: string, path: string): Promise<string | undefined> {
  const res = await get(app, `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, cookie);
  return res.statusCode === 200 ? data<{ file: FileDto }>(res).file.content : undefined;
}

describe("versiones · lectura", () => {
  it("sin sesión no se listan versiones", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    expect((await get(app, url(projectId))).statusCode).toBe(401);
  });

  it("la lista empieza vacía", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    expect(await versiones(ana, projectId)).toEqual([]);
  });

  it("las versiones de otra cuenta no existen", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const projectId = await proyecto(ana, { "index.html": "secreto" });
    await guardar(ana, projectId, "Suya");
    expect((await get(app, url(projectId), luis)).statusCode).toBe(404);
    const ajena = (await versiones(ana, projectId))[0];
    expect((await get(app, url(projectId, ajena?.id ?? "no-existe"), luis)).statusCode).toBe(404);
  });

  it("el detalle devuelve el contenido y la lista no", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "<h1>Hola</h1>" });
    const guardada = data<{ version: VersionDto }>(await guardar(ana, projectId, "Inicial")).version;
    expect(Object.keys(guardada)).toEqual(["id", "projectId", "label", "createdAt", "files", "bytes"]);
    const detalle = data<{ version: VersionDto & { content: FileDto[] } }>(
      await get(app, url(projectId, guardada.id), ana)
    );
    expect(detalle.version.content).toEqual([{ path: "index.html", content: "<h1>Hola</h1>" }]);
  });
});

describe("versiones · guardar", () => {
  it("guarda el estado actual con su etiqueta y sus medidas", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{}" });
    const res = await guardar(ana, projectId, "Antes del rediseño");
    expect(res.statusCode).toBe(201);
    const version = data<{ version: VersionDto }>(res).version;
    expect(version).toMatchObject({ projectId, label: "Antes del rediseño", files: 2, bytes: "<h1>Hola</h1>".length + "body{}".length });
    expect((await versiones(ana, projectId)).map((v) => v.label)).toEqual(["Antes del rediseño"]);
  });

  it("sin etiqueta decide el servidor", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    const version = data<{ version: VersionDto }>(await guardar(ana, projectId)).version;
    expect(version.label).toBe("Versión manual");
  });

  it("una etiqueta desbordada se rechaza sin dejar versión", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    const res = await guardar(ana, projectId, "e".repeat(121));
    expect(res.statusCode).toBe(400);
    expect(await versiones(ana, projectId)).toEqual([]);
  });

  it("quedarse sin hueco para la última no borra las que ya había", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    for (let i = 0; i < 22; i += 1) await guardar(ana, projectId, `v${i}`);
    const lista = await versiones(ana, projectId);
    expect(lista).toHaveLength(20);
    expect(lista[0]?.label).toBe("v21");
    expect(lista.at(-1)?.label).toBe("v2");
  });

  it("guardar una versión deja rastro en el historial", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    await guardar(ana, projectId, "Hito");
    const history = data<{ history: { action: string }[] }>(await get(app, `/api/projects/${projectId}/history`, ana)).history;
    expect(history.map((entry) => entry.action)).toContain("Versión guardada: Hito");
  });
});

describe("versiones · recuperar", () => {
  it("restaurar deja los archivos como estaban y guarda lo que había", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{}" });
    const version = data<{ version: VersionDto }>(await guardar(ana, projectId, "Buena")).version;

    await mutate(app, "PUT", `/api/projects/${projectId}/files/content?path=index.html`, { content: "<h1>Rota</h1>" }, ana);
    await mutate(app, "PATCH", `/api/projects/${projectId}/files`, { from: "css/base.css", to: "css/extra.css" }, ana);

    const res = await post(app, url(projectId, `${version.id}/restore`), {}, ana);
    expect(res.statusCode).toBe(200);
    expect(await contenido(ana, projectId, "index.html")).toBe("<h1>Hola</h1>");
    expect(await contenido(ana, projectId, "css/base.css")).toBe("body{}");
    expect(await contenido(ana, projectId, "css/extra.css")).toBeUndefined();

    const [seguridad, antigua] = await versiones(ana, projectId);
    expect(seguridad?.label).toBe("Antes de recuperar «Buena»");
    expect(antigua?.label).toBe("Buena");
  });

  it("una recuperación fallida se puede deshacer con la versión de seguridad", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "v1" });
    const primera = data<{ version: VersionDto }>(await guardar(ana, projectId, "Primera")).version;
    await mutate(app, "PUT", `/api/projects/${projectId}/files/content?path=index.html`, { content: "v2" }, ana);
    const segunda = data<{ version: VersionDto }>(await guardar(ana, projectId, "Segunda")).version;

    await post(app, url(projectId, `${primera.id}/restore`), {}, ana);
    expect(await contenido(ana, projectId, "index.html")).toBe("v1");
    await post(app, url(projectId, `${segunda.id}/restore`), {}, ana);
    expect(await contenido(ana, projectId, "index.html")).toBe("v2");
  });

  it("una versión que no es de esa cuenta no restaura nada", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana, { "index.html": "suyo" });
    const ajena = await proyecto(luis, { "index.html": "mío" });
    const version = data<{ version: VersionDto }>(await guardar(luis, ajena, "Mía")).version;

    const res = await post(app, url(deAna, `${version.id}/restore`), {}, ana);
    expect(res.statusCode).toBe(404);
    expect(await contenido(ana, deAna, "index.html")).toBe("suyo");
  });

  it("sin sesión no se restaura nada", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    const version = data<{ version: VersionDto }>(await guardar(ana, projectId)).version;
    expect((await post(app, url(projectId, `${version.id}/restore`), {})).statusCode).toBe(401);
  });
});

describe("versiones · borrar", () => {
  it("borrar una versión deja las demás intactas", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    const primera = data<{ version: VersionDto }>(await guardar(ana, projectId, "Primera")).version;
    await guardar(ana, projectId, "Segunda");
    const res = await mutate(app, "DELETE", url(projectId, primera.id), undefined, ana);
    expect(res.statusCode).toBe(204);
    expect((await versiones(ana, projectId)).map((v) => v.label)).toEqual(["Segunda"]);
  });

  it("borrar la versión de otra cuenta responde 404", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana, { "index.html": "x" });
    const version = data<{ version: VersionDto }>(await guardar(ana, deAna, "Suya")).version;
    expect((await mutate(app, "DELETE", url(deAna, version.id), undefined, luis)).statusCode).toBe(404);
    expect(await versiones(ana, deAna)).toHaveLength(1);
  });

  it("sin sesión no se borra", async () => {
    const ana = await account();
    const projectId = await proyecto(ana, { "index.html": "x" });
    const version = data<{ version: VersionDto }>(await guardar(ana, projectId)).version;
    expect((await mutate(app, "DELETE", url(projectId, version.id))).statusCode).toBe(401);
    expect(await versiones(ana, projectId)).toHaveLength(1);
  });
});
