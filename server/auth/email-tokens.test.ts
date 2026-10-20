import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { insertUser } from "../repositories/users.ts";
import { consumeEmailToken, hasActiveToken, issueEmailToken, RESET_TTL_MS, VERIFY_TTL_MS, tokenTtl } from "./email-tokens.ts";

const RESET_MS = 30 * 60_000;
const VERIFY_MS = 3 * 60_000;

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function user(db: Sql) {
  return insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
}

describe("tokenTtl", () => {
  it("media hora para restablecer y tres minutos para verificar", () => {
    expect(tokenTtl("restablecimiento")).toBe(RESET_MS);
    expect(tokenTtl("verificacion")).toBe(VERIFY_MS);
    expect(RESET_TTL_MS).toBe(RESET_MS);
    expect(VERIFY_TTL_MS).toBe(VERIFY_MS);
  });
});

describe("issueEmailToken", () => {
  it("guarda solo el digesto y fija la caducidad según el propósito", () => {
    const db = freshDb();
    const owner = user(db);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "restablecimiento", now: 0 });
    expect(issued.token).toHaveLength(43);
    const row = db.get<{ token_hash: string; expires_at: string; user_id: string }>(
      "select token_hash, expires_at, user_id from email_tokens"
    );
    expect(row?.token_hash).not.toBe(issued.token);
    expect(row?.token_hash).toHaveLength(64);
    expect(row?.expires_at).toBe(new Date(RESET_MS).toISOString());
    expect(row?.user_id).toBe(owner.id);
    db.close();
  });
});

describe("consumeEmailToken", () => {
  it("vale una sola vez", () => {
    const db = freshDb();
    const owner = user(db);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "restablecimiento" });
    expect(consumeEmailToken(db, "restablecimiento", issued.token)).toEqual({ userId: owner.id });
    expect(consumeEmailToken(db, "restablecimiento", issued.token)).toBe(null);
    expect(db.get<{ used_at: string | null }>("select used_at from email_tokens")?.used_at).toBeTypeOf("string");
    db.close();
  });

  it("caduca a los treinta minutos", () => {
    const db = freshDb();
    const owner = user(db);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "restablecimiento", now: 0 });
    expect(consumeEmailToken(db, "restablecimiento", issued.token, RESET_MS - 1)).not.toBe(null);
    const otro = issueEmailToken(db, { userId: owner.id, purpose: "restablecimiento", now: 0 });
    expect(consumeEmailToken(db, "restablecimiento", otro.token, RESET_MS + 1)).toBe(null);
    db.close();
  });

  it("el enlace de verificación caduca a los tres minutos", () => {
    const db = freshDb();
    const owner = user(db);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "verificacion", now: 0 });
    expect(consumeEmailToken(db, "verificacion", issued.token, VERIFY_MS - 1)).toEqual({ userId: owner.id });
    const otro = issueEmailToken(db, { userId: owner.id, purpose: "verificacion", now: 0 });
    expect(consumeEmailToken(db, "verificacion", otro.token, VERIFY_MS + 1)).toBe(null);
    db.close();
  });

  it("un token de verificación no restablece la contraseña", () => {
    const db = freshDb();
    const owner = user(db);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "verificacion" });
    expect(consumeEmailToken(db, "restablecimiento", issued.token)).toBe(null);
    expect(consumeEmailToken(db, "verificacion", issued.token)).toEqual({ userId: owner.id });
    db.close();
  });

  it("un token desconocido no consume nada", () => {
    const db = freshDb();
    issueEmailToken(db, { userId: user(db).id, purpose: "verificacion" });
    expect(consumeEmailToken(db, "verificacion", "token-ajeno")).toBe(null);
    expect(db.get<{ used_at: string | null }>("select used_at from email_tokens")?.used_at).toBeNull();
    db.close();
  });

  it("el digesto repetido choca: no se emiten dos tokens iguales", () => {
    const db = freshDb();
    const owner = user(db);
    const a = issueEmailToken(db, { userId: owner.id, purpose: "verificacion" });
    const b = issueEmailToken(db, { userId: owner.id, purpose: "verificacion" });
    expect(a.token).not.toBe(b.token);
    expect(db.all("select id from email_tokens")).toHaveLength(2);
    db.close();
  });
});

describe("hasActiveToken", () => {
  it("dice si ya hay un enlace sin gastar antes de emitir otro", () => {
    const db = freshDb();
    const owner = user(db);
    expect(hasActiveToken(db, owner.id, "restablecimiento")).toBe(false);
    const issued = issueEmailToken(db, { userId: owner.id, purpose: "restablecimiento", now: 0 });
    expect(hasActiveToken(db, owner.id, "restablecimiento", 0)).toBe(true);
    expect(hasActiveToken(db, owner.id, "restablecimiento", RESET_MS + 1)).toBe(false);
    expect(hasActiveToken(db, owner.id, "verificacion", 0)).toBe(false);
    consumeEmailToken(db, "restablecimiento", issued.token, 1000);
    expect(hasActiveToken(db, owner.id, "restablecimiento", 1000)).toBe(false);
    db.close();
  });
});
