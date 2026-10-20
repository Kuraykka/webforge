import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeApp, cuentaVerificada, get, makeApp, mutate, post, type TestApp } from "../testing.ts";

interface SeoDto {
  projectId: string;
  siteUrl: string;
  titleTemplate: string;
  description: string;
  language: string;
  ogImage: string;
  schemaType: string;
  noindex: boolean;
  sitemap: boolean;
  robotsExtra: string;
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

async function proyecto(cookie: string, name = "Mi tienda"): Promise<string> {
  const res = await post(app, "/api/projects", { name, stack: "static", files: { "index.html": "<h1>Hola</h1>" } }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

const base = (id: string) => `/api/projects/${id}/seo`;
const leer = (cookie: string | null, id: string) => get(app, base(id), cookie);
const guardar = (cookie: string | null, id: string, body: unknown) => mutate(app, "PUT", base(id), body, cookie);

describe("/api/projects/:id/seo", () => {
  it("sin sesión no se lee ni se escribe", async () => {
    expect((await leer(null, "cualquiera")).statusCode).toBe(401);
    expect((await guardar(null, "cualquiera", { description: "x" })).statusCode).toBe(401);
  });

  it("un proyecto inexistente o ajeno responde 404, no 403", async () => {
    const cookie = await cuentaVerificada(target);
    const ajeno = await cuentaVerificada(target, "luis@dominio.dev");
    const id = await proyecto(ajeno);
    expect((await leer(cookie, "no-existe")).statusCode).toBe(404);
    expect((await leer(cookie, id)).statusCode).toBe(404);
    expect((await guardar(cookie, id, { description: "x" })).statusCode).toBe(404);
  });

  it("un proyecto nuevo devuelve los valores de partida, sin fila guardada", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await leer(cookie, id);
    expect(res.statusCode).toBe(200);
    expect(data<{ seo: SeoDto }>(res).seo).toMatchObject({
      projectId: id,
      siteUrl: "",
      titleTemplate: "%s",
      description: "",
      language: "es",
      ogImage: "",
      schemaType: "WebSite",
      noindex: false,
      sitemap: false,
      robotsExtra: "",
      updatedAt: null
    });
    expect(target.db.get("select project_id from project_seo")).toBeUndefined();
  });

  it("guarda los ajustes y la siguiente lectura los devuelve", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await guardar(cookie, id, {
      siteUrl: "https://mitienda.dev/",
      titleTemplate: "%s · Mi tienda",
      description: "Bicicletas de barrio",
      language: "es-ES",
      ogImage: "/og.png",
      schemaType: "Store",
      noindex: true,
      sitemap: false
    });
    expect(res.statusCode).toBe(200);
    const guardado = data<{ seo: SeoDto }>(res).seo;
    expect(guardado).toMatchObject({ siteUrl: "https://mitienda.dev", language: "es-ES", schemaType: "Store", noindex: true });
    expect(guardado.updatedAt).toBeTypeOf("string");
    expect(data<{ seo: SeoDto }>(await leer(cookie, id)).seo).toEqual(guardado);
  });

  it("los campos que no llegan conservan lo que había", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, { description: "Primera", language: "en" });
    const res = await guardar(cookie, id, { description: "Segunda" });
    expect(data<{ seo: SeoDto }>(res).seo).toMatchObject({ description: "Segunda", language: "en" });
  });

  it("un dominio sin https se rechaza con el motivo", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await guardar(cookie, id, { siteUrl: "http://mitienda.dev" });
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/https/);
  });

  it("un sitemap sin dominio no se acepta", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await guardar(cookie, id, { sitemap: true });
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/dominio/i);
  });

  it("un tipo de schema inventado responde 400", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    const res = await guardar(cookie, id, { schemaType: "Producto" });
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/schema/i);
  });

  it("un campo con el tipo equivocado responde 400 sin tocar lo guardado", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, { description: "Buena" });
    expect((await guardar(cookie, id, { description: 7 })).statusCode).toBe(400);
    expect((await guardar(cookie, id, { noindex: "sí" })).statusCode).toBe(400);
    expect(data<{ seo: SeoDto }>(await leer(cookie, id)).seo.description).toBe("Buena");
  });
});

const generar = (cookie: string | null, id: string) => post(app, `${base(id)}/generar`, {}, cookie);
const contenido = (id: string, path: string) =>
  target.db.get<{ content: string }>("select content from project_files where project_id = ? and path = ?", id, path)
    ?.content ?? "";

describe("/api/projects/:id/seo/generar", () => {
  it("sin sesión o en un proyecto ajeno no se genera nada", async () => {
    expect((await generar(null, "cualquiera")).statusCode).toBe(401);
    const cookie = await cuentaVerificada(target);
    const ajeno = await cuentaVerificada(target, "luis@dominio.dev");
    const id = await proyecto(ajeno);
    expect((await generar(cookie, id)).statusCode).toBe(404);
  });

  it("escribe sitemap, robots y la cabecera de cada página, con historial", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, {
      siteUrl: "https://mitienda.dev",
      titleTemplate: "%s · Mi tienda",
      description: "Bicicletas de barrio",
      sitemap: true,
      ogImage: "/og.png"
    });

    const res = await generar(cookie, id);
    expect(res.statusCode).toBe(200);
    const generado = data<{ generated: { files: string[]; pages: number } }>(res).generated;
    expect([...generado.files].sort()).toEqual(["index.html", "robots.txt", "sitemap.xml"]);
    expect(generado.pages).toBe(1);

    const html = contenido(id, "index.html");
    expect(html).toContain("webforge:seo:inicio");
    expect(html).toContain('<link rel="canonical" href="https://mitienda.dev">');
    expect(html).toContain('name="description" content="Bicicletas de barrio"');
    expect(html).toContain("<h1>Hola</h1>");
    expect(contenido(id, "sitemap.xml")).toContain("<loc>https://mitienda.dev</loc>");
    expect(contenido(id, "robots.txt")).toContain("Sitemap: https://mitienda.dev/sitemap.xml");

    const historial = await get(app, `/api/projects/${id}/history`, cookie);
    expect(historial.payload).toMatch(/SEO generado/);
  });

  it("sin dominio ni sitemap solo toca las páginas y no inventa robots", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, { description: "Sin dominio" });
    const res = await generar(cookie, id);
    expect(data<{ generated: { files: string[] } }>(res).generated.files).toEqual(["index.html"]);
    expect(contenido(id, "index.html")).toContain('<meta name="robots" content="index, follow">');
    expect(target.db.get("select path from project_files where project_id = ? and path = ?", id, "robots.txt")).toBeUndefined();
  });

  it("regenerar dos veces no duplica el bloque", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await proyecto(cookie);
    await guardar(cookie, id, { siteUrl: "https://mitienda.dev", description: "Bicis", sitemap: true });
    await generar(cookie, id);
    await generar(cookie, id);
    expect(contenido(id, "index.html").split("webforge:seo:inicio")).toHaveLength(2);
  });

  it("un proyecto sin páginas html lo dice en vez de escribir archivos sueltos", async () => {
    const cookie = await cuentaVerificada(target);
    const res = await post(app, "/api/projects", { name: "Sin páginas", stack: "static", files: {} }, cookie);
    const id = data<{ project: { id: string } }>(res).project.id;
    const generado = await generar(cookie, id);
    expect(generado.statusCode).toBe(400);
    expect(data<{ error: string }>(generado).error).toMatch(/página/i);
  });
});

describe("/api/projects/:id/seo/analisis", () => {
  const analizar = (cookie: string | null, id: string) => get(app, `${base(id)}/analisis`, cookie);

  const PAGINA = `<!doctype html><html lang="es"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inicio</title>
<meta name="description" content="Bicicletas de barrio">
</head><body><h1>Hola</h1><img src="bici.png" alt="Bici"><a href="contacto.html">Contacto</a></body></html>`;
  const OTRA = `<!doctype html><html lang="es"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contacto</title>
<meta name="description" content="Escríbenos">
</head><body><h1>Contacto</h1><a href="index.html">Volver</a></body></html>`;

  async function conDosPaginas(cookie: string): Promise<string> {
    const res = await post(
      app,
      "/api/projects",
      { name: "Mi tienda", stack: "static", files: { "index.html": PAGINA, "contacto.html": OTRA, "bici.png": "png" } },
      cookie
    );
    return data<{ project: { id: string } }>(res).project.id;
  }

  it("sin sesión responde 401 y un proyecto ajeno 404", async () => {
    expect((await analizar(null, "cualquiera")).statusCode).toBe(401);
    const cookie = await cuentaVerificada(target);
    const ajeno = await cuentaVerificada(target, "luis@dominio.dev");
    const id = await conDosPaginas(ajeno);
    expect((await analizar(cookie, id)).statusCode).toBe(404);
  });

  it("analiza los archivos reales y avisa de que no es una medición de campo", async () => {
    const cookie = await cuentaVerificada(target);
    const id = await conDosPaginas(cookie);
    const res = await analizar(cookie, id);
    expect(res.statusCode).toBe(200);
    const analisis = data<{ analisis: { aviso: string; resumen: { paginas: number; errores: number }; peso: { imagenBytes: number } } }>(res).analisis;
    expect(analisis.resumen.paginas).toBe(2);
    expect(analisis.resumen.errores).toBe(0);
    expect(analisis.aviso).toMatch(/medición de campo/i);
    expect(analisis.peso.imagenBytes).toBe(3);
  });

  it("un enlace roto aparece en el informe", async () => {
    const cookie = await cuentaVerificada(target);
    const res = await post(app, "/api/projects", { name: "Rotos", stack: "static", files: { "index.html": PAGINA } }, cookie);
    const id = data<{ project: { id: string } }>(res).project.id;
    const analisis = data<{ analisis: { enlacesRotos: { pagina: string; href: string }[]; problemas: { regla: string; nivel: string }[] } }>(
      await analizar(cookie, id)
    ).analisis;
    expect(analisis.enlacesRotos).toEqual([{ pagina: "index.html", href: "contacto.html" }]);
    expect(analisis.problemas.some((p) => p.regla === "enlace-roto" && p.nivel === "error")).toBe(true);
  });
});
