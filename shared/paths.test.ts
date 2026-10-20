import { describe, expect, it } from "vitest";
import { buildFileTree, basename, dirname, extname, isSafePath, normalizePath } from "./paths";

describe("normalizePath", () => {
  it("normaliza separadores, espacios y rutas relativas", () => {
    expect(normalizePath("  src//app.tsx  ")).toBe("src/app.tsx");
    expect(normalizePath(".\\index.html")).toBe("index.html");
    expect(normalizePath("src/../index.html")).toBe("index.html");
  });

  it.each([
    ["", "vacía"],
    ["/etc/passwd", "absoluta"],
    ["../../escape", "sale del proyecto"],
    ["src/../..", "sale del proyecto"],
    ["a<b>c.txt", "caracteres proibidos"],
    ["archivo:name.txt", "caracteres proibidos"],
    ["a?.txt", "caracteres proibidos"]
  ])("rechaza %s (%s)", (input) => {
    expect(() => normalizePath(input)).toThrowError(/no válida/);
  });

  it("rechaza rutas demasiado largas o con exceso de niveles", () => {
    expect(() => normalizePath(`${"a".repeat(201)}.txt`)).toThrowError(/supera/);
    expect(() => normalizePath("1/2/3/4/5/6/7/8/9/10/11/12/13.txt")).toThrowError(/niveles/);
  });

  it("no permite un segmento terminado en espacio", () => {
    expect(() => normalizePath("carpeta /archivo.txt")).toThrowError(/termina en espacio/);
  });
});

describe("isSafePath", () => {
  it("es coherente con normalizePath", () => {
    expect(isSafePath("src/main.js")).toBe(true);
    expect(isSafePath("../escape.js")).toBe(false);
  });
});

describe("dirname, basename y extname", () => {
  it("descomponen rutas", () => {
    expect(dirname("src/app/main.tsx")).toBe("src/app");
    expect(dirname("index.html")).toBe("");
    expect(basename("src/app/main.tsx")).toBe("main.tsx");
    expect(extname("src/app/main.tsx")).toBe("tsx");
    expect(extname("styles.css")).toBe("css");
    expect(extname("Makefile")).toBe("");
    expect(extname(".eslintrc.json")).toBe("json");
  });
});

describe("buildFileTree", () => {
  it("agrupa carpetas delante de los archivos y ordena alfabéticamente", () => {
    const tree = buildFileTree(["index.html", "styles.css", "src/main.ts", "src/app/Header.tsx"]);
    expect(tree.map((entry) => entry.name)).toEqual(["src", "index.html", "styles.css"]);
    const src = tree[0];
    expect(src?.type).toBe("directory");
    if (src?.type !== "directory") return;
    expect(src.children.map((entry) => entry.name)).toEqual(["app", "main.ts"]);
  });

  it("conserva rutas completas en cada nodo", () => {
    const tree = buildFileTree(["a/b/c.txt"]);
    const a = tree[0];
    if (a?.type !== "directory") throw new Error("esperado carpeta");
    const b = a.children[0];
    if (b?.type !== "directory") throw new Error("esperado carpeta");
    expect(b.path).toBe("a/b");
    expect(b.children[0]).toEqual({ type: "file", name: "c.txt", path: "a/b/c.txt" });
  });
});
