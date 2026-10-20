import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import {
  LOCK_MS,
  MAX_FAILURES,
  WINDOW_MS,
  checkAttempts,
  clearAttempts,
  registerFailure,
  registerSuccess
} from "./attempts.ts";

const KEY = "ana@dominio.dev";
const MIN = 60_000;
const HOUR = 60 * MIN;

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function failUntilLocked(db: Sql, now = 0) {
  let state = { allowed: true, failures: 0, retryAfterSeconds: 0 };
  for (let i = 0; i < MAX_FAILURES; i += 1) state = registerFailure(db, KEY, now);
  return state;
}

describe("checkAttempts", () => {
  it("una clave desconocida permite intentar", () => {
    const db = freshDb();
    expect(checkAttempts(db, KEY)).toEqual({ allowed: true, retryAfterSeconds: 0, failures: 0 });
    db.close();
  });

  it("permite dos fallos y bloquea la cuenta al tercero", () => {
    const db = freshDb();
    expect(MAX_FAILURES).toBe(3);
    for (let i = 1; i < MAX_FAILURES; i += 1) {
      expect(registerFailure(db, KEY, i * 1000).allowed).toBe(true);
    }
    expect(registerFailure(db, KEY, 5_000)).toMatchObject({ allowed: false, failures: 3 });
    db.close();
  });

  it("el bloqueo es de veinticuatro horas justas", () => {
    const db = freshDb();
    expect(LOCK_MS).toBe(24 * HOUR);
    const locked = failUntilLocked(db, 0);
    expect(locked.retryAfterSeconds).toBe(LOCK_MS / 1000);
    expect(checkAttempts(db, KEY, HOUR).retryAfterSeconds).toBe((LOCK_MS - HOUR) / 1000);
    db.close();
  });

  it("el bloqueo vigente manda sobre cualquier otra cosa", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    expect(checkAttempts(db, KEY, LOCK_MS - 1000).allowed).toBe(false);
    expect(checkAttempts(db, KEY, LOCK_MS - 1000).retryAfterSeconds).toBe(1);
    db.close();
  });

  it("un fallo más durante el bloqueo no alarga la espera", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    const otraVez = registerFailure(db, KEY, MIN);
    expect(otraVez.allowed).toBe(false);
    expect(otraVez.retryAfterSeconds).toBe((LOCK_MS - MIN) / 1000);
    db.close();
  });

  it("cumplidas las veinticuatro horas se puede volver a intentar con el contador limpio", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    expect(checkAttempts(db, KEY, LOCK_MS + 1)).toEqual({ allowed: true, retryAfterSeconds: 0, failures: 0 });
    expect(registerFailure(db, KEY, LOCK_MS + 2_000).failures).toBe(1);
    db.close();
  });

  it("los fallos se cuentan durante veinticuatro horas y luego se olvidan", () => {
    const db = freshDb();
    registerFailure(db, KEY, 0);
    registerFailure(db, KEY, MIN);
    expect(checkAttempts(db, KEY, 2 * MIN).failures).toBe(2);
    expect(registerFailure(db, KEY, WINDOW_MS + 1000).failures).toBe(1);
    db.close();
  });

  it("el bloqueo es por cuenta: otra dirección del mismo proceso puede intentar", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    expect(checkAttempts(db, "luis@dominio.dev", 0).allowed).toBe(true);
    db.close();
  });
});

describe("registerSuccess", () => {
  it("borra el contador y levanta el bloqueo", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    expect(checkAttempts(db, KEY, 1).allowed).toBe(false);
    registerSuccess(db, KEY);
    expect(checkAttempts(db, KEY, 1)).toEqual({ allowed: true, retryAfterSeconds: 0, failures: 0 });
    expect(db.get("select * from login_attempts where key = ?", KEY)).toBeUndefined();
    db.close();
  });
});

describe("clearAttempts", () => {
  it("levanta un bloqueo que aún no se ha cumplido", () => {
    const db = freshDb();
    failUntilLocked(db, 0);
    clearAttempts(db, KEY);
    expect(checkAttempts(db, KEY, 1)).toEqual({ allowed: true, retryAfterSeconds: 0, failures: 0 });
    db.close();
  });

  it("sobre una clave sin historial no hace nada", () => {
    const db = freshDb();
    expect(() => clearAttempts(db, KEY)).not.toThrow();
    expect(checkAttempts(db, KEY, 0).allowed).toBe(true);
    db.close();
  });
});
