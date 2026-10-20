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
import { SNIPPET_CHARS } from "../repositories/search.ts";

interface Proyecto {
  id: string;
  name: string;
  folder: string;
  updatedAt: string;
}
interface Archivo {
  projectId: string;
  projectName: string;
  path: string;
  line: number;
  snippet: string;
}
interface Resultados {
  term: string;
  projects: Proyecto[];
  files: Archivo[];
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

async function cuenta(email = "ana@dominio.dev"): Promise<string> {
  return cuentaVerificada(target, email);
}

const buscar = (cookie: string | null, q: string) =>
  get(app, `/api/search?q=${encodeURIComponent(q)}`, cookie);

async function crear(
  cookie: string,
  name: string,
  files: Record<string, string>,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const res = await post(app, "/api/projects", { name, stack: "static", files, ...extra }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

describe("GET /api/search", () => {
  it("devuelve el proyecto cuyo nombre encaja", async () => {
    const cookie = await cuenta();
    const id = await crear(cookie, "Mi tienda", { "index.html": "<p>hola</p>" });
    const res = await buscar(cookie, "tienda");
    expect(res.statusCode).toBe(200);
    const resultados = data<Resultados>(res);
    expect(resultados.term).toBe("tienda");
    expect(resultados.projects.map((p) => p.id)).toEqual([id]);
    expect(resultados.files).toEqual([]);
  });

  it("dice dónde está el texto dentro del archivo", async () => {
    const cookie = await cuenta();
    const id = await crear(cookie, "Blog", { "articulos/uno.md": "título\n\naquí está la palabra clave" });
    const resultados = data<Resultados>(await buscar(cookie, "palabra"));
    expect(resultados.files).toHaveLength(1);
    const hit = resultados.files[0];
    expect(Object.keys(hit ?? {}).sort()).toEqual(["line", "path", "projectId", "projectName", "snippet"]);
    expect(hit?.projectId).toBe(id);
    expect(hit?.path).toBe("articulos/uno.md");
    expect(hit?.line).toBe(3);
    expect(hit?.snippet).toContain("palabra");
  });

  it("sin sesión no hay búsqueda", async () => {
    expect((await buscar(null, "tienda")).statusCode).toBe(401);
  });

  it("una consulta vacía no recorre nada", async () => {
    const cookie = await cuenta();
    await crear(cookie, "Mi tienda", { "index.html": "x" });
    const res = await get(app, "/api/search", cookie);
    expect(res.statusCode).toBe(200);
    const resultados = data<Resultados>(res);
    expect(resultados.term).toBe("");
    expect(resultados.projects).toEqual([]);
    expect(resultados.files).toEqual([]);
  });

  it("un término de una letra se queda sin resultados", async () => {
    const cookie = await cuenta();
    await crear(cookie, "Mi tienda", { "index.html": "tienda" });
    expect(data<Resultados>(await buscar(cookie, "t")).files).toEqual([]);
  });

  it("un término interminable responde 400 con su explicación", async () => {
    const cookie = await cuenta();
    const res = await buscar(cookie, `x${"y".repeat(200)}`);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toContain("120 caracteres");
  });

  it("no cruza las cuentas ni delata lo ajeno", async () => {
    const propia = await cuenta();
    await crear(propia, "Proyecto propio", { "index.html": "secreto de ana" });
    const ajena = await cuenta("luis@dominio.dev");
    await crear(ajena, "Proyecto de luis", { "index.html": "secreto de luis" });
    expect(data<Resultados>(await buscar(propia, "secreto")).files.map((f) => f.projectName)).toEqual([
      "Proyecto propio"
    ]);
    expect(data<Resultados>(await buscar(ajena, "secreto")).files.map((f) => f.projectName)).toEqual([
      "Proyecto de luis"
    ]);
  });

  it("un proyecto borrado desaparece", async () => {
    const cookie = await cuenta();
    const id = await crear(cookie, "Mi tienda", { "index.html": "liquidación" });
    expect(data<Resultados>(await buscar(cookie, "liquidación")).files).toHaveLength(1);
    expect((await mutate(app, "DELETE", `/api/projects/${id}`, {}, cookie)).statusCode).toBe(204);
    expect(data<Resultados>(await buscar(cookie, "liquidación")).files).toEqual([]);
  });

  it("el fragmento trae un trozo, no el archivo entero", async () => {
    const cookie = await cuenta();
    const relleno = "a".repeat(400);
    await crear(cookie, "Mi tienda", { "index.html": `${relleno} busca_aqui ${relleno}` });
    const hit = data<Resultados>(await buscar(cookie, "busca_aqui")).files[0];
    expect((hit?.snippet ?? "").length).toBeLessThanOrEqual(SNIPPET_CHARS + 2);
    expect(hit?.snippet).not.toHaveLength(0);
  });

  it("la búsqueda no deja rastro en el historial", async () => {
    const cookie = await cuenta();
    const id = await crear(cookie, "Mi tienda", { "index.html": "sin rastro" });
    await buscar(cookie, "rastro");
    await buscar(cookie, "tienda");
    const historial = data<{ history: { action: string }[] }>(await get(app, `/api/projects/${id}/history`, cookie)).history;
    expect(historial).toHaveLength(1);
    expect(historial[0]?.action).toContain("creado");
  });

  it("los comodines no amplían la búsqueda", async () => {
    const cookie = await cuenta();
    await crear(cookie, "Alfa", { "index.html": "texto normal" });
    expect(data<Resultados>(await buscar(cookie, "%%")).files).toEqual([]);
    expect(data<Resultados>(await buscar(cookie, "__")).files).toEqual([]);
  });
});
