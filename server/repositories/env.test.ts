import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ConflictError, ValidationError } from "../errors.ts";
import { insertProject, projectHistory } from "./projects.ts";
import { insertUser } from "./users.ts";
import { envKeyFrom } from "../env-crypto.ts";
import {
  MAX_ENV_PER_ENVIRONMENT,
  MAX_ENV_VALUE_CHARS,
  deleteEnv,
  encryptLegacyEnv,
  envParaRun,
  findEnv,
  listEnv,
  saveEnv
} from "./env.ts";

const KEY = envKeyFrom("clave-de-prueba-012345678901234567890123456789");
const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";
const T2 = "2026-03-03T10:00:00.000Z";

interface Fixture {
  db: Sql;
  owner: string;
  projectId: string;
  other: string;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const project = insertProject(db, { ownerUserId: owner, name: "Mi tienda", stack: "static", now: T0 });
  return { db, owner, projectId: project.id, other };
}

const guardar = (f: Fixture, key: string, value: string, environment = "desarrollo", now = T1) =>
  saveEnv(f.db, f.owner, f.projectId, { environment, key, value }, KEY, now);

const acciones = (f: Fixture) => projectHistory(f.db, f.owner, f.projectId).map((h) => h.action);

describe("saveEnv", () => {
  it("guarda la variable y devuelve su valor solo aquí", () => {
    const f = fixture();
    const creada = guardar(f, "api_key", "sk-privada-123");
    if (!creada.ok) throw new Error(creada.reason);
    expect(creada.variable.key).toBe("API_KEY");
    expect(creada.variable.value).toBe("sk-privada-123");
    expect(creada.variable.environment).toBe("desarrollo");
  });

  it("normaliza la clave a mayúsculas", () => {
    const f = fixture();
    const creada = guardar(f, "  token_de_acceso  ", "abc");
    if (!creada.ok) throw new Error(creada.reason);
    expect(creada.variable.key).toBe("TOKEN_DE_ACCESO");
  });

  it("reescribir la misma clave no duplica la fila", () => {
    const f = fixture();
    const primera = guardar(f, "API_KEY", "una");
    const segunda = guardar(f, "API_KEY", "dos", "desarrollo", T2);
    if (!primera.ok || !segunda.ok) throw new Error("ninguna guardó");
    expect(segunda.variable.id).toBe(primera.variable.id);
    expect(segunda.variable.value).toBe("dos");
    expect(listEnv(f.db, f.owner, f.projectId, "desarrollo")).toHaveLength(1);
  });

  it("acepta una variable vacía", () => {
    const f = fixture();
    const creada = guardar(f, "VACIO", "");
    if (!creada.ok) throw new Error(creada.reason);
    expect(creada.variable.value).toBe("");
    expect(creada.variable.bytes).toBe(0);
  });

  it("rechaza una clave que no parece una variable de entorno", () => {
    const f = fixture();
    expect(() => guardar(f, "9VIVA", "x")).toThrow(ValidationError);
    expect(() => guardar(f, "con espacio", "x")).toThrow(ValidationError);
    expect(() => guardar(f, "CLAVE=1", "x")).toThrow(ValidationError);
    expect(() => guardar(f, "", "x")).toThrow(ValidationError);
    expect(() => guardar(f, "A".repeat(61), "x")).toThrow(ValidationError);
  });

  it("rechaza un valor que supera el límite por variable", () => {
    const f = fixture();
    expect(() => guardar(f, "GORDA", "x".repeat(MAX_ENV_VALUE_CHARS + 1))).toThrow(ValidationError);
  });

  it("rechaza un valor con saltos de línea: no es una variable de entorno", () => {
    const f = fixture();
    expect(() => guardar(f, "MULTI", "una\notra")).toThrow(ValidationError);
  });

  it("pone un tope de variables por entorno", () => {
    const f = fixture();
    for (let i = 0; i < MAX_ENV_PER_ENVIRONMENT; i++) guardar(f, `VARIABLE_${i}`, "x");
    expect(() => guardar(f, "LA_QUE_FALTA", "x")).toThrow(ConflictError);
  });

  it("no cuenta las variables del otro entorno", () => {
    const f = fixture();
    for (let i = 0; i < MAX_ENV_PER_ENVIRONMENT; i++) guardar(f, `VARIABLE_${i}`, "x", "produccion");
    expect(() => guardar(f, "DE_DESARROLLO", "x", "desarrollo")).not.toThrow();
  });

  it("rechaza un entorno que no existe", () => {
    const f = fixture();
    expect(() => guardar(f, "API_KEY", "x", "preproduccion")).toThrow(ValidationError);
  });

  it("no escribe en un proyecto de otra cuenta", () => {
    const f = fixture();
    const result = saveEnv(f.db, f.other, f.projectId, { environment: "desarrollo", key: "A1", value: "x" }, KEY);
    expect(result).toEqual({ ok: false, reason: "no-project" });
    expect(listEnv(f.db, f.other, f.projectId, "desarrollo")).toHaveLength(0);
  });

  it("anota el cambio en el historial sin escribir el valor", () => {
    const f = fixture();
    guardar(f, "API_KEY", "sk-privada-123");
    expect(acciones(f).some((a) => a.includes("API_KEY"))).toBe(true);
    expect(acciones(f).join(" ").includes("sk-privada-123")).toBe(false);
  });
});

describe("listEnv", () => {
  it("enumera por entorno, ordenado por clave y sin el valor", () => {
    const f = fixture();
    guardar(f, "ZETA", "valor-zeta");
    guardar(f, "alfa", "valor-alfa");
    const lista = listEnv(f.db, f.owner, f.projectId, "desarrollo");
    expect(lista.map((v) => v.key)).toEqual(["ALFA", "ZETA"]);
    expect(lista[0]).not.toHaveProperty("value");
    expect(JSON.stringify(lista)).not.toContain("valor-");
    expect(lista[0]?.bytes).toBe(10);
  });

  it("mantiene separados desarrollo y producción", () => {
    const f = fixture();
    guardar(f, "API_URL", "http://localhost");
    guardar(f, "API_URL", "https://api.dominio.dev", "produccion");
    const prod = listEnv(f.db, f.owner, f.projectId, "produccion");
    const dev = listEnv(f.db, f.owner, f.projectId, "desarrollo");
    expect(prod).toHaveLength(1);
    expect(dev).toHaveLength(1);
    expect(findEnv(f.db, f.owner, f.projectId, prod[0]!.id, KEY)?.value).toBe("https://api.dominio.dev");
    expect(findEnv(f.db, f.owner, f.projectId, dev[0]!.id, KEY)?.value).toBe("http://localhost");
  });

  it("no devuelve nada a una cuenta que no es la dueña", () => {
    const f = fixture();
    guardar(f, "API_KEY", "secreto");
    expect(listEnv(f.db, f.other, f.projectId, "desarrollo")).toEqual([]);
  });

  it("una variable borrada deja de aparecer y su identificador ya no revela nada", () => {
    const f = fixture();
    const creada = guardar(f, "TEMPORAL", "x");
    if (!creada.ok) throw new Error(creada.reason);
    expect(deleteEnv(f.db, f.owner, f.projectId, creada.variable.id).ok).toBe(true);
    expect(listEnv(f.db, f.owner, f.projectId, "desarrollo")).toHaveLength(0);
    expect(findEnv(f.db, f.owner, f.projectId, creada.variable.id, KEY)).toBeUndefined();
    expect(deleteEnv(f.db, f.owner, f.projectId, creada.variable.id).ok).toBe(false);
  });

  it("el borrado de otra cuenta no toca la variable", () => {
    const f = fixture();
    const creada = guardar(f, "PROPIA", "x");
    if (!creada.ok) throw new Error(creada.reason);
    expect(deleteEnv(f.db, f.other, f.projectId, creada.variable.id).ok).toBe(false);
    expect(listEnv(f.db, f.owner, f.projectId, "desarrollo")).toHaveLength(1);
  });

  it("leer una variable ajena no la entrega", () => {
    const f = fixture();
    const creada = guardar(f, "PROPIA", "solo-ana");
    if (!creada.ok) throw new Error(creada.reason);
    expect(findEnv(f.db, f.other, f.projectId, creada.variable.id, KEY)).toBeUndefined();
  });

  it("el borrado anota la clave en el historial, nunca el valor", () => {
    const f = fixture();
    const creada = guardar(f, "BORRABLE", "sk-secreta");
    if (!creada.ok) throw new Error(creada.reason);
    deleteEnv(f.db, f.owner, f.projectId, creada.variable.id);
    expect(acciones(f).some((a) => a.includes("BORRABLE"))).toBe(true);
    expect(acciones(f).join(" ")).not.toContain("sk-secreta");
  });

  it("un proyecto borrado se lleva sus variables", () => {
    const f = fixture();
    guardar(f, "API_KEY", "x");
    f.db.run("update projects set deleted_at = ? where id = ?", T2, f.projectId);
    expect(listEnv(f.db, f.owner, f.projectId, "desarrollo")).toEqual([]);
  });
});

describe("cifrado en reposo", () => {
  it("la base guarda el valor cifrado y la lectura explícita lo devuelve en claro", () => {
    const f = fixture();
    const creada = guardar(f, "TOKEN", "sk-privada-123");
    if (!creada.ok) throw new Error(creada.reason);
    const fila = f.db.get<{ value: string }>("select value from project_env where id = ?", creada.variable.id);
    expect(fila?.value.startsWith("enc:v1:")).toBe(true);
    expect(fila?.value).not.toContain("sk-privada-123");
    expect(findEnv(f.db, f.owner, f.projectId, creada.variable.id, KEY)?.value).toBe("sk-privada-123");
  });

  it("el entorno que recibe la jaula viaja descifrado", () => {
    const f = fixture();
    guardar(f, "API_URL", "https://api.dev");
    expect(envParaRun(f.db, f.projectId, "desarrollo", KEY)).toEqual({ API_URL: "https://api.dev" });
  });

  it("una clave distinta no puede leer lo guardado", () => {
    const f = fixture();
    const creada = guardar(f, "TOKEN", "secreto");
    if (!creada.ok) throw new Error(creada.reason);
    const otra = envKeyFrom("otra-clave-de-prueba-0123456789012345678");
    expect(() => findEnv(f.db, f.owner, f.projectId, creada.variable.id, otra)).toThrow();
  });

  it("las variables anteriores en claro se cifran al arrancar y no se repiten", () => {
    const f = fixture();
    const creada = guardar(f, "VIEJA", "en-claro");
    if (!creada.ok) throw new Error(creada.reason);
    f.db.run("update project_env set value = ? where id = ?", "en-claro", creada.variable.id);
    expect(encryptLegacyEnv(f.db, KEY)).toBe(1);
    const fila = f.db.get<{ value: string }>("select value from project_env where id = ?", creada.variable.id);
    expect(fila?.value.startsWith("enc:v1:")).toBe(true);
    expect(encryptLegacyEnv(f.db, KEY)).toBe(0);
  });
});
