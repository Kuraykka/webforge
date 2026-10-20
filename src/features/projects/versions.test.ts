import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, type FetchLike } from "../../lib/api";
import { HttpVersionStore, type VersionSummary } from "./versions";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

const VERSION: VersionSummary = {
  id: "v1",
  projectId: "p1",
  label: "Antes del cambio",
  createdAt: "2026-03-01T10:00:00.000Z",
  files: 3,
  bytes: 128
};

function harness(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    // Estas pruebas solo miran cuerpos JSON: un ZIP no se anota como texto.
    calls.push({ method: init.method, url, body: typeof init.body === "string" ? init.body : undefined });
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    if ((route.status ?? 200) === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpVersionStore(createApiClient(fetchImpl)), calls };
}

function sentBody(call: Recorded | undefined): unknown {
  return JSON.parse(call?.body ?? "{}");
}

describe("HttpVersionStore", () => {
  it("lista las versiones sin arrastrar su contenido", async () => {
    const { store, calls } = harness({ "GET /api/projects/p1/versions": { payload: { versions: [VERSION] } } });
    await expect(store.list("p1")).resolves.toEqual([VERSION]);
    expect(calls[0]).toEqual({ method: "GET", url: "/api/projects/p1/versions", body: undefined });
  });

  it("guarda una versión con la etiqueta elegida", async () => {
    const { store, calls } = harness({ "POST /api/projects/p1/versions": { status: 201, payload: { version: VERSION } } });
    await expect(store.save("p1", "Antes del cambio")).resolves.toEqual(VERSION);
    expect(calls[0]?.method).toBe("POST");
    expect(sentBody(calls[0])).toEqual({ label: "Antes del cambio" });
  });

  it("lee el contenido completo de una versión", async () => {
    const { store } = harness({
      "GET /api/projects/p1/versions/v1": { payload: { version: { ...VERSION, content: [{ path: "index.html", content: "hola" }] } } }
    });
    const full = await store.read("p1", "v1");
    expect(full.content).toEqual([{ path: "index.html", content: "hola" }]);
    expect(full.label).toBe("Antes del cambio");
  });

  it("recupera una versión y devuelve también la copia de seguridad", async () => {
    const safety = { ...VERSION, id: "v2", label: "Antes de recuperar «Antes del cambio»" };
    const { store, calls } = harness({
      "POST /api/projects/p1/versions/v1/restore": { payload: { restored: VERSION, safety } }
    });
    await expect(store.restore("p1", "v1")).resolves.toEqual({ restored: VERSION, safety });
    expect(calls[0]).toEqual({ method: "POST", url: "/api/projects/p1/versions/v1/restore", body: "{}" });
  });

  it("borra una versión", async () => {
    const { store, calls } = harness({ "DELETE /api/projects/p1/versions/v1": { status: 204 } });
    await expect(store.remove("p1", "v1")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("escapa identificadores raros en la URL", async () => {
    const { store, calls } = harness({ "GET /api/projects/p%201%2F/versions": { payload: { versions: [] } } });
    await expect(store.list("p 1/")).resolves.toEqual([]);
    expect(calls[0]?.url).toBe("/api/projects/p%201%2F/versions");
  });

  it("propaga el mensaje del servidor cuando la versión no es tuya", async () => {
    const { store } = harness({});
    await expect(store.read("p1", "v1")).rejects.toMatchObject({ name: "ApiError", status: 404 });
    await expect(store.read("p1", "v1")).rejects.toBeInstanceOf(ApiError);
  });
});
