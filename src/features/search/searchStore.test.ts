import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { HttpSearchStore, MIN_QUERY_CHARS } from "./search";

interface Recorded {
  method: string;
  url: string;
}

function harness(routes: Record<string, { status?: number; payload?: unknown }>, fail?: Error) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url });
    if (fail) throw fail;
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpSearchStore(createApiClient(fetchImpl)), calls };
}

const SIN_NADA = { projects: [], files: [] };

const RESULTADOS = {
  term: "mi tienda",
  projects: [{ id: "p1", name: "Mi tienda", folder: "Venta", updatedAt: "2026-03-01T10:00:00.000Z" }],
  files: [{ projectId: "p1", projectName: "Mi tienda", path: "index.html", line: 2, snippet: "mi tienda online" }]
};

describe("HttpSearchStore", () => {
  it("pregunta al servidor con el término escapado", async () => {
    const { store, calls } = harness({ "GET /api/search?q=mi%20tienda": { payload: RESULTADOS } });
    await expect(store.find("mi tienda")).resolves.toEqual(RESULTADOS);
    expect(calls).toEqual([{ method: "GET", url: "/api/search?q=mi%20tienda" }]);
  });

  it("recorta lo escrito antes de buscar", async () => {
    const { store, calls } = harness({ "GET /api/search?q=carro": { payload: { ...RESULTADOS, term: "carro" } } });
    await store.find("  carro  ");
    expect(calls[0]?.url).toBe("/api/search?q=carro");
  });

  it(`un término de menos de ${MIN_QUERY_CHARS} caracteres no sale a la red`, async () => {
    const { store, calls } = harness({});
    await expect(store.find("x")).resolves.toEqual({ term: "x", ...SIN_NADA });
    await expect(store.find("   ")).resolves.toEqual({ term: "", ...SIN_NADA });
    expect(calls).toEqual([]);
  });

  it("devuelve lo que dice el servidor aunque el término no encaje", async () => {
    const { store } = harness({ "GET /api/search?q=zzz": { payload: { term: "zzz", projects: [], files: [] } } });
    await expect(store.find("zzz")).resolves.toEqual({ term: "zzz", projects: [], files: [] });
  });

  it("pasa el mensaje del servidor cuando la consulta es imposible", async () => {
    const { store } = harness({
      [`GET /api/search?q=${"x".repeat(200)}`]: { status: 400, payload: { error: "La búsqueda no puede superar 120 caracteres." } }
    });
    await expect(store.find("x".repeat(200))).rejects.toThrow("120 caracteres");
  });

  it("explica que no se pudo conectar", async () => {
    const { store } = harness({}, new TypeError("Failed to fetch"));
    await expect(store.find("tienda")).rejects.toThrow("No se pudo conectar con el servidor.");
  });
});
