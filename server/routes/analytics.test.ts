import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeApp, cuentaVerificada, get, makeApp, mutate, post, type TestApp } from "../testing.ts";

interface AnalyticsDto {
  projectId: string;
  enabled: boolean;
  measurementId: string;
  trackCta: boolean;
  trackForms: boolean;
  thankYouPaths: string;
  updatedAt: string | null;
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

async function proyecto(cookie: string, files: Record<string, string> = { "index.html": "<!doctype html><html><head></head><body><a data-cta href='/x'>Comprar</a></body></html>" }) {
  const res = await post(app, "/api/projects", { name: "Mi tienda", stack: "static", files }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

const base = (id: string) => `/api/projects/${id}/analitica`;
const leer = (cookie: string | null, id: string) => get(app, base(id), cookie);
const guardar = (cookie: string | null, id: string, body: unknown) => mutate(app, "PUT", base(id), body, cookie);
const generar = (cookie: string | null, id: string) => post(app, `${base(id)}/generar`, {}, cookie);
const contenido = (id: string, path: string) =>
  target.db.get<{ content: string }>("select content from project_files where project_id = ? and path = ?", id, path)
    ?.content ?? "";

describe("/api/projects/:id/analitica", () => {
  it("sin sesión no se lee ni se escribe; un proyecto ajeno es 404", async () => {
    expect((await leer(null, "cualquiera")).statusCode).toBe(401);
    expect((await guardar(null, "cualquiera", { enabled: true })).statusCode).toBe(401);
    const cookie = await cuentaVerificada(target);
    const ajeno = await cuentaVerificada(target, "luis@dominio.dev");
    const id = await proyecto(ajeno);
    expect((await leer(cookie, id)).statusCode).toBe(404);
    expect((await guardar(cookie, id, { enabled: true })).statusCode).toBe(404);
    expect((await generar(cookie, id)).statusCode).toBe(404);
  });

  it("un proyecto nuevo tiene la analítica apagada", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    expect(data<{ analytics: AnalyticsDto }>(await leer(cookie, id)).analytics).toMatchObject({
      projectId: id,
      enabled: false,
      measurementId: "",
      trackCta: true,
      trackForms: true,
      updatedAt: null
    });
  });

  it("guarda el identificador en mayúsculas y conserva lo que no llega", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const primero = await guardar(cookie, id, { enabled: true, measurementId: "g-abc123xyz", thankYouPaths: "/gracias.html" });
    expect(primero.statusCode).toBe(200);
    expect(data<{ analytics: AnalyticsDto }>(primero).analytics).toMatchObject({ measurementId: "G-ABC123XYZ", enabled: true });
    const segundo = await guardar(cookie, id, { trackCta: false });
    expect(data<{ analytics: AnalyticsDto }>(segundo).analytics).toMatchObject({ measurementId: "G-ABC123XYZ", trackCta: false });
  });

  it("un identificador que no es de GA4 responde 400", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await guardar(cookie, id, { enabled: true, measurementId: "UA-123" });
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/G-/);
  });
});

describe("/api/projects/:id/analitica/generar", () => {
  it("escribe analytics.js y lo engancha con consentimiento previo", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, {
      enabled: true,
      measurementId: "G-ABC123XYZ",
      thankYouPaths: "/gracias.html"
    });

    const res = await generar(cookie, id);
    expect(res.statusCode).toBe(200);
    const generado = data<{ generated: { files: string[]; pages: number; enabled: boolean } }>(res).generated;
    expect([...generado.files].sort()).toEqual(["analytics.js", "index.html"]);
    expect(generado.pages).toBe(1);
    expect(generado.enabled).toBe(true);

    const html = contenido(id, "index.html");
    expect(html).toContain("webforge:analitica:inicio");
    expect(html).toContain('<script src="analytics.js" defer></script>');
    const js = contenido(id, "analytics.js");
    expect(js).toContain('"G-ABC123XYZ"');
    expect(js).toContain("Solo se activa si lo aceptas");
    expect(js).toContain('"thank_you_view"');
    expect(await (await get(app, `/api/projects/${id}/history`, cookie)).payload).toMatch(/Analítica GA4 generada/);
  });

  it("apagarla quita el bloque y borra el cargador", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, { enabled: true, measurementId: "G-ABC123XYZ" });
    await generar(cookie, id);
    expect(contenido(id, "analytics.js")).toContain("G-ABC123XYZ");

    await guardar(cookie, id, { enabled: false });
    const res = await generar(cookie, id);
    expect(res.statusCode).toBe(200);
    expect(data<{ generated: { enabled: boolean } }>(res).generated.enabled).toBe(false);
    expect(contenido(id, "index.html")).not.toContain("webforge:analitica");
    expect(target.db.get("select path from project_files where project_id = ? and path = 'analytics.js'", id)).toBeUndefined();
    expect(await (await get(app, `/api/projects/${id}/history`, cookie)).payload).toMatch(/Analítica retirada/);
  });

  it("un proyecto sin páginas html lo dice en vez de escribir un cargador suelto", async () => {
    const cookie = await cuentaVerificada(target);
    const res = await post(app, "/api/projects", { name: "Sin páginas", stack: "static", files: {} }, cookie);
    const id = data<{ project: { id: string } }>(res).project.id;
    const generado = await generar(cookie, id);
    expect(generado.statusCode).toBe(400);
    expect(data<{ error: string }>(generado).error).toMatch(/página/i);
    expect(target.db.get("select path from project_files where project_id = ?", id)).toBeUndefined();
  });
});
