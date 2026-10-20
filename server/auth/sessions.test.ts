import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { insertUser, setUserStatus } from "../repositories/users.ts";
import {
  createSession,
  listSessions,
  resolveSession,
  revokeOtherSessions,
  revokeSession
} from "./sessions.ts";

const TTL = 12 * 3600_000;

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function user(db: Sql, email = "ana@dominio.dev") {
  return insertUser(db, { email, passwordHash: "h", role: "user" });
}

function open(db: Sql, userId: string, now = Date.now()) {
  return createSession(db, { userId, userAgent: "Mozilla/5.0", ip: "10.0.0.1", ttlMs: TTL, now });
}

describe("createSession", () => {
  it("devuelve token y guarda solo su huella", () => {
    const db = freshDb();
    const { token } = open(db, user(db).id);
    expect(token).toHaveLength(43); // 32 bytes en base64url sin relleno
    const row = db.get<{ token_hash: string }>("select token_hash from sessions");
    expect(row?.token_hash).not.toBe(token);
    expect(row?.token_hash).toHaveLength(64); // SHA-256 en hexadecimal
    db.close();
  });

  it("recorta el agente y la ip antes de guardarlos", () => {
    const db = freshDb();
    createSession(db, {
      userId: user(db).id,
      userAgent: "u".repeat(500),
      ip: "i".repeat(200),
      ttlMs: TTL
    });
    const row = db.get<{ user_agent: string; ip: string }>("select user_agent, ip from sessions limit 1");
    expect(row?.user_agent).toHaveLength(300);
    expect(row?.ip).toHaveLength(100);
    db.close();
  });
});

describe("resolveSession", () => {
  it("devuelve usuario y sesión y renueva last_seen_at", () => {
    const db = freshDb();
    const owner = user(db);
    const created = open(db, owner.id, 1_700_000_000_000);
    const resolved = resolveSession(db, created.token, 1_700_000_010_000);
    expect(resolved?.user.id).toBe(owner.id);
    expect(resolved?.session.id).toBe(created.id);
    expect(resolved?.session.current).toBe(true);
    const row = db.get<{ last_seen_at: string }>("select last_seen_at from sessions where id = ?", created.id);
    expect(row?.last_seen_at).toBe(new Date(1_700_000_010_000).toISOString());
    db.close();
  });

  it("rechaza un token desconocido", () => {
    const db = freshDb();
    expect(resolveSession(db, "tok-en-desconocido")).toBe(null);
    db.close();
  });

  it("rechaza una sesión caducada", () => {
    const db = freshDb();
    const created = open(db, user(db).id, 1_000);
    expect(resolveSession(db, created.token, 1_000 + TTL - 1)).not.toBe(null);
    expect(resolveSession(db, created.token, 1_000 + TTL + 1)).toBe(null);
    db.close();
  });

  it("rechaza una sesión revocada", () => {
    const db = freshDb();
    const owner = user(db);
    const created = open(db, owner.id);
    revokeSession(db, created.id, owner.id);
    expect(resolveSession(db, created.token)).toBe(null);
    db.close();
  });

  it("rechaza el usuario suspendido aunque la sesión siga viva", () => {
    const db = freshDb();
    const owner = user(db);
    const created = open(db, owner.id);
    setUserStatus(db, owner.id, "suspendida");
    expect(resolveSession(db, created.token)).toBe(null);
    db.close();
  });

  it("no firma nada con el usuario borrado", () => {
    const db = freshDb();
    const owner = user(db);
    const created = open(db, owner.id);
    db.run("delete from users where id = ?", owner.id);
    expect(resolveSession(db, created.token)).toBe(null);
    db.close();
  });
});

describe("listSessions", () => {
  it("muestra las vivas, marca la actual y oculta revocadas y caducadas", () => {
    const db = freshDb();
    const owner = user(db);
    const a = open(db, owner.id, 1_000);
    const b = open(db, owner.id, 2_000);
    const vieja = open(db, owner.id, 3_000);
    const otra = user(db, "luis@dominio.dev");
    open(db, otra.id, 4_000);
    revokeSession(db, vieja.id, owner.id);

    const list = listSessions(db, owner.id, b.id, 3_500);
    expect(list.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(list.find((s) => s.id === b.id)?.current).toBe(true);
    expect(list.find((s) => s.id === a.id)?.current).toBe(false);
    db.close();
  });
});

describe("revokeSession", () => {
  it("solo la cierra su dueño", () => {
    const db = freshDb();
    const owner = user(db);
    const intruso = user(db, "luis@dominio.dev");
    const created = open(db, owner.id);
    expect(revokeSession(db, created.id, intruso.id)).toBe(false);
    expect(resolveSession(db, created.token)).not.toBe(null);
    expect(revokeSession(db, created.id, owner.id)).toBe(true);
    expect(revokeSession(db, created.id, owner.id)).toBe(false);
    db.close();
  });
});

describe("revokeOtherSessions", () => {
  it("cierra las demás y deja la sesión que se conserva", () => {
    const db = freshDb();
    const owner = user(db);
    const keep = open(db, owner.id);
    const otra = open(db, owner.id);
    const intrusa = open(db, user(db, "luis@dominio.dev").id);
    expect(revokeOtherSessions(db, owner.id, keep.id)).toBe(1);
    expect(resolveSession(db, keep.token)).not.toBe(null);
    expect(resolveSession(db, otra.token)).toBe(null);
    expect(resolveSession(db, intrusa.token)).not.toBe(null);
    db.close();
  });

  it("sin sesión a conservar cierra todas del usuario", () => {
    const db = freshDb();
    const owner = user(db);
    const a = open(db, owner.id);
    const b = open(db, owner.id);
    expect(revokeOtherSessions(db, owner.id, null)).toBe(2);
    expect(resolveSession(db, a.token)).toBe(null);
    expect(resolveSession(db, b.token)).toBe(null);
    db.close();
  });
});
