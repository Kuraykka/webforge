import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { HttpEnvStore } from "./env";

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
    if ((route.status ?? 200) === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpEnvStore(createApiClient(fetchImpl)), calls };
}

const VARIABLE = {
  id: "e1",
  projectId: "p1",
  environment: "desarrollo",
  key: "API_KEY",
  bytes: 10,
  updatedAt: "2026-03-01T10:00:00.000Z"
};

describe("HttpEnvStore", () => {
  it("lista por entorno con la clave en la consulta", async () => {
    const { store, calls } = harness({
      "GET /api/projects/p1/env?environment=produccion": { payload: { variables: [VARIABLE] } }
    });
    await expect(store.list("p1", "produccion")).resolves.toEqual([VARIABLE]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/projects/p1/env?environment=produccion" });
  });

  it("escapa el identificador del proyecto", async () => {
    const { store, calls } = harness({});
    await expect(store.list("p 1/x", "desarrollo")).rejects.toThrow();
    expect(calls[0]?.url).toBe("/api/projects/p%201%2Fx/env?environment=desarrollo");
  });

  it("guarda enviando el valor una sola vez y devuelve la ficha sin valor", async () => {
    const { store, calls } = harness({
      "PUT /api/projects/p1/env": { payload: { variable: VARIABLE } }
    });
    await expect(store.save("p1", "desarrollo", "API_KEY", "sk-privada")).resolves.toEqual(VARIABLE);
    expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/projects/p1/env" });
    expect(JSON.parse(calls[0]!.body ?? "{}")).toEqual({ environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    expect(calls.length).toBe(1);
    expect(VARIABLE).not.toHaveProperty("value");
  });

  it("revelar pide el valor por su propia ruta", async () => {
    const { store, calls } = harness({
      "POST /api/projects/p1/env/e1/reveal": { payload: { variable: { ...VARIABLE, value: "sk-privada" } } }
    });
    await expect(store.reveal("p1", "e1")).resolves.toMatchObject({ key: "API_KEY", value: "sk-privada" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/projects/p1/env/e1/reveal" });
  });

  it("borra sin cuerpo y sin esperar respuesta", async () => {
    const { store, calls } = harness({ "DELETE /api/projects/p1/env/e1": { status: 204 } });
    await expect(store.remove("p1", "e1")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("el mensaje del servidor llega tal cual", async () => {
    const { store } = harness({
      "PUT /api/projects/p1/env": { status: 409, payload: { error: "Cada entorno admite hasta 40 variables." } }
    });
    await expect(store.save("p1", "desarrollo", "X1", "y")).rejects.toThrow("Cada entorno admite hasta 40 variables.");
  });

  it("un error de red no se disfraza de variable inexistente", async () => {
    const store = new HttpEnvStore(
      createApiClient(async () => {
        throw new TypeError("fetch falló");
      })
    );
    await expect(store.list("p1", "desarrollo")).rejects.toThrow("No se pudo conectar con el servidor.");
  });
});
