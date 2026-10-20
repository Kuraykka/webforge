import { describe, expect, it } from "vitest";
import { buildPreviewDocument, resolveProjectPath } from "./previewDocument";

const RUNTIME = "/*runtime*/";

function build(entry: string, stampedHtml: string, files: Record<string, string>, builder = false) {
  return buildPreviewDocument({
    entry,
    stampedHtml,
    files: new Map(Object.entries(files)),
    runtimeScript: RUNTIME,
    builder
  });
}

describe("resolveProjectPath", () => {
  it("resuelve rutas relativas dentro del proyecto", () => {
    expect(resolveProjectPath("public/index.html", "styles.css")).toBe("public/styles.css");
    expect(resolveProjectPath("index.html", "./src/app.js")).toBe("src/app.js");
    expect(resolveProjectPath("src/pages/index.html", "../styles.css")).toBe("src/styles.css");
  });

  it("devuelve null para recursos externos, anclas y rutas absolutas", () => {
    expect(resolveProjectPath("index.html", "https://cdn.example.com/x.css")).toBeNull();
    expect(resolveProjectPath("index.html", "//cdn.example.com/x.css")).toBeNull();
    expect(resolveProjectPath("index.html", "data:image/png;base64,AAA")).toBeNull();
    expect(resolveProjectPath("index.html", "#seccion")).toBeNull();
    expect(resolveProjectPath("index.html", "/root.css")).toBeNull();
    expect(resolveProjectPath("index.html", "../fuera.js")).toBeNull();
  });
});

describe("buildPreviewDocument", () => {
  it("incrusta las hojas de estilos locales", () => {
    const doc = build(
      "index.html",
      '<html><head><link rel="stylesheet" href="styles.css"></head><body></body></html>',
      { "styles.css": "body{color:red}" }
    );
    expect(doc.html).toContain('<style data-wf-src="styles.css">');
    expect(doc.html).toContain("body{color:red}");
    expect(doc.warnings).toEqual([]);
  });

  it("incrusta los scripts locales preservando type=module", () => {
    const doc = build(
      "index.html",
      '<html><body><script type="module" src="src/app.js"></script></body></html>',
      { "src/app.js": "console.log(1)" }
    );
    expect(doc.html).toContain('<script type="module" data-wf-src="src/app.js">');
    expect(doc.html).toContain("console.log(1)");
  });

  it("escapa el cierre de script del código incrustado", () => {
    const doc = build("index.html", '<html><body><script src="app.js"></script></body></html>', {
      "app.js": 'document.body.innerHTML = "</script>";'
    });
    expect(doc.html).toContain("<\\/script>");
    expect(doc.html.split("</script>")).toHaveLength(3);
  });

  it("avisa del TypeScript que aún no se compila", () => {
    const doc = build("index.html", '<html><body><script src="main.ts"></script></body></html>', {
      "main.ts": "const a: number = 1;"
    });
    expect(doc.warnings.some((w) => w.includes("main.ts") && w.includes("compilación"))).toBe(true);
    expect(doc.html).not.toContain("const a: number");
  });

  it("advierte de los recursos que faltan", () => {
    const doc = build(
      "index.html",
      '<html><head><link rel="stylesheet" href="falta.css"></head><body><img src="logo.png"><a href="otro.html">x</a></body></html>',
      {}
    );
    expect(doc.warnings).toContain("Falta falta.css: no se encontró la hoja de estilos.");
    expect(doc.warnings).toContain("Falta logo.png en el proyecto.");
    expect(doc.warnings).toContain("Falta otro.html en el proyecto.");
  });

  it("no deja referencias locales sin resolver que salgan a la red del sandbox", () => {
    const doc = build(
      "index.html",
      '<html><head><link rel="stylesheet" href="falta.css"></head><body><script src="aun-no-carga.js"></script><script src="https://cdn.ejemplo.app/lib.js"></script></body></html>',
      {}
    );
    expect(doc.html).not.toContain('href="falta.css"');
    expect(doc.html).not.toContain('src="aun-no-carga.js"');
    expect(doc.html).toContain('src="https://cdn.ejemplo.app/lib.js"');
    expect(doc.warnings).toContain("Falta aun-no-carga.js: no se encontró el script.");
  });

  it("inyecta el runtime y el modo constructor antes de /body", () => {
    const doc = build("index.html", "<html><body><p>hola</p></body></html>", {}, true);
    expect(doc.html).toContain("window.__wfBuilder=true;/*runtime*/");
    expect(doc.html.indexOf("window.__wfBuilder")).toBeLessThan(doc.html.indexOf("</body>"));
    expect(build("index.html", "<html><body></body></html>", {}, false).html).toContain("window.__wfBuilder=false;");
  });

  it("añade el runtime cuando no hay body de cierre", () => {
    const doc = build("index.html", "<p>sin body</p>", {});
    expect(doc.html.endsWith("<script>window.__wfBuilder=false;/*runtime*/</script>")).toBe(true);
  });
});
