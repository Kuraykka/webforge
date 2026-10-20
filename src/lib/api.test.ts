import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, CSRF_HEADER, CSRF_VALUE, type FetchLike } from "./api";

interface Fake {
  status: number;
  payload?: unknown;
  headers?: Record<string, string>;
  notJson?: boolean;
}

function httpRes(fake: Fake): Response {
  const body = fake.notJson ? "<html>500</html>" : JSON.stringify(fake.payload ?? null);
  return new Response(fake.notJson ? body : body, {
    status: fake.status,
    headers: { "content-type": fake.notJson ? "text/html" : "application/json", ...(fake.headers ?? {}) }
  });
}

function fetchReturning(fake: Fake) {
  return vi.fn<FetchLike>(async () => httpRes(fake));
}

describe("createApiClient", () => {
  it("manda la cabecera de la aplicación y las cookies del mismo origen", async () => {
    const fetchImpl = fetchReturning({ status: 200, payload: { ok: true } });
    const api = createApiClient(fetchImpl);
    await api.get("/api/projects");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers[CSRF_HEADER]).toBe(CSRF_VALUE);
    expect(init?.credentials).toBe("same-origin");
  });

  it("serializa el cuerpo como JSON", async () => {
    const fetchImpl = fetchReturning({ status: 201, payload: { project: { id: "1" } } });
    const api = createApiClient(fetchImpl);
    await api.post("/api/projects", { name: "Tienda" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBe('{"name":"Tienda"}');
    expect(init?.headers["content-type"]).toBe("application/json");
    expect(init?.method).toBe("POST");
  });

  it("devuelve el objeto ya parseado", async () => {
    const api = createApiClient(fetchReturning({ status: 200, payload: { projects: [{ id: "a" }] } }));
    await expect(api.get<{ projects: { id: string }[] }>("/api/projects")).resolves.toEqual({
      projects: [{ id: "a" }]
    });
  });

  it("un 204 no deja un cuerpo vacío pendiente de parseo", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createApiClient(fetchImpl);
    await expect(api.remove("/api/projects/a")).resolves.toBeUndefined();
  });

  it("un borrado con confirmación manda su cuerpo", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response(null, { status: 204 }));
    const api = createApiClient(fetchImpl);
    await api.remove("/api/admin/users/u1", { confirm: "ana@dominio.dev" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBe('{"confirm":"ana@dominio.dev"}');
  });

  it("convierte el error del servidor en ApiError con su estado y su mensaje", async () => {
    const api = createApiClient(fetchReturning({ status: 403, payload: { error: "No tienes permiso." } }));
    const error = await api.post("/api/projects", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toBe("No tienes permiso.");
  });

  it("conserva retry-after en un 429", async () => {
    const api = createApiClient(
      fetchReturning({ status: 429, payload: { error: "Demasiados intentos." }, headers: { "retry-after": "37" } })
    );
    const error = (await api.post("/api/auth/login", {}).catch((e: unknown) => e)) as ApiError;
    expect(error.retryAfterSeconds).toBe(37);
  });

  it("si el servidor responde algo que no es JSON, da un mensaje según el estado", async () => {
    const api = createApiClient(fetchReturning({ status: 500, notJson: true }));
    const error = (await api.get("/api/projects").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(500);
    expect(error.message).toBe("Error interno del servidor.");
  });

  it("un corte de red se avisa como estado 0, sin textos de la librería", async () => {
    const api = createApiClient(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const error = (await api.get("/api/projects").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/servidor/i);
  });

  it("POST sin cuerpo manda un objeto vacío", async () => {
    const fetchImpl = fetchReturning({ status: 201, payload: { project: { id: "1" } } });
    const api = createApiClient(fetchImpl);
    await api.post("/api/projects/1/duplicate");
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe("{}");
  });

  it("expone los verbos que usa la interfaz", async () => {
    const fetchImpl = fetchReturning({ status: 200, payload: {} });
    const api = createApiClient(fetchImpl);
    await api.put("/api/x", { a: 1 });
    await api.patch("/api/x", { a: 1 });
    await api.remove("/api/x");
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "PATCH", "DELETE"]);
  });
});

const ZIP = new TextEncoder().encode("PK\u0003\u0004contenido");

function zipRes(header?: string) {
  return new Response(ZIP, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      ...(header ? { "content-disposition": header } : {})
    }
  });
}

describe("transferencias binarias", () => {
  it("download lee los bytes y el nombre anunciado por el servidor", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => zipRes('attachment; filename="mi-tienda.zip"'));
    const api = createApiClient(fetchImpl);
    const archivo = await api.download("/api/projects/p1/export", "proyecto.zip");
    expect(Array.from(archivo.bytes)).toEqual(Array.from(ZIP));
    expect(archivo.filename).toBe("mi-tienda.zip");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect(init?.headers[CSRF_HEADER]).toBe(CSRF_VALUE);
  });

  it("download sin content-disposition usa el nombre de reserva", async () => {
    const api = createApiClient(vi.fn<FetchLike>(async () => zipRes()));
    const archivo = await api.download("/api/projects/p1/export", "proyecto.zip");
    expect(archivo.filename).toBe("proyecto.zip");
  });

  it("un fallo al descargar trae el mensaje del servidor, no el cuerpo binario", async () => {
    const api = createApiClient(
      vi.fn<FetchLike>(async () =>
        new Response(JSON.stringify({ error: "Ese proyecto ya no existe." }), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const error = (await api.download("/api/projects/p1/export", "x.zip").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Ese proyecto ya no existe.");
  });

  it("upload manda el archivo crudo con su tipo y la cabecera de la aplicación", async () => {
    const archivo = new File([ZIP], "mi-tienda.zip", { type: "application/zip" });
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ project: { id: "p2" } }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const api = createApiClient(fetchImpl);
    const creado = await api.upload<{ project: { id: string } }>("/api/projects/import", archivo, "application/zip");
    expect(creado.project.id).toBe("p2");
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers["content-type"]).toBe("application/zip");
    expect(init?.headers[CSRF_HEADER]).toBe(CSRF_VALUE);
    expect(init?.body).toBe(archivo);
  });

  it("una subida rechazada se convierte en ApiError", async () => {
    const api = createApiClient(
      fetchReturning({ status: 400, payload: { error: "El archivo recibido no es un ZIP." } })
    );
    const error = (await api
      .upload("/api/projects/import", new File([ZIP], "a.zip"), "application/zip")
      .catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(400);
    expect(error.message).toBe("El archivo recibido no es un ZIP.");
  });
});
