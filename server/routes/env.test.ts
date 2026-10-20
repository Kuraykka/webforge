import type { FastifyInstance } from "fastify";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeApp,
  cuentaVerificada,
  get,
  makeApp,
  mutate,
  post,
  type TestApp,
} from "../testing.ts";
import { MAX_ENV_PER_ENVIRONMENT } from "../repositories/env.ts";

interface Variable {
  id: string;
  projectId: string;
  environment: string;
  key: string;
  bytes: number;
  updatedAt: string;
  value?: string;
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

async function account(email = "ana@dominio.dev"): Promise<string> {
  return cuentaVerificada(target, email);
}

async function proyecto(cookie: string): Promise<string> {
  const res = await post(app, "/api/projects", { name: "Mi tienda", stack: "static", files: { "index.html": "x" } }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

const base = (id: string) => `/api/projects/${id}/env`;

async function listar(cookie: string | null, projectId: string, environment = "desarrollo") {
  const res = await get(app, `${base(projectId)}?environment=${environment}`, cookie);
  return res.statusCode === 200 ? data<{ variables: Variable[] }>(res).variables : [];
}

function guardar(cookie: string | null, projectId: string, body: unknown) {
  return mutate(app, "PUT", base(projectId), body, cookie);
}

function revelar(cookie: string | null, projectId: string, variableId: string) {
  return post(app, `${base(projectId)}/${variableId}/reveal`, {}, cookie);
}

function borrar(cookie: string | null, projectId: string, variableId: string) {
  return mutate(app, "DELETE", `${base(projectId)}/${variableId}`, undefined, cookie);
}

async function historial(cookie: string, projectId: string): Promise<string[]> {
  const res = await get(app, `/api/projects/${projectId}/history`, cookie);
  return data<{ history: { action: string }[] }>(res).history.map((entry) => entry.action);
}

describe("env · lista", () => {
  it("empieza vacía y nunca entrega el valor", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    expect(await listar(ana, projectId)).toEqual([]);
    const res = await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    expect(res.statusCode).toBe(200);
    expect(data<{ variable: Variable }>(res).variable).not.toHaveProperty("value");
    const lista = await listar(ana, projectId);
    expect(lista.map((v) => [v.key, v.bytes])).toEqual([["API_KEY", 10]]);
    expect(Object.keys(lista[0]!).sort()).toEqual(["bytes", "environment", "id", "key", "projectId", "updatedAt"]);
    expect(lista[0]?.updatedAt.length).toBeGreaterThan(10);
  });

  it("sin sesión no se lista, guarda, revela ni borra", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    const variable = (await listar(ana, projectId))[0]!;
    expect((await get(app, `${base(projectId)}?environment=desarrollo`)).statusCode).toBe(401);
    expect((await guardar(null, projectId, { environment: "desarrollo", key: "X1", value: "y" })).statusCode).toBe(401);
    expect((await revelar(null, projectId, variable.id)).statusCode).toBe(401);
    expect((await borrar(null, projectId, variable.id)).statusCode).toBe(401);
    expect(await listar(ana, projectId)).toHaveLength(1);
  });

  it("el proyecto de otra cuenta no existe, ni para listar", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana);
    expect((await get(app, `${base(deAna)}?environment=desarrollo`, luis)).statusCode).toBe(404);
    expect(await listar(luis, deAna)).toEqual([]);
  });

  it("separa desarrollo de producción", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_URL", value: "http://localhost" });
    await guardar(ana, projectId, { environment: "produccion", key: "API_URL", value: "https://api.dominio.dev" });
    const dev = await listar(ana, projectId, "desarrollo");
    const prod = await listar(ana, projectId, "produccion");
    expect(dev).toHaveLength(1);
    expect(prod).toHaveLength(1);
    expect(dev[0]?.id).not.toBe(prod[0]?.id);
  });

  it("un entorno desconocido es un 400", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    expect((await get(app, `${base(projectId)}?environment=pre`, ana)).statusCode).toBe(400);
    expect((await get(app, base(projectId), ana)).statusCode).toBe(400);
  });

  it("un proyecto que no existe responde 404", async () => {
    const ana = await account();
    expect((await get(app, `${base("no-existe")}?environment=desarrollo`, ana)).statusCode).toBe(404);
  });
});

describe("env · escribir", () => {
  it("reescribir la misma clave no duplica", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    const primera = data<{ variable: Variable }>(await guardar(ana, projectId, { environment: "desarrollo", key: "token", value: "uno" })).variable;
    const segunda = data<{ variable: Variable }>(await guardar(ana, projectId, { environment: "desarrollo", key: "TOKEN", value: "dos" })).variable;
    expect(segunda.id).toBe(primera.id);
    expect(await listar(ana, projectId)).toHaveLength(1);
    expect((await revelar(ana, projectId, segunda.id)).statusCode).toBe(200);
  });

  it("un nombre imposible se rechaza sin crear nada", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    for (const key of ["9VIVA", "con espacio", "CLAVE=1", "", "a".repeat(61)]) {
      const res = await guardar(ana, projectId, { environment: "desarrollo", key, value: "x" });
      expect(res.statusCode).toBe(400);
    }
    expect(await listar(ana, projectId)).toEqual([]);
  });

  it("un valor con saltos de línea se rechaza", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    const res = await guardar(ana, projectId, { environment: "desarrollo", key: "MULTI", value: "una\notra" });
    expect(res.statusCode).toBe(400);
    expect(await listar(ana, projectId)).toEqual([]);
  });

  it("un valor excesivo se rechaza con su mensaje", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    const res = await guardar(ana, projectId, { environment: "desarrollo", key: "GORDA", value: "x".repeat(8193) });
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toContain("8192");
  });

  it("el tope de variables avisa con un 409 y no rompe las existentes", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "PRIMERA", value: "x" });
    for (let i = 1; i < MAX_ENV_PER_ENVIRONMENT; i += 1) {
      await guardar(ana, projectId, { environment: "desarrollo", key: `VARIABLE_${i}`, value: "x" });
    }
    const res = await guardar(ana, projectId, { environment: "desarrollo", key: "LA_QUE_FALTA", value: "x" });
    expect(res.statusCode).toBe(409);
    expect(await listar(ana, projectId)).toHaveLength(MAX_ENV_PER_ENVIRONMENT);
  });

  it("sin cuerpo o sin campos obligatorios no se escribe", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    expect((await mutate(app, "PUT", base(projectId), undefined, ana)).statusCode).toBe(400);
    expect((await guardar(ana, projectId, { environment: "desarrollo" })).statusCode).toBe(400);
    expect((await guardar(ana, projectId, { environment: "desarrollo", key: "SOLO_CLAVE" })).statusCode).toBe(400);
    expect((await guardar(ana, projectId, { environment: "desarrollo", key: 42, value: "x" })).statusCode).toBe(400);
    expect(await listar(ana, projectId)).toEqual([]);
  });

  it("escribir en un proyecto ajeno no deja nada y responde 404", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana);
    expect((await guardar(luis, deAna, { environment: "desarrollo", key: "A1", value: "x" })).statusCode).toBe(404);
    expect(await listar(ana, deAna)).toEqual([]);
  });

  it("la escritura deja rastro con la clave, nunca con el valor", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    const acciones = await historial(ana, projectId);
    expect(acciones.some((a) => a.includes("API_KEY"))).toBe(true);
    expect(acciones.join(" ")).not.toContain("sk-privada");
  });
});

describe("env · revelar y borrar", () => {
  it("revelar devuelve el valor y anota qué se miró", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    const variable = (await listar(ana, projectId))[0]!;
    const res = await revelar(ana, projectId, variable.id);
    expect(res.statusCode).toBe(200);
    expect(data<{ variable: Variable }>(res).variable.value).toBe("sk-privada");
    const acciones = await historial(ana, projectId);
    expect(acciones.some((a) => a.includes("API_KEY") && !a.toLowerCase().includes("sk-privada"))).toBe(true);
  });

  it("revelar una variable de otra cuenta responde 404", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana);
    await guardar(ana, deAna, { environment: "desarrollo", key: "PROPIA", value: "solo-ana" });
    const ajena = (await listar(ana, deAna))[0]!;
    expect((await revelar(luis, deAna, ajena.id)).statusCode).toBe(404);
  });

  it("borrar deja la lista vacía y el identificador ya no revela nada", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "TEMPORAL", value: "x" });
    const variable = (await listar(ana, projectId))[0]!;
    expect((await borrar(ana, projectId, variable.id)).statusCode).toBe(204);
    expect(await listar(ana, projectId)).toEqual([]);
    expect((await revelar(ana, projectId, variable.id)).statusCode).toBe(404);
    expect((await borrar(ana, projectId, variable.id)).statusCode).toBe(404);
  });

  it("el borrado de una variable ajena no toca la original", async () => {
    const ana = await account("ana@dominio.dev");
    const luis = await account("luis@dominio.dev");
    const deAna = await proyecto(ana);
    await guardar(ana, deAna, { environment: "desarrollo", key: "PROPIA", value: "x" });
    const ajena = (await listar(ana, deAna))[0]!;
    expect((await borrar(luis, deAna, ajena.id)).statusCode).toBe(404);
    expect(await listar(ana, deAna)).toHaveLength(1);
  });
});

describe("env · el secreto no se filtra", () => {
  it("el ZIP exportado no lleva las variables", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "produccion", key: "StripeKey", value: "sk_live_real" });
    const res = await get(app, `/api/projects/${projectId}/export`, ana);
    expect(res.statusCode).toBe(200);
    const entries = unzipSync(new Uint8Array(res.rawPayload));
    const texto = Object.entries(entries)
      .map(([path, bytes]) => `${path}\n${new TextDecoder().decode(bytes)}`)
      .join("\n");
    expect(texto).not.toContain("sk_live_real");
    expect(texto).not.toContain("STRIPEKEY");
  });

  it("el historial de exportación no menciona valores", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    await get(app, `/api/projects/${projectId}/export`, ana);
    expect((await historial(ana, projectId)).join(" ")).not.toContain("sk-privada");
  });

  it("un proyecto borrado ya no entrega sus variables a nadie", async () => {
    const ana = await account();
    const projectId = await proyecto(ana);
    await guardar(ana, projectId, { environment: "desarrollo", key: "API_KEY", value: "sk-privada" });
    const variable = (await listar(ana, projectId))[0]!;
    expect((await mutate(app, "DELETE", `/api/projects/${projectId}`, undefined, ana)).statusCode).toBe(204);
    // El borrado es lógico: la fila sigue en la base, pero ninguna ruta del proyecto la alcanza.
    expect((await get(app, `${base(projectId)}?environment=desarrollo`, ana)).statusCode).toBe(404);
    expect((await revelar(ana, projectId, variable.id)).statusCode).toBe(404);
    expect((await guardar(ana, projectId, { environment: "desarrollo", key: "OTRA", value: "x" })).statusCode).toBe(404);
  });
});
