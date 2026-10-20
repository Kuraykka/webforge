import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FINES, claveDeRuta, documentoDeRutas, type DocumentoApi, type RutaApi } from "../docs/api.ts";
import { closeApp, get, makeApp, type TestApp } from "../testing.ts";

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

/** Las operaciones del documento, reescritas con la forma `MÉTODO /url:salvaje` que usa el servidor. */
function operacionesDelDocumento(doc: DocumentoApi): string[] {
  const salida: string[] = [];
  for (const [ruta, operaciones] of Object.entries(doc.paths)) {
    for (const [metodo, operacion] of Object.entries(operaciones)) {
      const abierta = ruta.replace(/\{([A-Za-z_]+)\}/g, ":$1");
      salida.push(`${metodo.toUpperCase()} ${abierta}`);
      expect(operacion.summary).not.toBe("");
      expect(operacion.description).not.toBe("");
      expect(operacion.responses["200"] ?? operacion.responses["201"] ?? operacion.responses["204"] ?? operacion.responses["202"]).toBeTruthy();
    }
  }
  return salida;
}

describe("documento de la API", () => {
  it("se puede leer sin sesión", async () => {
    const res = await get(app, "/api/docs/openapi");
    expect(res.statusCode).toBe(200);
    const doc = data<DocumentoApi>(res);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toContain("WebForge");
    expect(Object.keys(doc.paths).length).toBeGreaterThan(20);
  });

  it("cubre exactamente las rutas registradas, ni una más ni una menos", async () => {
    const doc = data<DocumentoApi>(await get(app, "/api/docs/openapi"));
    const registradas = new Set(app.rutasApi.map(claveDeRuta));
    const documentadas = new Set(operacionesDelDocumento(doc));
    const tabla = Object.keys(FINES);

    // La tabla escrita a mano no puede tener fines que el servidor no monta.
    expect(tabla.filter((clave) => !registradas.has(clave))).toEqual([]);
    // Tampoco puede faltar ninguno de los que monta.
    expect([...registradas].filter((clave) => !tabla.includes(clave))).toEqual([]);
    expect([...documentadas].filter((clave) => !registradas.has(clave))).toEqual([]);
    expect(registradas.size).toBeGreaterThan(50);
  });

  it("declara los parámetros que lleva la ruta", async () => {
    const doc = data<DocumentoApi>(await get(app, "/api/docs/openapi"));
    const operacion = doc.paths["/api/projects/{id}/versions/{versionId}"]?.["delete"];
    expect(operacion?.parameters?.map((p) => p.name)).toEqual(["id", "versionId"]);
    expect(operacion?.parameters?.every((p) => p.in === "path" && p.required)).toBe(true);
  });

  it("distingue lo público de lo que exige sesión o rol de administración", async () => {
    const doc = data<DocumentoApi>(await get(app, "/api/docs/openapi"));
    expect(doc.paths["/api/health"]?.["get"]?.["x-acceso"]).toBe("pública");
    expect(doc.paths["/api/projects"]?.["get"]?.["x-acceso"]).toBe("dueño");
    expect(doc.paths["/api/admin/users"]?.["get"]?.["x-acceso"]).toBe("administración");
  });
});

describe("la tabla de fines", () => {
  it("cada fin dice acceso, resumen y qué devuelve", () => {
    for (const [clave, fin] of Object.entries(FINES)) {
      expect(fin.resumen, clave).not.toBe("");
      expect(fin.detalle, clave).not.toBe("");
      expect(fin.exito, clave).not.toBe("");
      expect(["pública", "sesión", "dueño", "administración"], clave).toContain(fin.acceso);
    }
  });

  it("una ruta registrada sin documentar se señala en el documento", () => {
    const rutas: RutaApi[] = [{ method: "GET", url: "/api/sin-documentar/:cosa" }];
    const doc = documentoDeRutas(rutas);
    const operacion = doc.paths["/api/sin-documentar/{cosa}"]?.["get"];
    expect(operacion?.["x-sin-documentar"]).toBe(true);
    expect(operacion?.parameters?.[0]?.name).toBe("cosa");
  });
});
