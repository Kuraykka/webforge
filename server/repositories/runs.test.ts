import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ConflictError } from "../errors.ts";
import { insertProject, removeProject } from "./projects.ts";
import { insertUser } from "./users.ts";
import {
  MAX_RUNS_POR_PROYECTO,
  createRun,
  finishRun,
  getRun,
  listRuns,
  listRunsDeCuenta,
  purgarRuns,
  runLog
} from "./runs.ts";

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";
const T2 = "2026-03-03T10:00:00.000Z";

interface Fixture {
  db: Sql;
  owner: string;
  other: string;
  projectId: string;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const project = insertProject(db, { ownerUserId: owner, name: "Mi sitio", stack: "static", now: T0 });
  return { db, owner, other, projectId: project.id };
}

describe("repositories/runs", () => {
  it("abre la ejecución corriendo y la cierra con su resultado", () => {
    const { db, owner, projectId } = fixture();
    const creada = createRun(db, { projectId, ownerUserId: owner, tipo: "script", archivo: "site.js", now: T0 });
    expect(creada.estado).toBe("corriendo");
    expect(creada.codigo).toBeNull();
    expect(creada.archivo).toBe("site.js");

    const cerrada = finishRun(db, owner, creada.id, {
      estado: "terminada",
      codigo: 0,
      senal: null,
      ms: 812,
      log: "hola v24\nlisto",
      truncado: false,
      now: T1
    });
    expect(cerrada?.estado).toBe("terminada");
    expect(cerrada?.codigo).toBe(0);
    expect(cerrada?.ms).toBe(812);
    expect(runLog(db, owner, creada.id)).toBe("hola v24\nlisto");
  });

  it("el log viaja comprimido en la base de datos", () => {
    const { db, owner, projectId } = fixture();
    const run = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    const gordo = "a".repeat(40_000);
    finishRun(db, owner, run.id, { estado: "terminada", codigo: 0, senal: null, ms: 10, log: gordo, truncado: true, now: T1 });
    const fila = db.get<{ n: number }>("select length(log) as n from project_runs where id = ?", run.id);
    expect(Number(fila?.n)).toBeLessThan(2_000);
    expect(runLog(db, owner, run.id)).toBe(gordo);
    expect(getRun(db, owner, run.id)?.truncado).toBe(true);
  });

  it("las ejecuciones de otro proyecto o de otra cuenta no existen", () => {
    const { db, owner, other, projectId } = fixture();
    const run = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    finishRun(db, owner, run.id, { estado: "terminada", codigo: 0, senal: null, ms: 1, log: "x", truncado: false, now: T1 });
    expect(getRun(db, other, run.id)).toBeUndefined();
    expect(runLog(db, other, run.id)).toBeUndefined();
    expect(listRuns(db, other, projectId)).toEqual([]);
  });

  it("una ejecución cerrada no se vuelve a cerrar", () => {
    const { db, owner, projectId } = fixture();
    const run = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    finishRun(db, owner, run.id, { estado: "cancelada", codigo: null, senal: "SIGKILL", ms: 1_200, log: "", truncado: false, now: T1 });
    expect(getRun(db, owner, run.id)?.estado).toBe("cancelada");
    expect(() =>
      finishRun(db, owner, run.id, { estado: "terminada", codigo: 0, senal: null, ms: 1, log: "otra vez", truncado: false, now: T2 })
    ).toThrow(/cerrada/i);
    expect(runLog(db, owner, run.id)).toBe("");
  });

  it("un proyecto no tiene dos ejecuciones abiertas a la vez", () => {
    const { db, owner, projectId } = fixture();
    createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    expect(() => createRun(db, { projectId, ownerUserId: owner, tipo: "script", archivo: "a.js", now: T1 })).toThrow(
      ConflictError
    );
  });

  it("la lista enseña la más reciente primero y sin el log", () => {
    const { db, owner, projectId } = fixture();
    const primera = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    finishRun(db, owner, primera.id, { estado: "terminada", codigo: 0, senal: null, ms: 5, log: "primera", truncado: false, now: T0 });
    const segunda = createRun(db, { projectId, ownerUserId: owner, tipo: "script", archivo: "b.js", now: T1 });
    finishRun(db, owner, segunda.id, { estado: "fallida", codigo: 1, senal: null, ms: 7, log: "segunda", truncado: false, now: T1 });

    const lista = listRuns(db, owner, projectId);
    expect(lista.map((r) => r.id)).toEqual([segunda.id, primera.id]);
    expect(lista[0]?.estado).toBe("fallida");
    expect(lista[0]?.codigo).toBe(1);
    expect("log" in (lista[0] ?? {})).toBe(false);
  });

  it("purgar deja las más recientes y nunca toca una abierta", () => {
    const { db, owner, projectId } = fixture();
    const ids: string[] = [];
    for (let i = 0; i < MAX_RUNS_POR_PROYECTO + 6; i++) {
      const run = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
      finishRun(db, owner, run.id, { estado: "terminada", codigo: 0, senal: null, ms: i, log: `${i}`, truncado: false, now: T0 });
      ids.push(run.id);
    }
    const abierta = createRun(db, { projectId, ownerUserId: owner, tipo: "script", archivo: "larga.js", now: T1 });

    const quitadas = purgarRuns(db, projectId);
    expect(quitadas).toBe(ids.length + 1 - MAX_RUNS_POR_PROYECTO);
    const quedan = listRuns(db, owner, projectId).map((r) => r.id);
    expect(quedan).toHaveLength(MAX_RUNS_POR_PROYECTO);
    expect(quedan).toContain(abierta.id);
    expect(quedan).toContain(ids[ids.length - 1]);
  });

  it("la cuenta ve sus ejecuciones recientes, con el nombre de su proyecto", () => {
    const { db, owner, other, projectId } = fixture();
    const segundo = insertProject(db, { ownerUserId: owner, name: "Blog", stack: "static", now: T0 });
    const cerrada = createRun(db, { projectId, ownerUserId: owner, tipo: "script", archivo: "a.js", now: T0 });
    finishRun(db, owner, cerrada.id, {
      estado: "terminada",
      codigo: 0,
      senal: null,
      ms: 12,
      log: "una",
      truncado: false,
      now: T1
    });
    const abierta = createRun(db, { projectId: segundo.id, ownerUserId: owner, tipo: "comprobar", now: T1 });
    const ajenoProyecto = insertProject(db, { ownerUserId: other, name: "Ajeno", stack: "static", now: T0 });
    createRun(db, { projectId: ajenoProyecto.id, ownerUserId: other, tipo: "comprobar", now: T2 });

    const lista = listRunsDeCuenta(db, owner);
    expect(lista.map((run) => [run.id, run.nombreProyecto])).toEqual([
      [abierta.id, "Blog"],
      [cerrada.id, "Mi sitio"]
    ]);
    expect(lista[0]?.estado).toBe("corriendo");
    expect("log" in (lista[0] ?? {})).toBe(false);

    removeProject(db, owner, segundo.id, T2);
    expect(listRunsDeCuenta(db, owner).map((run) => run.id)).toEqual([cerrada.id]);
  });

  it("borrar el proyecto se lleva sus ejecuciones", () => {
    const { db, owner, projectId } = fixture();
    const run = createRun(db, { projectId, ownerUserId: owner, tipo: "comprobar", now: T0 });
    expect(removeProject(db, owner, projectId, T1)).toBe(true);
    expect(getRun(db, owner, run.id)).toBeUndefined();
  });
});
