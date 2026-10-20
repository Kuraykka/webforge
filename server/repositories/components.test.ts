import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ConflictError, ValidationError } from "../errors.ts";
import { insertUser } from "./users.ts";
import {
  MAX_COMPONENT_BYTES,
  MAX_COMPONENT_NAME_CHARS,
  MAX_COMPONENTS_PER_USER,
  createComponent,
  deleteComponent,
  findComponent,
  listComponents,
  updateComponent
} from "./components.ts";

const T1 = "2026-03-02T10:00:00.000Z";
const T2 = "2026-03-03T10:00:00.000Z";

const TARJETA = '<article class="card"><h3>Título</h3></article>';

interface Fixture {
  db: Sql;
  owner: string;
  other: string;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  return { db, owner, other };
}

const guarda = (f: Fixture, name: string, html = TARJETA, owner = f.owner, now = T1) =>
  createComponent(f.db, owner, { name, html }, now);

describe("createComponent", () => {
  it("guarda el bloque con su tamaño en bytes", () => {
    const f = fixture();
    const component = guarda(f, "Tarjeta de servicio");
    expect(component.name).toBe("Tarjeta de servicio");
    expect(component.html).toBe(TARJETA);
    expect(component.bytes).toBe(Buffer.byteLength(TARJETA, "utf8"));
    expect(component.createdAt).toBe(T1);
    expect(findComponent(f.db, f.owner, component.id)).toEqual(component);
  });

  it("recorta el nombre y ordena la lista por nombre", () => {
    const f = fixture();
    guarda(f, "  Zebra  ", "<p>z</p>", f.owner, T1);
    guarda(f, "Árbol", "<p>a</p>", f.owner, T2);
    expect(listComponents(f.db, f.owner).map((c) => c.name)).toEqual(["Árbol", "Zebra"]);
  });

  it("exige un nombre y un html con contenido", () => {
    const f = fixture();
    expect(() => guarda(f, "   ")).toThrow(ValidationError);
    expect(() => createComponent(f.db, f.owner, { name: "Bloque", html: "   " })).toThrow(ValidationError);
    expect(() => guarda(f, "n")).toThrow(/caracteres/);
  });

  it("rechaza nombres interminables y bloques demasiado grandes", () => {
    const f = fixture();
    expect(() => guarda(f, "e".repeat(MAX_COMPONENT_NAME_CHARS + 1))).toThrow(/nombre/);
    const enorme = `<p>${"x".repeat(MAX_COMPONENT_BYTES)}</p>`;
    expect(() => createComponent(f.db, f.owner, { name: "Enorme", html: enorme })).toThrow(/bytes/);
  });

  it("rechaza los caracteres de control y deja saltos y tabulaciones", () => {
    const f = fixture();
    const conControl = `<p>a${"\u0000"}b</p>`;
    expect(() => createComponent(f.db, f.owner, { name: "Raro", html: conControl })).toThrow(/control/);
    const conSaltos = "<section>\n\t<p>con sangría</p>\n</section>";
    expect(guarda(f, "Con saltos", conSaltos).html).toBe(conSaltos);
  });

  it("el script del propio usuario se guarda tal cual: el aislamiento es la vista previa", () => {
    const f = fixture();
    const conScript = "<div><script>console.log(1)</script></div>";
    expect(guarda(f, "Con script", conScript).html).toBe(conScript);
  });

  it("no permite repetir el nombre dentro de la misma cuenta", () => {
    const f = fixture();
    guarda(f, "Tarjetahero");
    expect(() => guarda(f, "  tarjetaHERO ")).toThrow(ConflictError);
    // Otra cuenta con el mismo nombre: no es conflicto, cada biblioteca es suya.
    expect(guarda(f, "TarjetaHERO", TARJETA, f.other).id).toBeTruthy();
  });

  it("pone un tope de bloques por cuenta", () => {
    const f = fixture();
    for (let i = 0; i < MAX_COMPONENTS_PER_USER; i += 1) guarda(f, `Bloque ${String(i).padStart(3, "0")}`);
    expect(listComponents(f.db, f.owner)).toHaveLength(MAX_COMPONENTS_PER_USER);
    expect(() => guarda(f, "El uno más")).toThrow(ConflictError);
  });
});

describe("listComponents y findComponent", () => {
  it("una cuenta no ve ni lee los bloques de otra", () => {
    const f = fixture();
    const component = guarda(f, "Privado");
    expect(listComponents(f.db, f.other)).toEqual([]);
    expect(findComponent(f.db, f.other, component.id)).toBeUndefined();
  });

  it("la lista trae el html: reutilizar un bloque no cuesta otra petición", () => {
    const f = fixture();
    guarda(f, "Tarjeta de servicio");
    const [primero] = listComponents(f.db, f.owner);
    expect(primero?.html).toBe(TARJETA);
  });
});

describe("updateComponent", () => {
  it("cambia el contenido sin tocar la fecha de creación", () => {
    const f = fixture();
    const component = guarda(f, "Tarjeta");
    const actual = updateComponent(f.db, f.owner, component.id, { html: "<p>Nuevo</p>" }, T2);
    expect(actual?.html).toBe("<p>Nuevo</p>");
    expect(actual?.bytes).toBe(Buffer.byteLength("<p>Nuevo</p>", "utf8"));
    expect(actual?.createdAt).toBe(T1);
    expect(actual?.updatedAt).toBe(T2);
  });

  it("renombra y respeta que el nombre esté cogido en la misma cuenta", () => {
    const f = fixture();
    const a = guarda(f, "Uno");
    const b = guarda(f, "Dos");
    expect(updateComponent(f.db, f.owner, a.id, { name: "  Tres  " }, T2)?.name).toBe("Tres");
    expect(() => updateComponent(f.db, f.owner, b.id, { name: "tres" }, T2)).toThrow(ConflictError);
  });

  it("nada cambia si no se pide nada y no existe el bloque", () => {
    const f = fixture();
    const a = guarda(f, "Uno");
    expect(updateComponent(f.db, f.owner, a.id, {}, T2)).toEqual(a);
    expect(updateComponent(f.db, f.owner, "inexistente", { name: "Otro" }, T2)).toBeUndefined();
    expect(() => updateComponent(f.db, f.owner, a.id, { name: "  " }, T2)).toThrow(ValidationError);
  });

  it("otra cuenta no puede editar el bloque ajeno", () => {
    const f = fixture();
    const a = guarda(f, "Privado");
    expect(updateComponent(f.db, f.other, a.id, { html: "<p>malo</p>" }, T2)).toBeUndefined();
    expect(findComponent(f.db, f.owner, a.id)?.html).toBe(TARJETA);
  });
});

describe("reglas de estilo del bloque", () => {
  const ROJO = [{ selector: ".wf-e1", cambios: { color: "#b30000" } }];

  it("guarda y devuelve las reglas que necesita el bloque", () => {
    const f = fixture();
    const creado = createComponent(
      f.db,
      f.owner,
      { name: "Titular rojo", html: '<h1 class="wf-e1">Hola</h1>', reglas: ROJO },
      T1
    );
    expect(creado.reglas).toEqual(ROJO);
    expect(findComponent(f.db, f.owner, creado.id)?.reglas).toEqual(ROJO);
    expect(listComponents(f.db, f.owner)[0]?.reglas).toEqual(ROJO);
  });

  it("un bloque sin reglas se guarda con la lista vacía", () => {
    const f = fixture();
    expect(guarda(f, "Simple").reglas).toEqual([]);
  });

  it("solo se admiten reglas de las clases de estilo del constructor", () => {
    const f = fixture();
    const con = (reglas: unknown) => createComponent(f.db, f.owner, { name: "Colado", html: "<p>x</p>", reglas: reglas as never });
    expect(() => con("todo")).toThrow(/lista/);
    expect(() => con([{ selector: "body", cambios: { display: "none" } }])).toThrow(/wf-e/);
    expect(() => con([{ selector: ".card", cambios: { color: "red" } }])).toThrow(/wf-e/);
    expect(() => con([{ selector: ".wf-e1", cambios: { color: "red;}body{display:none" } }])).toThrow(/no puede contener/);
    expect(() => con([{ selector: ".wf-e1", cambios: { "1malo": "x" } }])).toThrow(/propiedad/);
    expect(() => con([{ selector: ".wf-e1", cambios: {} }])).toThrow(/declaración/);
  });

  it("pone tope a las reglas y a su tamaño", () => {
    const f = fixture();
    const muchas = Array.from({ length: 21 }, (_, i) => ({
      selector: `.wf-e${String(i + 1)}`,
      cambios: { color: "#b30000" }
    }));
    expect(() => createComponent(f.db, f.owner, { name: "Muchas", html: "<p>x</p>", reglas: muchas })).toThrow(/reglas/);
    expect(() =>
      createComponent(f.db, f.owner, {
        name: "Repetida",
        html: "<p>x</p>",
        reglas: [ROJO[0]!, ROJO[0]!]
      })
    ).toThrow(/repetida/i);
  });

  it("actualizar las reglas reemplaza las anteriores", () => {
    const f = fixture();
    const creado = createComponent(f.db, f.owner, { name: "Titular", html: '<h1 class="wf-e1">Hola</h1>', reglas: ROJO }, T1);
    const editado = updateComponent(
      f.db,
      f.owner,
      creado.id,
      { reglas: [{ selector: ".wf-e2", cambios: { color: "#0000ff" } }] },
      T2
    );
    expect(editado?.reglas).toEqual([{ selector: ".wf-e2", cambios: { color: "#0000ff" } }]);
    expect(editado?.createdAt).toBe(T1);
    expect(editado?.html).toBe('<h1 class="wf-e1">Hola</h1>');
    expect(findComponent(f.db, f.owner, creado.id)?.reglas).toEqual([{ selector: ".wf-e2", cambios: { color: "#0000ff" } }]);
  });

  it("quitar todas las reglas deja la lista vacía", () => {
    const f = fixture();
    const creado = createComponent(f.db, f.owner, { name: "Titular", html: '<h1 class="wf-e1">Hola</h1>', reglas: ROJO }, T1);
    expect(updateComponent(f.db, f.owner, creado.id, { reglas: [] }, T2)?.reglas).toEqual([]);
  });
});

describe("deleteComponent", () => {
  it("borra el propio y hace la vista sobre el ajeno", () => {
    const f = fixture();
    const a = guarda(f, "Uno");
    const b = guarda(f, "Dos");
    expect(deleteComponent(f.db, f.other, a.id)).toBe(false);
    expect(findComponent(f.db, f.owner, a.id)).toBeDefined();
    expect(deleteComponent(f.db, f.owner, a.id)).toBe(true);
    expect(deleteComponent(f.db, f.owner, a.id)).toBe(false);
    expect(listComponents(f.db, f.owner).map((c) => c.id)).toEqual([b.id]);
  });
});
