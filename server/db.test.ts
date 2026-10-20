import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  appliedMigrations,
  migrate,
  openDatabase,
  readSetting,
  seedSetting,
  writeSetting,
  type Sql
} from "./db.ts";
import { deleteUser, insertUser } from "./repositories/users.ts";
import { createSession } from "./auth/sessions.ts";

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function tableNames(db: Sql): string[] {
  return db
    .all<{ name: string }>("select name from sqlite_master where type = 'table' order by name")
    .map((row) => row.name);
}

describe("migraciones", () => {
  it("aplica identidad, proyectos, administración, versiones, variables, componentes y ejecuciones en orden", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(appliedMigrations(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    db.close();
  });

  it("es idempotente sobre una base ya migrada", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(migrate(db)).toEqual([]);
    expect(appliedMigrations(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    db.close();
  });

  it("las cuentas anteriores a la verificación obligatoria no quedan cerradas", () => {
    const db = openDatabase(":memory:");
    db.exec(
      "create table if not exists schema_migrations (id integer primary key, name text not null, applied_at text not null)"
    );
    // Base tal como estaba antes de exigir verificar el correo: sin la última migración aplicada.
    for (const migration of MIGRATIONS.filter((m) => m.id < 9)) {
      db.exec(migration.sql);
      db.run("insert into schema_migrations (id, name, applied_at) values (?, ?, ?)", migration.id, migration.name, "2026-01-01T00:00:00.000Z");
    }
    // La base antigua no conoce `username`: se inserta con el esquema de entonces.
    db.run(
      `insert into users (id, email, password_hash, role, status, created_at, updated_at, verified_at, password_updated_at, last_login_at)
       values ('u-previa', 'ana@dominio.dev', 'h', 'user', 'activa', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null, '2026-01-01T00:00:00.000Z', null)`
    );
    const previa = { id: "u-previa", verifiedAt: null as string | null };

    expect(migrate(db)).toEqual([9, 10, 11, 12]);
    expect(db.get<{ verified_at: string | null }>("select verified_at from users where id = ?", previa.id)?.verified_at).toBe(
      "2026-01-01T00:00:00.000Z"
    );

    // Y una cuenta nueva registrada después de la migración sigue sin verificar: la migración no se repite.
    const nueva = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" });
    expect(migrate(db)).toEqual([]);
    expect(db.get<{ verified_at: string | null }>("select verified_at from users where id = ?", nueva.id)?.verified_at).toBeNull();
    db.close();
  });

  it("crea todas las tablas del dominio de identidad y proyectos", () => {
    const db = freshDb();
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        "users",
        "sessions",
        "login_attempts",
        "email_tokens",
        "outbox_messages",
        "settings",
        "auth_factors",
        "projects",
        "project_files",
        "project_history",
        "project_versions",
        "project_env",
        "user_components",
        "project_runs",
        "admin_events",
        "schema_migrations"
      ])
    );
    db.close();
  });

  it("la biblioteca guarda las reglas que viajan con el bloque", () => {
    const db = freshDb();
    const columnas = db.all<{ name: string }>("pragma table_info(user_components)").map((columna) => columna.name);
    expect(columnas).toEqual(expect.arrayContaining(["html", "styles"]));
    db.close();
  });

  it("el registro administrativo sobrevive al borrado del usuario que lo ejecutó", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "admin" });
    db.run(
      "insert into admin_events (id, actor_user_id, actor_email, action, target_user_id, detail, at) values (?, ?, ?, ?, ?, ?, ?)",
      "e1",
      user.id,
      "ana@dominio.dev",
      "usuario.suspendido",
      user.id,
      "Sin actividad",
      now
    );
    expect(deleteUser(db, user.id)).toBe(true);
    expect(db.get<{ total: number }>("select count(*) as total from admin_events")?.total).toBe(1);
    db.close();
  });

  it("no repite un correo ignorando mayúsculas y espacios", () => {
    const db = freshDb();
    insertUser(db, { email: "Ana@Dominio.Dev ", passwordHash: "h", role: "user" });
    expect(() => insertUser(db, { email: "ana@dominio.dev", passwordHash: "h2", role: "user" })).toThrow(/UNIQUE/);
    expect(db.get("select * from users where lower(email) = ?", "ana@dominio.dev")).toBeDefined();
    db.close();
  });

  it("arrastra sesiones e históricos al borrar el dueño", () => {
    const db = freshDb();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
    createSession(db, { userId: user.id, userAgent: "ua", ip: "1.2.3.4", ttlMs: 60_000 });
    expect(db.get<{ total: number }>("select count(*) as total from sessions")?.total).toBe(1);
    expect(deleteUser(db, user.id)).toBe(true);
    expect(db.get<{ total: number }>("select count(*) as total from sessions")?.total).toBe(0);
    db.close();
  });

  it("rechaza vocabularios inventados por el CHECK", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    expect(() =>
      db.run(
        "insert into users (id, email, password_hash, role, status, created_at, updated_at, password_updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        "u1",
        "x@y.dev",
        "h",
        "superadmin",
        "activa",
        now,
        now,
        now
      )
    ).toThrow(/CHECK/);
    expect(() =>
      db.run(
        "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
        "p1",
        "no-existe",
        "Proyecto",
        "static",
        "publicado",
        now,
        now
      )
    ).toThrow(/CHECK/);
    db.close();
  });

  it("un proyecto sin dueño real no se guarda (clave foránea)", () => {
    const db = freshDb();
    const now = new Date().toISOString();
    expect(() =>
      db.run(
        "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
        "p1",
        "dueno-inexistente",
        "Proyecto",
        "static",
        "borrador",
        now,
        now
      )
    ).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it("el borrado del proyecto se lleva sus ficheros", () => {
    const db = freshDb();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
    const now = new Date().toISOString();
    db.run(
      "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      "p1",
      user.id,
      "Proyecto",
      "static",
      "borrador",
      now,
      now
    );
    db.run(
      "insert into project_files (project_id, path, content, bytes, updated_at) values (?, ?, ?, ?, ?)",
      "p1",
      "index.html",
      "<h1>hola</h1>",
      12,
      now
    );
    expect(db.get<{ total: number }>("select count(*) as total from project_files")?.total).toBe(1);
    db.run("delete from projects where id = ?", "p1");
    expect(db.get<{ total: number }>("select count(*) as total from project_files")?.total).toBe(0);
    db.close();
  });

  it("el borrado del proyecto se lleva sus versiones", () => {
    const db = freshDb();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
    const now = new Date().toISOString();
    db.run(
      "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      "p1",
      user.id,
      "Proyecto",
      "static",
      "borrador",
      now,
      now
    );
    db.run(
      "insert into project_versions (id, project_id, label, files, bytes, file_count, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      "v1",
      "p1",
      "Inicial",
      "[]",
      0,
      0,
      now
    );
    expect(db.get<{ total: number }>("select count(*) as total from project_versions")?.total).toBe(1);
    db.run("delete from projects where id = ?", "p1");
    expect(db.get<{ total: number }>("select count(*) as total from project_versions")?.total).toBe(0);
    db.close();
  });

  it("el borrado del proyecto se lleva sus variables", () => {
    const db = freshDb();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
    const now = new Date().toISOString();
    db.run(
      "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      "p1",
      user.id,
      "Proyecto",
      "static",
      "borrador",
      now,
      now
    );
    db.run(
      "insert into project_env (id, project_id, environment, key, value, bytes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      "e1",
      "p1",
      "desarrollo",
      "API_KEY",
      "secreta",
      7,
      now,
      now
    );
    expect(db.get<{ total: number }>("select count(*) as total from project_env")?.total).toBe(1);
    db.run("delete from projects where id = ?", "p1");
    expect(db.get<{ total: number }>("select count(*) as total from project_env")?.total).toBe(0);
    db.close();
  });

  it("una clave no se repite en el mismo entorno y sí en el otro", () => {
    const db = freshDb();
    const user = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
    const now = new Date().toISOString();
    db.run(
      "insert into projects (id, owner_user_id, name, stack, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
      "p1",
      user.id,
      "Proyecto",
      "static",
      "borrador",
      now,
      now
    );
    const fila = (id: string, environment: string) => [id, "p1", environment, "API_KEY", "v", 1, now, now];
    db.run(
      "insert into project_env (id, project_id, environment, key, value, bytes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ...fila("e1", "desarrollo")
    );
    db.run(
      "insert into project_env (id, project_id, environment, key, value, bytes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ...fila("e2", "produccion")
    );
    expect(() =>
      db.run(
        "insert into project_env (id, project_id, environment, key, value, bytes, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        ...fila("e3", "desarrollo")
      )
    ).toThrow();
    expect(db.get<{ total: number }>("select count(*) as total from project_env")?.total).toBe(2);
    db.close();
  });
});

describe("settings", () => {
  it("escribe, lee y actualiza una clave", () => {
    const db = freshDb();
    expect(readSetting(db, "allow_registration")).toBeUndefined();
    writeSetting(db, "allow_registration", "1");
    expect(readSetting(db, "allow_registration")).toBe("1");
    writeSetting(db, "allow_registration", "0");
    expect(readSetting(db, "allow_registration")).toBe("0");
    expect(db.get<{ total: number }>("select count(*) as total from settings")?.total).toBe(1);
    db.close();
  });

  it("seedSetting solo pone la semilla si la clave sigue vacía", () => {
    const db = freshDb();
    seedSetting(db, "allow_registration", "1");
    writeSetting(db, "allow_registration", "0");
    seedSetting(db, "allow_registration", "1");
    expect(readSetting(db, "allow_registration")).toBe("0");
    db.close();
  });
});

describe("transacciones", () => {
  it("revierte todo el bloque cuando algo falla", () => {
    const db = freshDb();
    expect(() =>
      db.transaction(() => {
        insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
        throw new Error("nada");
      })
    ).toThrow(/nada/);
    expect(db.get<{ total: number }>("select count(*) as total from users")?.total).toBe(0);
    db.close();
  });

  it("anida sin abrir dos begin", () => {
    const db = freshDb();
    const result = db.transaction(() => {
      insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" });
      return db.transaction(() => insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }));
    });
    expect(result.email).toBe("luis@dominio.dev");
    expect(db.get<{ total: number }>("select count(*) as total from users")?.total).toBe(2);
    db.close();
  });
});
