import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { HttpRunStore } from "./runs";

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
  return { store: new HttpRunStore(createApiClient(fetchImpl)), calls };
}

const RUN = {
  id: "r1",
  projectId: "p1",
  tipo: "script",
  archivo: "index.js",
  estado: "terminada",
  codigo: 0,
  senal: null,
  ms: 120,
  salidaBytes: 9,
  truncado: false,
  creadaEn: "2026-03-01T10:00:00.000Z",
  terminadaEn: "2026-03-01T10:00:01.000Z"
};

describe("HttpRunStore", () => {
  it("lista las ejecuciones del proyecto", async () => {
    const { store, calls } = harness({ "GET /api/projects/p1/runs": { payload: { runs: [RUN] } } });
    await expect(store.list("p1")).resolves.toEqual([RUN]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/projects/p1/runs" });
  });

  it("lanza un script con su archivo en el cuerpo", async () => {
    const { store, calls } = harness({
      "POST /api/projects/p1/runs": { payload: { run: RUN, log: "hola" } }
    });
    await expect(store.launch("p1", { tipo: "script", archivo: "index.js" })).resolves.toEqual({ run: RUN, log: "hola" });
    expect(calls[0]?.body).toBe('{"tipo":"script","archivo":"index.js"}');
  });

  it("un comprobador no manda archivo ni entorno si no se piden", async () => {
    const { store, calls } = harness({ "POST /api/projects/p1/runs": { payload: { run: RUN, log: "" } } });
    await store.launch("p1", { tipo: "comprobar" });
    expect(calls[0]?.body).toBe('{"tipo":"comprobar"}');
  });

  it("el entorno pedido viaja en la petición", async () => {
    const { store, calls } = harness({ "POST /api/projects/p1/runs": { payload: { run: RUN, log: "" } } });
    await store.launch("p1", { tipo: "script", archivo: "index.js", entorno: "produccion" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ tipo: "script", archivo: "index.js", entorno: "produccion" });
  });

  it("lista lo de toda la cuenta con el nombre de su proyecto", async () => {
    const conNombre = { ...RUN, nombreProyecto: "Mi tienda" };
    const { store, calls } = harness({ "GET /api/runs": { payload: { runs: [conNombre] } } });
    await expect(store.listAll()).resolves.toEqual([conNombre]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/runs" });
  });

  it("pregunta qué aislamiento tiene el servidor", async () => {
    const jaula = {
      disponible: true,
      binario: "bwrap",
      red: false,
      tipos: ["script", "comprobar"],
      limites: { cpuSegundos: 20, ficheroBytes: 2_097_152, tmpfsBytes: 33_554_432, memoriaHeapMB: 512, procesos: 256, descriptores: 256, tiempoRealMs: 30_000, salidaBytes: 65_536 }
    };
    const { store, calls } = harness({ "GET /api/runs/estado": { payload: { jaula } } });
    await expect(store.estado()).resolves.toEqual(jaula);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/runs/estado" });
  });

  it("lee el registro de una ejecución", async () => {
    const { store, calls } = harness({
      "GET /api/projects/p1/runs/r1": { payload: { run: RUN, log: "$ node index.js\nhola" } }
    });
    await expect(store.log("p1", "r1")).resolves.toBe("$ node index.js\nhola");
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/projects/p1/runs/r1" });
  });

  it("un id con caracteres raros no rompe la ruta", async () => {
    const { store, calls } = harness({
      "GET /api/projects/p%201/runs/r%2F1": { payload: { run: RUN, log: "" } }
    });
    await store.log("p 1", "r/1");
    expect(calls[0]?.url).toBe("/api/projects/p%201/runs/r%2F1");
  });

  it("el mensaje del servidor se conserva cuando no hay aislamiento", async () => {
    const { store } = harness({
      "POST /api/projects/p1/runs": {
        status: 503,
        payload: { error: "Este servidor no tiene aislamiento disponible (falta «bwrap»)." }
      }
    });
    await expect(store.launch("p1", { tipo: "comprobar" })).rejects.toMatchObject({
      status: 503,
      message: "Este servidor no tiene aislamiento disponible (falta «bwrap»)."
    });
  });
});
