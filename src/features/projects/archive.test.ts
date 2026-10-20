import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type FetchLike } from "../../lib/api";
import { exportProjectZip, importProjectZip } from "./archive";
import type { Project } from "./types";

const PROYECTO: Project = {
  id: "p1",
  name: "Mi tienda",
  description: "",
  folder: "Sin carpeta",
  tags: [],
  stack: "static",
  status: "borrador",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z"
};

const IMPORTADO: Project = { ...PROYECTO, id: "p2", name: "Desde el ZIP" };
const ZIP = new TextEncoder().encode("PK\u0003\u0004contenido");

const blobs: Blob[] = [];
const enlaces: { nombre: string; url: string }[] = [];
const nativos = {
  crear: Object.getOwnPropertyDescriptor(URL, "createObjectURL"),
  revocar: Object.getOwnPropertyDescriptor(URL, "revokeObjectURL")
};

/** jsdom no escribe ficheros: se anota lo que la interfaz entregaría al disco. */
function simularDescarga() {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return "blob:prueba";
    }
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    enlaces.push({ nombre: this.download, url: this.href });
  });
}

afterEach(() => {
  blobs.length = 0;
  enlaces.length = 0;
  if (nativos.crear) Object.defineProperty(URL, "createObjectURL", nativos.crear);
  if (nativos.revocar) Object.defineProperty(URL, "revokeObjectURL", nativos.revocar);
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("exportProjectZip", () => {
  it("pide el ZIP al servidor y lo entrega al navegador con su nombre", async () => {
    simularDescarga();
    const fetchImpl = vi.fn<FetchLike>(async () =>
      new Response(ZIP, {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="mi-tienda.zip"'
        }
      })
    );
    const nombre = await exportProjectZip(createApiClient(fetchImpl), PROYECTO);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/projects/p1/export");
    expect(nombre).toBe("mi-tienda.zip");
    expect(enlaces[0]?.nombre).toBe("mi-tienda.zip");
    expect(blobs[0]?.type).toBe("application/zip");
    expect(blobs[0]?.size).toBe(ZIP.length);
  });

  it("no finge una descarga cuando el servidor falla", async () => {
    simularDescarga();
    const api = createApiClient(
      vi.fn<FetchLike>(async () =>
        json({ error: "No existe el recurso." }, 404)
      )
    );
    const error = (await exportProjectZip(api, PROYECTO).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(404);
    expect(enlaces).toHaveLength(0);
    expect(blobs).toHaveLength(0);
  });
});

describe("importProjectZip", () => {
  it("envía el archivo elegido y devuelve el proyecto creado", async () => {
    const archivo = new File([ZIP], "mi-tienda.zip", { type: "application/zip" });
    const fetchImpl = vi.fn<FetchLike>(async () => json({ project: IMPORTADO }, 201));
    const project = await importProjectZip(createApiClient(fetchImpl), archivo);
    expect(project.id).toBe("p2");
    const llamada = fetchImpl.mock.calls[0];
    expect(llamada?.[0]).toBe("/api/projects/import");
    expect(llamada?.[1]?.body).toBe(archivo);
    expect(llamada?.[1]?.headers["content-type"]).toBe("application/zip");
  });

  it("rechaza un archivo que no es ZIP sin tocar la red", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({}));
    const error = (await importProjectZip(
      createApiClient(fetchImpl),
      new File(["hola"], "notas.txt")
    ).catch((e: unknown) => e)) as Error;
    expect(error.message).toMatch(/ZIP/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rechaza un ZIP que supera el tope del servidor sin tocar la red", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => json({}));
    const archivo = new File([ZIP], "gordo.zip");
    Object.defineProperty(archivo, "size", { value: 8 * 1024 * 1024 + 1 });
    const error = (await importProjectZip(createApiClient(fetchImpl), archivo).catch(
      (e: unknown) => e
    )) as Error;
    expect(error.message).toMatch(/8 MB/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deja pasar el mensaje del servidor cuando la importación falla", async () => {
    const api = createApiClient(
      vi.fn<FetchLike>(async () => json({ error: "Has alcanzado el límite de proyectos." }, 409))
    );
    const error = (await importProjectZip(api, new File([ZIP], "a.zip")).catch(
      (e: unknown) => e
    )) as ApiError;
    expect(error.status).toBe(409);
    expect(error.message).toBe("Has alcanzado el límite de proyectos.");
  });
});
