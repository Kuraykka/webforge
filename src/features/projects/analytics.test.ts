import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { ANALYTICS_DEFAULTS } from "../../../shared/analytics";
import { HttpAnalyticsStore } from "./analytics";

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
  return { store: new HttpAnalyticsStore(createApiClient(fetchImpl)), calls };
}

const ANALYTICS = { projectId: "p1", ...ANALYTICS_DEFAULTS, updatedAt: null };

describe("HttpAnalyticsStore", () => {
  it("lee la configuración del proyecto", async () => {
    const { store, calls } = harness({ "GET /api/projects/p1/analitica": { payload: { analytics: ANALYTICS } } });
    await expect(store.read("p1")).resolves.toEqual(ANALYTICS);
    expect(calls[0]?.url).toBe("/api/projects/p1/analitica");
  });

  it("guarda solo lo que cambia", async () => {
    const { store, calls } = harness({
      "PUT /api/projects/p1/analitica": { payload: { analytics: { ...ANALYTICS, enabled: true, measurementId: "G-ABC123XYZ" } } }
    });
    await expect(store.save("p1", { enabled: true, measurementId: "G-ABC123XYZ" })).resolves.toMatchObject({ enabled: true });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ enabled: true, measurementId: "G-ABC123XYZ" });
  });

  it("pide la generación y devuelve lo que escribió", async () => {
    const { store, calls } = harness({
      "POST /api/projects/p1/analitica/generar": {
        payload: { generated: { files: ["analytics.js", "index.html"], pages: 1, enabled: true } }
      }
    });
    await expect(store.generate("p1")).resolves.toEqual({ files: ["analytics.js", "index.html"], pages: 1, enabled: true });
    expect(calls[0]?.url).toBe("/api/projects/p1/analitica/generar");
  });

  it("escapa el identificador en la ruta", async () => {
    const { store, calls } = harness({ "GET /api/projects/p%201%2Fx/analitica": { payload: { analytics: ANALYTICS } } });
    await store.read("p 1/x");
    expect(calls[0]?.url).toBe("/api/projects/p%201%2Fx/analitica");
  });
});
