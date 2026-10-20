import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { deleteUser, insertUser, type UserSummary } from "./users.ts";
import { listAdminEvents, recordAdminEvent, type AdminEvent } from "./admin-events.ts";

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function admin(db: Sql, email = "ana@dominio.dev"): UserSummary {
  return insertUser(db, { email, passwordHash: "h", role: "admin" });
}

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";

describe("recordAdminEvent", () => {
  it("guarda la acción con el actor y su correo del momento", () => {
    const db = freshDb();
    const actor = admin(db);
    const event = recordAdminEvent(db, { actor, action: "usuario.rol_cambiado", now: T0 });

    expect(event).toEqual<AdminEvent>({
      id: event.id,
      actorId: actor.id,
      actorEmail: "ana@dominio.dev",
      action: "usuario.rol_cambiado",
      targetUserId: null,
      detail: null,
      at: T0
    });
    expect(listAdminEvents(db)).toHaveLength(1);
  });

  it("anota el objetivo y el detalle cuando los hay", () => {
    const db = freshDb();
    const actor = admin(db);
    const objetivo = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" });
    const event = recordAdminEvent(db, {
      actor,
      action: "usuario.suspendido",
      targetUserId: objetivo.id,
      detail: "Motivo: spam",
      now: T0
    });

    expect(event.targetUserId).toBe(objetivo.id);
    expect(event.detail).toBe("Motivo: spam");
  });

  it("el rastro sigue vivo aunque borren al actor y al objetivo", () => {
    const db = freshDb();
    const actor = admin(db);
    const objetivo = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" });
    recordAdminEvent(db, { actor, action: "usuario.suspendido", targetUserId: objetivo.id, now: T0 });

    deleteUser(db, actor.id);
    deleteUser(db, objetivo.id);

    const [resto] = listAdminEvents(db);
    expect(resto?.action).toBe("usuario.suspendido");
    expect(resto?.actorEmail).toBe("ana@dominio.dev");
  });
});

describe("listAdminEvents", () => {
  it("va de lo más nuevo a lo más viejo y admite un límite", () => {
    const db = freshDb();
    const actor = admin(db);
    recordAdminEvent(db, { actor, action: "una", now: T0 });
    recordAdminEvent(db, { actor, action: "dos", now: T1 });
    recordAdminEvent(db, { actor, action: "tres", now: "2026-03-03T10:00:00.000Z" });

    expect(listAdminEvents(db).map((e) => e.action)).toEqual(["tres", "dos", "una"]);
    expect(listAdminEvents(db, 2).map((e) => e.action)).toEqual(["tres", "dos"]);
  });
});
