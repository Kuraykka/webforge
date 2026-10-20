import { describe, expect, it } from "vitest";
import { staticTemplate } from "../projects/templates";
import { parseHtml } from "./htmlSource";
import { BUILDER_COMPONENTS, componentById } from "./components";

const SHEET = staticTemplate("Prueba", "static")["styles.css"] ?? "";

/** Clases que el constructor escribe en el HTML de un componente. */
function classesOf(html: string): string[] {
  return [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? "").split(/\s+/)).filter(Boolean);
}

describe("BUILDER_COMPONENTS", () => {
  it("usa nombres de clase válidos en todas sus plantillas", () => {
    for (const component of BUILDER_COMPONENTS) {
      for (const token of classesOf(component.html)) {
        expect(token, `${component.id} tiene una clase ilegible`).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("no deja clases huérfanas: la hoja de estilos de la plantilla define cada clase que se inserta", () => {
    const huérfanas = new Set<string>();
    for (const component of BUILDER_COMPONENTS) {
      for (const token of classesOf(component.html)) {
        // Una clase puede estar en un selector compuesto (`.tarjeta h3`); basta con que aparezca.
        if (!new RegExp(`\\.${token}(?![\\w-])`).test(SHEET)) huérfanas.add(token);
      }
    }
    expect([...huérfanas].sort()).toEqual([]);
  });

  it("declara los bloques de estructura, contenido, formulario y medio que pide el requisito", () => {
    const ids = BUILDER_COMPONENTS.map((component) => component.id);
    for (const id of [
      "encabezado",
      "menu",
      "hero",
      "seccion",
      "columnas",
      "rejilla-3",
      "rejilla-4",
      "titulo",
      "parrafo",
      "lista",
      "tabla",
      "tarjeta",
      "cita",
      "boton",
      "enlace",
      "modal",
      "separador",
      "imagen",
      "icono",
      "video",
      "formulario",
      "campo"
    ]) {
      expect(ids, `falta el componente ${id}`).toContain(id);
    }
  });

  it("cada plantilla es HTML bien formado: sin etiquetas abiertas y con sus elementos localizables", () => {
    for (const component of BUILDER_COMPONENTS) {
      const parsed = parseHtml(component.html);
      expect(parsed.unclosed, `${component.id} deja etiquetas sin cerrar`).toEqual([]);
      expect(parsed.byPath.size, `${component.id} no produce elementos`).toBeGreaterThan(0);
    }
  });
});

describe("componentById", () => {
  it("devuelve la entrada pedida y nada para una id inexistente", () => {
    expect(componentById("tabla")?.group).toBe("contenido");
    expect(componentById("no-existe")).toBeUndefined();
  });
});

/**
 * El HTML del constructor se publica tal cual, así que lo accesible o lo inaccesible se hereda
 * de la plantilla: estas pruebas fijan las piezas que un lector de pantalla necesita.
 */
describe("accesibilidad de las plantillas", () => {
  it("la tabla se presenta con título y cabecera relacionable", () => {
    const html = componentById("tabla")?.html ?? "";
    expect(html).toContain("<caption>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("<th");
  });

  it("el modal usa dialog con nombre y botón de cierre", () => {
    const html = componentById("modal")?.html ?? "";
    expect(html).toContain("<dialog");
    expect(html).toMatch(/aria-(label|labelledby)=/);
    expect(html).toMatch(/<button[^>]*>(Cerrar|Aceptar)/);
  });

  it("el icono decorativo no se anuncia y el vídeo trae póster y respaldo", () => {
    expect(componentById("icono")?.html).toContain('aria-hidden="true"');
    const video = componentById("video")?.html ?? "";
    expect(video).toContain("poster=");
    expect(video).toContain("<source");
  });

  it("el menú se marca como navegación y el encabezado conserva la marca", () => {
    expect(componentById("menu")?.html).toContain("<nav");
    expect(componentById("menu")?.html).toMatch(/aria-label=/);
    expect(componentById("encabezado")?.html).toContain("<header");
  });

  it("el formulario insertado relaciona etiqueta y campo", () => {
    const html = componentById("formulario")?.html ?? "";
    const foros = [...html.matchAll(/for="([^"]+)"/g)].map((match) => match[1]);
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    for (const target of foros) expect(ids, `ningún campo con id="${target}"`).toContain(target);
  });
});

/**
 * El requisito pide responsive de verdad y un sistema de temas: eso vive en la hoja que siembra
 * la plantilla, así que se comprueba aquí y no en una captura de pantalla.
 */
describe("hoja de estilos que siembra la plantilla", () => {
  it("declara las variables de diseño en :root", () => {
    expect(SHEET).toMatch(/:root\s*{[^}]*--ink:/s);
    expect(SHEET).toMatch(/--accent:/);
    expect(SHEET).toMatch(/--space-4:/);
    expect(SHEET).toMatch(/--radio:/);
    expect(SHEET).toMatch(/--fuente-cuerpo:/);
  });

  it("ofrece un tema alternativo que reescribe las mismas variables", () => {
    const bloque = /data-theme="oscuro"]\s*{([^}]*)}/.exec(SHEET)?.[1] ?? "";
    for (const token of ["--ink", "--surface", "--line", "--accent"]) {
      expect(bloque, `el tema oscuro no redefine ${token}`).toContain(token);
    }
  });

  it("define al menos dos puntos de ruptura para tableta y escritorio", () => {
    const anchos = [...SHEET.matchAll(/@media \(min-width: ([\d.]+)rem\)/g)].map((match) => Number(match[1]));
    expect(anchos.length).toBeGreaterThanOrEqual(2);
    expect(anchos.some((value) => value <= 48), "no hay punto de ruptura de tableta").toBe(true);
    expect(anchos.some((value) => value >= 60), "no hay punto de ruptura de escritorio").toBe(true);
  });

  it("las rejillas del constructor pasan de una columna a varias", () => {
    expect(SHEET).toMatch(/\.rejilla-3\s*{[^}]*repeat\(3/s);
    expect(SHEET).toMatch(/\.rejilla-4\s*{[^}]*repeat\(4/s);
  });
});
