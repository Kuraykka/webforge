import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { writeFile } from "./files.ts";
import { insertProject, removeProject } from "./projects.ts";
import { insertUser } from "./users.ts";
import { MAX_FILE_RESULTS, SNIPPET_CHARS, searchAll } from "./search.ts";

const T0 = "2026-03-01T10:00:00.000Z";

interface Fixture {
  db: Sql;
  owner: string;
  other: string;
  tienda: string;
  blog: string;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const tienda = insertProject(db, {
    ownerUserId: owner,
    name: "Mi tienda",
    description: "Catalogo con carrito",
    tags: ["venta", "tienda"],
    stack: "static",
    now: T0
  }).id;
  const blog = insertProject(db, { ownerUserId: owner, name: "Blog técnico", stack: "static", now: T0 }).id;
  return { db, owner, other, tienda, blog };
}

const escribir = (f: Fixture, projectId: string, path: string, content: string) => {
  const resultado = writeFile(f.db, f.owner, projectId, path, content, T0);
  if (!resultado.ok) throw new Error(`No se pudo escribir «${path}»: ${resultado.reason}`);
};

describe("searchAll", () => {
  it("encuentra un proyecto por su nombre", () => {
    const f = fixture();
    const resultados = searchAll(f.db, f.owner, "tienda");
    expect(resultados.projects.map((p) => p.name)).toEqual(["Mi tienda"]);
  });

  it("buscaba también en la descripción y en las etiquetas", () => {
    const f = fixture();
    expect(searchAll(f.db, f.owner, "carrito").projects.map((p) => p.name)).toEqual(["Mi tienda"]);
    expect(searchAll(f.db, f.owner, "venta").projects.map((p) => p.name)).toEqual(["Mi tienda"]);
  });

  it("encuentra el texto dentro del contenido de un archivo", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "<h1>Título</h1>\n<p>Precio final</p>\n");
    const hit = searchAll(f.db, f.owner, "precio").files;
    expect(hit).toHaveLength(1);
    expect(hit[0]?.projectName).toBe("Mi tienda");
    expect(hit[0]?.path).toBe("index.html");
  });

  it("dice la línea donde está el texto, contada desde 1", () => {
    const f = fixture();
    escribir(f, f.tienda, "main.js", "const a = 1;\nconst b = 2;\nconst total = a + b;\n");
    expect(searchAll(f.db, f.owner, "total").files[0]?.line).toBe(3);
  });

  it("devuelve un fragmento con el texto encontrado", () => {
    const f = fixture();
    escribir(f, f.tienda, "styles.css", "body { color: magenta; }");
    const hit = searchAll(f.db, f.owner, "magenta").files[0];
    expect(hit?.snippet).toContain("magenta");
    expect(hit?.snippet.length).toBeLessThanOrEqual(SNIPPET_CHARS);
  });

  it("la ruta del archivo también es un resultado", () => {
    const f = fixture();
    escribir(f, f.blog, "src/styles.css", "nada que ver");
    const hit = searchAll(f.db, f.owner, "styles").files;
    expect(hit[0]?.path).toBe("src/styles.css");
    // Coincide el nombre, no el contenido: la línea 1 es donde se informa.
    expect(hit[0]?.line).toBe(1);
  });

  it("no distingue mayúsculas al buscar", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "<H1>BIENVENIDA</H1>");
    expect(searchAll(f.db, f.owner, "bienvenida").files).toHaveLength(1);
  });

  it("un término de una letra no busca nada", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "un archivo corto");
    const resultados = searchAll(f.db, f.owner, "u");
    expect(resultados.projects).toEqual([]);
    expect(resultados.files).toEqual([]);
    expect(resultados.term).toBe("u");
  });

  it("un término interminable se rechaza", () => {
    const f = fixture();
    expect(() => searchAll(f.db, f.owner, `x${"y".repeat(120)}`)).toThrow(ValidationError);
  });

  it("los comodines se buscan como texto literal", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "<p>100% garantía</p>");
    escribir(f, f.blog, "index.html", "<p>otro texto</p>");
    expect(searchAll(f.db, f.owner, "100%").files.map((h) => h.projectName)).toEqual(["Mi tienda"]);
    expect(searchAll(f.db, f.owner, "__").files).toEqual([]);
  });

  it("no entrega nada de otra cuenta", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "la clave secreta de ana");
    const proyecto = insertProject(f.db, { ownerUserId: f.other, name: "Tienda de luis", stack: "static", now: T0 }).id;
    const ajeno = writeFile(f.db, f.other, proyecto, "index.html", "la clave secreta de luis", T0);
    if (!ajeno.ok) throw new Error(ajeno.reason);
    const resultados = searchAll(f.db, f.owner, "secreta");
    expect(resultados.files.map((h) => h.projectName)).toEqual(["Mi tienda"]);
    expect(resultados.projects).toEqual([]);
    expect(searchAll(f.db, f.other, "secreta").files.map((h) => h.projectName)).toEqual(["Tienda de luis"]);
  });

  it("un proyecto borrado ya no se busca", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "liquidación total");
    expect(removeProject(f.db, f.owner, f.tienda, T0)).toBe(true);
    const resultados = searchAll(f.db, f.owner, "liquidación");
    expect(resultados.projects).toEqual([]);
    expect(resultados.files).toEqual([]);
  });

  it("acota cuántos archivos devuelve", () => {
    const f = fixture();
    for (let i = 0; i < MAX_FILE_RESULTS + 5; i++) {
      escribir(f, f.tienda, `notas/${String(i).padStart(3, "0")}.md`, `reunión ${i}`);
    }
    expect(searchAll(f.db, f.owner, "reunión").files).toHaveLength(MAX_FILE_RESULTS);
  });

  it("los saltos de línea no se cuelan en el fragmento", () => {
    const f = fixture();
    escribir(f, f.tienda, "index.html", "primera línea\n\tsegunda\rtercera línea");
    const hit = searchAll(f.db, f.owner, "tercera").files[0];
    expect(hit?.snippet).toBe(hit?.snippet.trim());
    expect(/[\n\r\t]/.test(hit?.snippet ?? "")).toBe(false);
  });

  it("un archivo sin contenido no rompe la búsqueda", () => {
    const f = fixture();
    escribir(f, f.tienda, "vacio.txt", "");
    expect(searchAll(f.db, f.owner, "vacio").files.map((h) => h.path)).toEqual(["vacio.txt"]);
    expect(searchAll(f.db, f.owner, "nada").files).toEqual([]);
  });
});
