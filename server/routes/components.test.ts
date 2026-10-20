import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeApp,
  cuentaVerificada,
  get,
  makeApp,
  mutate,
  type TestApp,
} from "../testing.ts";
import { MAX_COMPONENT_BYTES, MAX_COMPONENTS_PER_USER } from "../repositories/components.ts";

interface Bloque {
  id: string;
  name: string;
  html: string;
  reglas: { selector: string; cambios: Record<string, string> }[];
  bytes: number;
  createdAt: string;
  updatedAt: string;
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

const error = (res: { payload: string }): string => data<{ error: string }>(res).error;

async function account(email = "ana@dominio.dev"): Promise<string> {
  return cuentaVerificada(target, email);
}

const crear = (cookie: string | null, body: unknown) => mutate(app, "POST", "/api/components", body, cookie);
const listado = async (cookie: string | null) =>
  data<{ components: Bloque[] }>(await get(app, "/api/components", cookie)).components;
const cambiar = (cookie: string | null, id: string, body: unknown) =>
  mutate(app, "PUT", `/api/components/${id}`, body, cookie);
const borrar = (cookie: string | null, id: string) => mutate(app, "DELETE", `/api/components/${id}`, undefined, cookie);

const TARJETA = '<article class="card"><h3>Servicio</h3></article>';

async function guardado(cookie: string, name = "Tarjeta de servicio"): Promise<Bloque> {
  const res = await crear(cookie, { name, html: TARJETA });
  if (res.statusCode !== 201) throw new Error(`No se pudo crear: ${res.statusCode} ${res.payload}`);
  return data<{ component: Bloque }>(res).component;
}

describe("/api/components", () => {
  it("sin sesión no hay biblioteca", async () => {
    expect((await get(app, "/api/components", null)).statusCode).toBe(401);
    expect((await crear(null, { name: "Bloque", html: "<p>x</p>" })).statusCode).toBe(401);
  });

  it("una mutación sin la cabecera propia es un 403", async () => {
    const cookie = await account();
    await guardado(cookie);
    const res = await app.inject({ method: "DELETE", url: "/api/components/no-importa", headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("crea y devuelve el bloque con su tamaño", async () => {
    const cookie = await account();
    const component = await guardado(cookie);
    expect(component.name).toBe("Tarjeta de servicio");
    expect(component.html).toBe(TARJETA);
    expect(component.bytes).toBe(Buffer.byteLength(TARJETA, "utf8"));
    expect(await listado(cookie)).toEqual([component]);
  });

  it("cada cuenta ve solo sus bloques", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await guardado(ana);
    // El mismo nombre en otra cuenta no es conflicto: las bibliotecas no comparten espacio.
    expect((await crear(luis, { name: "Tarjeta de servicio", html: "<p>otro</p>" })).statusCode).toBe(201);
    expect((await listado(ana)).map((c) => c.id)).toEqual([deAna.id]);
    expect((await listado(luis)).map((c) => c.name)).toEqual(["Tarjeta de servicio"]);
  });

  it("un nombre repetido en la misma cuenta es un conflicto", async () => {
    const cookie = await account();
    await guardado(cookie);
    const res = await crear(cookie, { name: "  tarjeta DE servicio ", html: "<p>otro</p>" });
    expect(res.statusCode).toBe(409);
    expect(error(res)).toContain("Tarjeta de servicio");
  });

  it("avisa del nombre y del HTML imposibles", async () => {
    const cookie = await account();
    expect(error(await crear(cookie, { name: "x", html: TARJETA }))).toContain("caracteres");
    expect(error(await crear(cookie, { name: "Valido", html: "   " }))).toContain("HTML");
    const enorme = `<p>${"x".repeat(MAX_COMPONENT_BYTES)}</p>`;
    expect(error(await crear(cookie, { name: "Enorme", html: enorme }))).toContain("bytes");
  });

  it("pone el tope de bloques por cuenta", async () => {
    const cookie = await account();
    for (let i = 0; i < MAX_COMPONENTS_PER_USER; i += 1) {
      const res = await crear(cookie, { name: `Bloque ${String(i).padStart(3, "0")}`, html: "<p>z</p>" });
      if (res.statusCode !== 201) throw new Error(`Creación ${i} falló: ${res.statusCode}`);
    }
    const res = await crear(cookie, { name: "El uno más", html: "<p>z</p>" });
    expect(res.statusCode).toBe(409);
    expect(error(res)).toContain(String(MAX_COMPONENTS_PER_USER));
  });

  it("guarda y actualiza las reglas que viajan con el bloque", async () => {
    const cookie = await account();
    const reglas = [{ selector: ".wf-e1", cambios: { color: "#b30000" } }];
    const res = await crear(cookie, { name: "Titular rojo", html: '<h1 class="wf-e1">Hola</h1>', reglas });
    expect(res.statusCode).toBe(201);
    expect(data<{ component: Bloque }>(res).component.reglas).toEqual(reglas);
    expect((await listado(cookie))[0]?.reglas).toEqual(reglas);

    // Un selector que no es del constructor no entra: no se puede colar CSS sobre `body`.
    const colado = await crear(cookie, { name: "Colado", html: "<p>x</p>", reglas: [{ selector: "body", cambios: { display: "none" } }] });
    expect(colado.statusCode).toBe(400);
    expect(error(colado)).toContain("wf-e");
    expect((await crear(cookie, { name: "Lio", html: "<p>x</p>", reglas: "todo" })).statusCode).toBe(400);

    const cambiado = await cambiar(cookie, data<{ component: Bloque }>(res).component.id, {
      reglas: [{ selector: ".wf-e1", cambios: { color: "#0000ff" } }]
    });
    expect(data<{ component: Bloque }>(cambiado).component.reglas).toEqual([
      { selector: ".wf-e1", cambios: { color: "#0000ff" } }
    ]);

    // Renombrar no borra las reglas: solo se toca lo que la petición manda.
    const renombrado = await cambiar(cookie, data<{ component: Bloque }>(res).component.id, { name: "Titular azul" });
    expect(data<{ component: Bloque }>(renombrado).component.reglas).toEqual([
      { selector: ".wf-e1", cambios: { color: "#0000ff" } }
    ]);
  });

  it("lee un bloque suelto por su identificador", async () => {
    const cookie = await account();
    const component = await guardado(cookie);
    const res = await get(app, `/api/components/${component.id}`, cookie);
    expect(data<{ component: Bloque }>(res).component.html).toBe(TARJETA);
  });

  it("edita el nombre o el contenido sin tocar la creación", async () => {
    const cookie = await account();
    const component = await guardado(cookie);
    const res = await cambiar(cookie, component.id, { name: "Renombrado" });
    expect(res.statusCode).toBe(200);
    const after = data<{ component: Bloque }>(res).component;
    expect(after.name).toBe("Renombrado");
    expect(after.html).toBe(TARJETA);
    expect(after.createdAt).toBe(component.createdAt);
    expect(after.updatedAt).not.toBe(component.updatedAt);
  });

  it("rechaza el nombre ya cogido también al editar", async () => {
    const cookie = await account();
    const a = await guardado(cookie, "Uno");
    await guardado(cookie, "Dos");
    const res = await cambiar(cookie, a.id, { name: "dos" });
    expect(res.statusCode).toBe(409);
  });

  it("borra y deja de existir", async () => {
    const cookie = await account();
    const component = await guardado(cookie);
    expect((await borrar(cookie, component.id)).statusCode).toBe(204);
    expect(await listado(cookie)).toEqual([]);
    expect((await borrar(cookie, component.id)).statusCode).toBe(404);
  });

  it("el bloque de otra cuenta no se ve, no se edita y no se borra", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await guardado(ana);
    expect((await get(app, `/api/components/${deAna.id}`, luis)).statusCode).toBe(404);
    expect((await cambiar(luis, deAna.id, { html: "<p>malo</p>" })).statusCode).toBe(404);
    expect((await borrar(luis, deAna.id)).statusCode).toBe(404);
    expect((await listado(ana)).map((c) => c.html)).toEqual([TARJETA]);
  });

  it("un identificador desconocido es 404 en los tres verbos", async () => {
    const cookie = await account();
    expect((await get(app, "/api/components/inexistente", cookie)).statusCode).toBe(404);
    expect((await cambiar(cookie, "inexistente", { name: "Otro" })).statusCode).toBe(404);
    expect((await borrar(cookie, "inexistente")).statusCode).toBe(404);
  });

  it("exige los campos en el cuerpo", async () => {
    const cookie = await account();
    expect((await crear(cookie, { name: "Sin html" })).statusCode).toBe(400);
    expect((await crear(cookie, { html: "<p>solo html</p>" })).statusCode).toBe(400);
    expect((await crear(cookie, { name: "Valido", html: 42 })).statusCode).toBe(400);
  });
});
