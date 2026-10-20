import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { deleteFile, writeFile, writeFiles, listFiles, readFile } from "./files.ts";
import { insertProject, removeProject } from "./projects.ts";
import { insertUser } from "./users.ts";
import {
  DEFAULT_VERSION_LABEL,
  MAX_VERSIONS_PER_PROJECT,
  createVersion,
  deleteVersion,
  getVersion,
  listVersions,
  restoreVersion
} from "./versions.ts";

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
  const project = insertProject(db, { ownerUserId: owner, name: "Mi tienda", stack: "static", now: T0 });
  return { db, owner, other, projectId: project.id };
}

function conContenido(db: Sql, owner: string, projectId: string) {
  writeFiles(db, owner, projectId, { "index.html": "<h1>Hola</h1>", "css/base.css": "body{color:red}" }, T0);
}

describe("createVersion", () => {
  it("guarda el contenido de todos los archivos y sus medidas", () => {
    const { db, owner, projectId } = fixture();
    conContenido(db, owner, projectId);
    const version = createVersion(db, owner, projectId, { label: "Antes del rediseño", now: T1 });
    expect(version).toMatchObject({
      projectId,
      label: "Antes del rediseño",
      createdAt: T1,
      files: 2,
      bytes: "<h1>Hola</h1>".length + "body{color:red}".length
    });
    const guardado = getVersion(db, owner, projectId, version.id);
    expect(guardado?.content).toEqual([
      { path: "css/base.css", content: "body{color:red}" },
      { path: "index.html", content: "<h1>Hola</h1>" }
    ]);
    db.close();
  });

  it("sin etiqueta se nombra sola", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "x", T0);
    expect(createVersion(db, owner, projectId, { label: "   ", now: T1 }).label).toBe(DEFAULT_VERSION_LABEL);
    db.close();
  });

  it("una etiqueta desbordada se rechaza antes de escribir", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "x", T0);
    expect(() => createVersion(db, owner, projectId, { label: "e".repeat(121), now: T1 })).toThrow(ValidationError);
    expect(listVersions(db, owner, projectId)).toEqual([]);
    db.close();
  });

  it("la lista va de la más nueva a la más antigua y no arrastra el contenido", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "v1", T0);
    const primera = createVersion(db, owner, projectId, { label: "Primera", now: T1 });
    writeFile(db, owner, projectId, "index.html", "v2", T1);
    createVersion(db, owner, projectId, { label: "Segunda", now: T2 });
    expect(listVersions(db, owner, projectId).map((v) => v.label)).toEqual(["Segunda", "Primera"]);
    expect(Object.keys(listVersions(db, owner, projectId)[0] ?? {})).toEqual([
      "id",
      "projectId",
      "label",
      "createdAt",
      "files",
      "bytes"
    ]);
    expect(primera.id).toBeTruthy();
    db.close();
  });

  it("se recortan las versiones que se salgan del número guardado", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "x", T0);
    for (let i = 0; i < MAX_VERSIONS_PER_PROJECT + 3; i += 1) {
      createVersion(db, owner, projectId, { label: `v${i}`, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
    }
    const lista = listVersions(db, owner, projectId);
    expect(lista).toHaveLength(MAX_VERSIONS_PER_PROJECT);
    expect(lista[0]?.label).toBe(`v${MAX_VERSIONS_PER_PROJECT + 2}`);
    expect(lista.at(-1)?.label).toBe("v3");
    db.close();
  });

  it("un proyecto ajeno o borrado no tiene versiones", () => {
    const { db, owner, other, projectId } = fixture();
    conContenido(db, owner, projectId);
    createVersion(db, owner, projectId, { label: "Suya", now: T1 });
    expect(listVersions(db, other, projectId)).toEqual([]);
    const ajena = listVersions(db, owner, projectId)[0];
    expect(getVersion(db, other, projectId, ajena?.id ?? "")).toBeUndefined();
    expect(() => createVersion(db, other, projectId, { label: "Mía", now: T2 })).toThrow(ValidationError);
    removeProject(db, owner, projectId, T2);
    expect(listVersions(db, owner, projectId)).toEqual([]);
    db.close();
  });
});

describe("restoreVersion", () => {
  it("deja los archivos tal como estaban en la versión", () => {
    const { db, owner, projectId } = fixture();
    conContenido(db, owner, projectId);
    const version = createVersion(db, owner, projectId, { label: "Buena", now: T1 });
    writeFiles(db, owner, projectId, { "index.html": "<h1>Rota</h1>", "extra.md": "sobrante" }, T2);
    deleteFile(db, owner, projectId, "css/base.css");

    const resultado = restoreVersion(db, owner, projectId, version.id, T2);
    expect(resultado.ok).toBe(true);
    expect(listFiles(db, owner, projectId).map((f) => f.path)).toEqual(["css/base.css", "index.html"]);
    expect(readFile(db, owner, projectId, "index.html")?.content).toBe("<h1>Hola</h1>");
    expect(readFile(db, owner, projectId, "extra.md")).toBeUndefined();
    db.close();
  });

  it("antes de restaurar guarda el estado que había", () => {
    const { db, owner, projectId } = fixture();
    conContenido(db, owner, projectId);
    const version = createVersion(db, owner, projectId, { label: "Buena", now: T1 });
    writeFile(db, owner, projectId, "index.html", "<h1>Rota</h1>", T2);
    restoreVersion(db, owner, projectId, version.id, T2);

    const [seguridad, antigua] = listVersions(db, owner, projectId);
    expect(seguridad?.label).toBe("Antes de recuperar «Buena»");
    expect(getVersion(db, owner, projectId, seguridad?.id ?? "")?.content.find((f) => f.path === "index.html")?.content).toBe(
      "<h1>Rota</h1>"
    );
    expect(antigua?.label).toBe("Buena");
    db.close();
  });

  it("una versión de otra cuenta no existe ni cambia nada", () => {
    const { db, owner, other, projectId } = fixture();
    conContenido(db, owner, projectId);
    const version = createVersion(db, owner, projectId, { label: "Buena", now: T1 });
    const antes = readFile(db, owner, projectId, "index.html")?.content;
    expect(restoreVersion(db, other, projectId, version.id, T2)).toEqual({ ok: false, reason: "missing" });
    expect(readFile(db, owner, projectId, "index.html")?.content).toBe(antes);
    expect(listVersions(db, owner, projectId)).toHaveLength(1);
    db.close();
  });

  it("restaurar no deja una versión de seguridad si el proyecto es de otro", () => {
    const { db, owner, other, projectId } = fixture();
    conContenido(db, owner, projectId);
    const version = createVersion(db, owner, projectId, { label: "Buena", now: T1 });
    expect(listVersions(db, other, projectId)).toHaveLength(0);
    expect(deleteVersion(db, other, projectId, version.id)).toBe(false);
    expect(deleteVersion(db, owner, projectId, version.id)).toBe(true);
    expect(listVersions(db, owner, projectId)).toHaveLength(0);
    db.close();
  });
});
