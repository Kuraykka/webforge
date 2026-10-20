import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { SEO_DEFAULTS } from "../../../shared/seo";
import { HttpSeoStore } from "./seo";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

function harness(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: typeof init.body === "string" ? init.body : undefined });
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpSeoStore(createApiClient(fetchImpl)), calls };
}

const SEO = { projectId: "p1", ...SEO_DEFAULTS, updatedAt: null };

describe("HttpSeoStore", () => {
  it("lee los ajustes del proyecto", async () => {
    const { store, calls } = harness({ "GET /api/projects/p1/seo": { payload: { seo: SEO } } });
    await expect(store.read("p1")).resolves.toEqual(SEO);
    expect(calls[0]?.url).toBe("/api/projects/p1/seo");
  });

  it("escapa el identificador en la ruta", async () => {
    const { store, calls } = harness({ "GET /api/projects/p%201%2Fx/seo": { payload: { seo: SEO } } });
    await store.read("p 1/x");
    expect(calls[0]?.url).toBe("/api/projects/p%201%2Fx/seo");
  });

  it("guarda solo lo que cambia", async () => {
    const { store, calls } = harness({ "PUT /api/projects/p1/seo": { payload: { seo: { ...SEO, description: "Bicis" } } } });
    await expect(store.save("p1", { description: "Bicis" })).resolves.toMatchObject({ description: "Bicis" });
    expect(calls[0]?.method).toBe("PUT");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ description: "Bicis" });
  });

  it("pide la generación y devuelve qué archivos escribió", async () => {
    const { store, calls } = harness({
      "POST /api/projects/p1/seo/generar": { payload: { generated: { files: ["index.html", "sitemap.xml"], pages: 1 } } }
    });
    await expect(store.generate("p1")).resolves.toEqual({ files: ["index.html", "sitemap.xml"], pages: 1 });
    expect(calls[0]?.url).toBe("/api/projects/p1/seo/generar");
  });

  it("trae el análisis tal cual lo calcula el servidor", async () => {
    const analisis = {
      aviso: "Señales estáticas.",
      paginas: [],
      problemas: [],
      duplicados: { titulos: [], descripciones: [] },
      enlacesRotos: [],
      resumen: { paginas: 0, errores: 0, avisos: 0, sugerencias: 0, conTitulo: 0, conDescripcion: 0, conH1: 0, conJsonLd: 0 },
      peso: { htmlBytes: 0, cssBytes: 0, jsBytes: 0, imagenBytes: 0, otrosBytes: 0, scripts: 0, hojas: 0, imagenes: 0, imagenesSinDimensiones: 0 }
    };
    const { store, calls } = harness({ "GET /api/projects/p1/seo/analisis": { payload: { analisis } } });
    await expect(store.analysis("p1")).resolves.toEqual(analisis);
    expect(calls[0]?.url).toBe("/api/projects/p1/seo/analisis");
  });
});
