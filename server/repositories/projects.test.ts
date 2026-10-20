import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { insertUser, type UserSummary } from "./users.ts";
import {
  addProjectHistory,
  getProject,
  insertProject,
  listProjects,
  projectHistory,
  removeProject,
  updateProject,
  type ProjectRow
} from "./projects.ts";

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

function user(db: Sql, email = "ana@dominio.dev"): UserSummary {
  return insertUser(db, { email, passwordHash: "h", role: "user" });
}

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";

function project(db: Sql, owner: string, name = "Mi tienda", now = T0) {
  return insertProject(db, { ownerUserId: owner, name, stack: "static", now });
}

describe("insertProject", () => {
  it("guarda el proyecto con su dueño y sus fechas", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = insertProject(db, {
      ownerUserId: owner,
      name: "Mi tienda",
      description: "Página de inicio",
      folder: "clientes",
      tags: ["cliente", "tienda"],
      stack: "static",
      now: T0
    });
    expect(created).toMatchObject({
      name: "Mi tienda",
      description: "Página de inicio",
      folder: "clientes",
      tags: ["cliente", "tienda"],
      stack: "static",
      status: "borrador",
      createdAt: T0,
      updatedAt: T0
    });
    const row = db.get<ProjectRow>("select * from projects where id = ?", created.id);
    expect(row?.owner_user_id).toBe(owner);
    db.close();
  });

  it("anota la creación en el historial", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    expect(projectHistory(db, owner, created.id)).toEqual([
      { id: expect.any(String), projectId: created.id, action: "Proyecto creado", at: T0 }
    ]);
    db.close();
  });

  it("recorta la entrada y da carpeta a los proyectos sin carpeta", () => {
    const db = freshDb();
    const created = insertProject(db, {
      ownerUserId: user(db).id,
      name: "  Con espacios  ",
      description: " sin etiquetas  ",
      folder: "   ",
      tags: ["  uno ", "", "  ", "dos"],
      stack: "react",
      now: T0
    });
    expect(created.name).toBe("Con espacios");
    expect(created.description).toBe("sin etiquetas");
    expect(created.folder).toBe("Sin carpeta");
    expect(created.tags).toEqual(["uno", "dos"]);
    db.close();
  });

  it("rechaza un nombre vacío", () => {
    const db = freshDb();
    expect(() => project(db, user(db).id, "   ")).toThrow(ValidationError);
    db.close();
  });

  it("rechaza un nombre que supera el máximo de la interfaz", () => {
    const db = freshDb();
    expect(() => project(db, user(db).id, "n".repeat(121))).toThrow(ValidationError);
    db.close();
  });

  it("rechaza una pila que la plataforma no conoce", () => {
    const db = freshDb();
    expect(() => insertProject(db, { ownerUserId: user(db).id, name: "Ok", stack: "cobol" })).toThrow(
      /cobol/
    );
    db.close();
  });

  it("rechaza una descripción más larga de lo que admite el formulario", () => {
    const db = freshDb();
    expect(() =>
      insertProject(db, {
        ownerUserId: user(db).id,
        name: "Ok",
        description: "d".repeat(501),
        stack: "static"
      })
    ).toThrow(ValidationError);
    db.close();
  });
});

describe("listProjects", () => {
  it("solo muestra los proyectos de su dueño, del más reciente al más antiguo", () => {
    const db = freshDb();
    const owner = user(db).id;
    const intruso = user(db, "luis@dominio.dev").id;
    const viejo = project(db, owner, "Viejo", T0);
    const reciente = project(db, owner, "Reciente", T1);
    project(db, intruso, "De otro");
    expect(listProjects(db, owner).map((p) => p.id)).toEqual([reciente.id, viejo.id]);
    db.close();
  });

  it("oculta los proyectos borrados", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    removeProject(db, owner, created.id, T1);
    expect(listProjects(db, owner)).toEqual([]);
    db.close();
  });
});

describe("getProject", () => {
  it("no devuelve el proyecto de otro usuario", () => {
    const db = freshDb();
    const created = project(db, user(db).id);
    const intruso = user(db, "luis@dominio.dev").id;
    expect(getProject(db, intruso, created.id)).toBeUndefined();
    db.close();
  });

  it("no devuelve un proyecto borrado", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    removeProject(db, owner, created.id, T1);
    expect(getProject(db, owner, created.id)).toBeUndefined();
    db.close();
  });
});

describe("updateProject", () => {
  it("cambia los campos y renueva la fecha de actualización", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    const updated = updateProject(db, owner, created.id, { description: "Nueva", status: "listo" }, { now: T1 });
    expect(updated).toMatchObject({
      description: "Nueva",
      status: "listo",
      createdAt: T0,
      updatedAt: T1
    });
    db.close();
  });

  it("anota el historial cuando se le pasa una nota", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    updateProject(db, owner, created.id, { name: "Renovado" }, { note: 'Renombrado a "Renovado"', now: T1 });
    expect(projectHistory(db, owner, created.id).map((h) => h.action)).toEqual([
      'Renombrado a "Renovado"',
      "Proyecto creado"
    ]);
    db.close();
  });

  it("no cambia nada si el proyecto no es del usuario", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    const intruso = user(db, "luis@dominio.dev").id;
    expect(updateProject(db, intruso, created.id, { name: "Secuestrado" })).toBeUndefined();
    expect(getProject(db, owner, created.id)?.name).toBe("Mi tienda");
    db.close();
  });

  it("rechaza un estado que no existe", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    expect(() => updateProject(db, owner, created.id, { status: "publicado" })).toThrow(ValidationError);
    db.close();
  });

  it("devuelve undefined cuando el proyecto no existe", () => {
    const db = freshDb();
    expect(updateProject(db, user(db).id, "sin-id", { name: "Nada" })).toBeUndefined();
    db.close();
  });
});

describe("removeProject", () => {
  it("lo marca como borrado sin destruir la fila", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    expect(removeProject(db, owner, created.id, T1)).toBe(true);
    const row = db.get<ProjectRow>("select * from projects where id = ?", created.id);
    expect(row?.deleted_at).toBe(T1);
    db.close();
  });

  it("dice que no cuando el proyecto no era suyo", () => {
    const db = freshDb();
    const created = project(db, user(db).id);
    const intruso = user(db, "luis@dominio.dev").id;
    expect(removeProject(db, intruso, created.id, T1)).toBe(false);
    db.close();
  });

  it("no repite el borrado", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    removeProject(db, owner, created.id, T1);
    expect(removeProject(db, owner, created.id, T1)).toBe(false);
    db.close();
  });
});

describe("projectHistory", () => {
  it("devuelve de la más nueva a la más antigua y respeta el límite", () => {
    const db = freshDb();
    const owner = user(db).id;
    const created = project(db, owner);
    addProjectHistory(db, created.id, "Segunda", "2026-03-03T10:00:00.000Z");
    addProjectHistory(db, created.id, "Tercera", "2026-03-04T10:00:00.000Z");
    expect(projectHistory(db, owner, created.id).map((h) => h.action)).toEqual([
      "Tercera",
      "Segunda",
      "Proyecto creado"
    ]);
    expect(projectHistory(db, owner, created.id, 1).map((h) => h.action)).toEqual(["Tercera"]);
    db.close();
  });

  it("no enseña el historial de un proyecto ajeno", () => {
    const db = freshDb();
    const created = project(db, user(db).id);
    const intruso = user(db, "luis@dominio.dev").id;
    expect(projectHistory(db, intruso, created.id)).toEqual([]);
    db.close();
  });
});
