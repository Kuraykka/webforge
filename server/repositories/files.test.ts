import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { insertProject, removeProject } from "./projects.ts";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_PROJECT,
  createFile,
  deleteFile,
  listFiles,
  readFile,
  renameFile,
  writeFile,
  writeFiles,
  type FileRow
} from "./files.ts";
import { insertUser } from "./users.ts";

function freshDb(): Sql {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";

interface Fixture {
  db: Sql;
  owner: string;
  projectId: string;
  other: string;
}

function fixture(): Fixture {
  const db = freshDb();
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const project = insertProject(db, { ownerUserId: owner, name: "Mi tienda", stack: "static", now: T0 });
  return { db, owner, projectId: project.id, other };
}

describe("listFiles", () => {
  it("enumera ruta, bytes y fecha sin traer el contenido", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "<h1>Hola</h1>", T0);
    writeFile(db, owner, projectId, "styles.css", "body{}", T1);
    const list = listFiles(db, owner, projectId);
    expect(list.map((f) => f.path)).toEqual(["index.html", "styles.css"]);
    expect(Object.keys(list[0] ?? {})).toEqual(["path", "bytes", "updatedAt"]);
    db.close();
  });

  it("un proyecto de otro usuario no tiene archivos", () => {
    const { db, owner, projectId, other } = fixture();
    writeFile(db, owner, projectId, "index.html", "secreto", T0);
    expect(listFiles(db, other, projectId)).toEqual([]);
    db.close();
  });

  it("un proyecto borrado no tiene archivos", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "hola", T0);
    removeProject(db, owner, projectId, T1);
    expect(listFiles(db, owner, projectId)).toEqual([]);
    db.close();
  });
});

describe("readFile", () => {
  it("devuelve el contenido guardado", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "src/app.js", "console.log(1)", T0);
    expect(readFile(db, owner, projectId, "src/app.js")).toEqual({
      path: "src/app.js",
      bytes: 14,
      updatedAt: T0,
      content: "console.log(1)"
    });
    db.close();
  });

  it("usa las mismas reglas de ruta que la interfaz", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "./src//app.js", "hola", T0);
    expect(readFile(db, owner, projectId, "src/./app.js")?.path).toBe("src/app.js");
    db.close();
  });

  it("no encuentra un archivo que no existe", () => {
    const { db, owner, projectId } = fixture();
    expect(readFile(db, owner, projectId, "nada.html")).toBeUndefined();
    db.close();
  });

  it("no lee el archivo de otro usuario", () => {
    const { db, owner, projectId, other } = fixture();
    writeFile(db, owner, projectId, "index.html", "secreto", T0);
    expect(readFile(db, other, projectId, "index.html")).toBeUndefined();
    db.close();
  });

  it("rechaza una ruta que sale del proyecto", () => {
    const { db, owner, projectId } = fixture();
    expect(() => readFile(db, owner, projectId, "../secreto")).toThrow(ValidationError);
    db.close();
  });
});

describe("writeFile", () => {
  it("crea y luego sustituye sin duplicar la fila", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "index.html", "uno", T0);
    const second = writeFile(db, owner, projectId, "index.html", "dos", T1);
    expect(second).toEqual({ ok: true, file: { path: "index.html", bytes: 3, updatedAt: T1 } });
    expect(db.all<FileRow>("select * from project_files").length).toBe(1);
    expect(readFile(db, owner, projectId, "index.html")?.content).toBe("dos");
    db.close();
  });

  it("cuenta los bytes en utf-8", () => {
    const { db, owner, projectId } = fixture();
    const written = writeFile(db, owner, projectId, "t.txt", "áéí", T0);
    expect(written.ok && written.file.bytes).toBe(6);
    db.close();
  });

  it("rechaza un archivo por encima del límite", () => {
    const { db, owner, projectId } = fixture();
    const huge = "x".repeat(MAX_FILE_BYTES + 1);
    expect(() => writeFile(db, owner, projectId, "grande.txt", huge, T0)).toThrow(/512 KB/);
    db.close();
  });

  it("rechaza una ruta vacía", () => {
    const { db, owner, projectId } = fixture();
    expect(() => writeFile(db, owner, projectId, "   ", "x", T0)).toThrow(ValidationError);
    db.close();
  });

  it("no escribe en un proyecto que no es del usuario", () => {
    const { db, owner, projectId, other } = fixture();
    expect(writeFile(db, other, projectId, "index.html", "intruso", T0)).toEqual({
      ok: false,
      reason: "no-project"
    });
    expect(listFiles(db, owner, projectId)).toEqual([]);
    db.close();
  });
});

describe("createFile", () => {
  it("crea cuando la ruta está libre", () => {
    const { db, owner, projectId } = fixture();
    expect(createFile(db, owner, projectId, "nuevo.txt", "", T0)).toEqual({
      ok: true,
      file: { path: "nuevo.txt", bytes: 0, updatedAt: T0 }
    });
    db.close();
  });

  it("avisa si la ruta ya está ocupada", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "nuevo.txt", "ya", T0);
    expect(createFile(db, owner, projectId, "nuevo.txt", "otro", T1)).toEqual({ ok: false, reason: "exists" });
    expect(readFile(db, owner, projectId, "nuevo.txt")?.content).toBe("ya");
    db.close();
  });
});

describe("renameFile", () => {
  it("mueve el contenido y deja libre la ruta antigua", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "a.html", "contenido", T0);
    expect(renameFile(db, owner, projectId, "a.html", "b.html", T1)).toEqual({
      ok: true,
      file: { path: "b.html", bytes: 9, updatedAt: T1 }
    });
    expect(readFile(db, owner, projectId, "a.html")).toBeUndefined();
    expect(readFile(db, owner, projectId, "b.html")?.content).toBe("contenido");
    db.close();
  });

  it("no pisa un archivo que ya existe", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "a.html", "uno", T0);
    writeFile(db, owner, projectId, "b.html", "dos", T0);
    expect(renameFile(db, owner, projectId, "a.html", "b.html", T1)).toEqual({ ok: false, reason: "exists" });
    expect(readFile(db, owner, projectId, "a.html")?.content).toBe("uno");
    db.close();
  });

  it("avisa si el origen no existe", () => {
    const { db, owner, projectId } = fixture();
    expect(renameFile(db, owner, projectId, "nunca.html", "otro.html", T1)).toEqual({ ok: false, reason: "missing" });
    db.close();
  });

  it("renueva la fecha cuando el destino es la misma ruta", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "a.html", "uno", T0);
    expect(renameFile(db, owner, projectId, "a.html", "./a.html", T1)).toEqual({
      ok: true,
      file: { path: "a.html", bytes: 3, updatedAt: T1 }
    });
    db.close();
  });

  it("no renombra en un proyecto ajeno", () => {
    const { db, owner, projectId, other } = fixture();
    writeFile(db, owner, projectId, "a.html", "uno", T0);
    expect(renameFile(db, other, projectId, "a.html", "b.html", T1)).toEqual({ ok: false, reason: "no-project" });
    db.close();
  });
});

describe("deleteFile", () => {
  it("borra el archivo", () => {
    const { db, owner, projectId } = fixture();
    writeFile(db, owner, projectId, "a.html", "uno", T0);
    expect(deleteFile(db, owner, projectId, "a.html")).toEqual({ ok: true });
    expect(listFiles(db, owner, projectId)).toEqual([]);
    db.close();
  });

  it("avisa si ya no estaba", () => {
    const { db, owner, projectId } = fixture();
    expect(deleteFile(db, owner, projectId, "a.html")).toEqual({ ok: false, reason: "missing" });
    db.close();
  });

  it("no borra en un proyecto ajeno", () => {
    const { db, owner, projectId, other } = fixture();
    writeFile(db, owner, projectId, "a.html", "uno", T0);
    expect(deleteFile(db, other, projectId, "a.html")).toEqual({ ok: false, reason: "no-project" });
    expect(listFiles(db, owner, projectId).length).toBe(1);
    db.close();
  });
});

describe("writeFiles", () => {
  it("graba varios archivos en una sola operación", () => {
    const { db, owner, projectId } = fixture();
    const count = writeFiles(db, owner, projectId, { "index.html": "<h1>Inicio</h1>", "styles.css": "body{}" }, T0);
    expect(count).toBe(2);
    expect(listFiles(db, owner, projectId).map((f) => f.path)).toEqual(["index.html", "styles.css"]);
    db.close();
  });

  it("no graba nada si el proyecto no es del usuario", () => {
    const { db, projectId, other } = fixture();
    expect(writeFiles(db, other, projectId, { "index.html": "intruso" }, T0)).toBe(0);
    expect(listFiles(db, other, projectId)).toEqual([]);
    db.close();
  });

  it("si un archivo no cabe, no graba ninguno", () => {
    const { db, owner, projectId } = fixture();
    const huge = "x".repeat(MAX_FILE_BYTES + 1);
    expect(() => writeFiles(db, owner, projectId, { "ok.txt": "vale", "grande.txt": huge }, T0)).toThrow(
      ValidationError
    );
    expect(listFiles(db, owner, projectId)).toEqual([]);
    db.close();
  });

  it("rechaza un lote que superaría el máximo de archivos del proyecto", () => {
    const { db, owner, projectId } = fixture();
    const muchos = Object.fromEntries(
      Array.from({ length: MAX_FILES_PER_PROJECT + 1 }, (_, i) => [`f${i}.txt`, "x"])
    );
    expect(() => writeFiles(db, owner, projectId, muchos, T0)).toThrow(/200 archivos/);
    expect(listFiles(db, owner, projectId)).toEqual([]);
    db.close();
  });
});
