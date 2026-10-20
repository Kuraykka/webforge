import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import {
  HttpComponentStore,
  aplicaReglasDelBloque,
  bloquesDeBiblioteca,
  preparaBloque,
  reglasDelBloque
} from "./library";

interface Route {
  status?: number;
  payload?: unknown;
}

interface Recorded {
  method: string;
  url: string;
  body: string | undefined;
}

function harness(routes: Record<string, Route>) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, body: typeof init.body === "string" ? init.body : undefined });
    const route = routes[`${init.method} ${url}`] ?? { status: 404, payload: { error: "No existe el recurso." } };
    if ((route.status ?? 200) === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(route.payload ?? null), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { store: new HttpComponentStore(createApiClient(fetchImpl)), calls };
}

const BLOQUE = {
  id: "c1",
  name: "Tarjeta de servicio",
  html: '<article class="card"><h3>Hola</h3></article>',
  reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }],
  bytes: 43,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z"
};

/** Hoja de un proyecto del constructor: variables, dos clases de estilo y una regla a mano. */
const HOJA = `:root {
  --accent: #2563eb;
}

.wf-e2 {
  padding: 2rem;
}

.wf-e1 {
  color: #b30000;
  font-size: 3rem;
}

.tarjeta .wf-e9 {
  color: green;
}
`;

describe("HttpComponentStore", () => {
  it("lista la biblioteca de la cuenta", async () => {
    const { store, calls } = harness({ "GET /api/components": { payload: { components: [BLOQUE] } } });
    await expect(store.list()).resolves.toEqual([BLOQUE]);
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/components" });
  });

  it("crea un bloque con su nombre y su HTML", async () => {
    const { store, calls } = harness({ "POST /api/components": { status: 201, payload: { component: BLOQUE } } });
    await expect(store.create({ name: "Tarjeta de servicio", html: BLOQUE.html })).resolves.toEqual(BLOQUE);
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "Tarjeta de servicio", html: BLOQUE.html });
  });

  it("manda también las reglas cuando el bloque las tiene", async () => {
    const { store, calls } = harness({ "POST /api/components": { status: 201, payload: { component: BLOQUE } } });
    await store.create({ name: "Tarjeta de servicio", html: BLOQUE.html, reglas: BLOQUE.reglas });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      name: "Tarjeta de servicio",
      html: BLOQUE.html,
      reglas: BLOQUE.reglas
    });
  });

  it("edita solo lo que se manda", async () => {
    const { store, calls } = harness({ "PUT /api/components/c1": { payload: { component: BLOQUE } } });
    await expect(store.update("c1", { name: "Otro nombre" })).resolves.toEqual(BLOQUE);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "Otro nombre" });
  });

  it("borra por identificador escapado", async () => {
    const { store, calls } = harness({ "DELETE /api/components/c%201": { status: 204 } });
    await expect(store.remove("c 1")).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/components/c%201" });
  });

  it("el error del servidor llega con su mensaje", async () => {
    const { store } = harness({
      "POST /api/components": { status: 409, payload: { error: "Ya tienes un bloque llamado «Tarjeta»." } }
    });
    await expect(store.create({ name: "Tarjeta", html: "<p>x</p>" })).rejects.toThrow(/Ya tienes un bloque/);
  });
});

describe("bloquesDeBiblioteca", () => {
  it("convierte los bloques guardados en entradas de la paleta", () => {
    const [primero] = bloquesDeBiblioteca([BLOQUE]);
    expect(primero).toMatchObject({
      id: "c1",
      label: "Tarjeta de servicio",
      html: BLOQUE.html,
      slot: "inside-end"
    });
  });

  it("las reglas guardadas viajan con la entrada de la paleta", () => {
    expect(bloquesDeBiblioteca([BLOQUE])[0]?.reglas).toEqual(BLOQUE.reglas);
  });

  it("un recorte guardado no lleva las marcas del constructor", () => {
    const conMarcas = { ...BLOQUE, html: '<p data-wf-path="0.0.0">hola</p>' };
    expect(bloquesDeBiblioteca([conMarcas])[0]?.html).toBe("<p>hola</p>");
  });
});

describe("reglasDelBloque", () => {
  it("reúne las reglas de las clases del constructor que usa el recorte", () => {
    const html = '<h1 class="wf-e1 titulo">Hola</h1>\n<p class="card wf-e2">Cuerpo</p>';
    expect(reglasDelBloque(html, HOJA)).toEqual([
      { selector: ".wf-e2", cambios: { padding: "2rem" } },
      { selector: ".wf-e1", cambios: { color: "#b30000", "font-size": "3rem" } }
    ]);
  });

  it("se queda solo con lo que el bloque realmente usa", () => {
    expect(reglasDelBloque('<h1 class="wf-e1">Hola</h1>', HOJA)).toEqual([
      { selector: ".wf-e1", cambios: { color: "#b30000", "font-size": "3rem" } }
    ]);
  });

  it("las reglas compuestas escritas a mano no viajan", () => {
    expect(reglasDelBloque('<article class="tarjeta"><p class="wf-e9">x</p></article>', HOJA)).toEqual([]);
  });

  it("una clase del bloque sin regla escrita no inventa nada", () => {
    expect(reglasDelBloque('<p class="wf-e7">nada</p>', HOJA)).toEqual([]);
  });

  it("un recorte sin clases de estilo no lleva reglas", () => {
    expect(reglasDelBloque('<article class="card"><h3>Hola</h3></article>', HOJA)).toEqual([]);
  });

  it("un nombre parecido no se cuela", () => {
    expect(reglasDelBloque('<p class="wf-e1x tarjetas wf-extra">raro</p>', HOJA)).toEqual([]);
  });
});

describe("aplicaReglasDelBloque", () => {
  const REGLA = { selector: ".wf-e3", cambios: { color: "#b30000" } };

  it("escribe la regla del bloque en la hoja del proyecto", () => {
    const css = ":root {\n  --accent: #2563eb;\n}\n";
    const salida = aplicaReglasDelBloque(css, [REGLA]);
    expect(salida).toContain(".wf-e3 {\n  color: #b30000;\n}");
    expect(salida).toContain("--accent: #2563eb");
  });

  it("reinsertar el mismo bloque no duplica la regla", () => {
    const css = ":root {\n  --accent: #2563eb;\n}\n";
    const una = aplicaReglasDelBloque(css, [REGLA]);
    expect(aplicaReglasDelBloque(una, [REGLA])).toBe(una);
  });

  it("las reglas se escriben todas, en orden", () => {
    const salida = aplicaReglasDelBloque("", [
      { selector: ".wf-e1", cambios: { color: "red" } },
      { selector: ".wf-e2", cambios: { padding: "2rem" } }
    ]);
    expect(salida).toBe(".wf-e1 {\n  color: red;\n}\n\n.wf-e2 {\n  padding: 2rem;\n}\n");
  });

  it("sin reglas no hay hoja que escribir", () => {
    expect(aplicaReglasDelBloque(HOJA, [])).toBe(HOJA);
  });

  it("una regla sobre algo que no sea una clase del constructor se rechaza", () => {
    for (const selector of ["body", ".card", ":root", ".wf-e1 .wf-e2"]) {
      expect(() => aplicaReglasDelBloque(HOJA, [{ selector, cambios: { color: "red" } }])).toThrow(/wf-eN/);
    }
  });
});

describe("preparaBloque", () => {
  const BLOQUE_CON_REGLAS = {
    html: '<h1 class="wf-e1 titulo">Hola</h1>\n<p class="wf-e2">Cuerpo</p>',
    reglas: [
      { selector: ".wf-e1", cambios: { color: "#b30000" } },
      { selector: ".wf-e2", cambios: { padding: "2rem" } }
    ]
  };

  it("deja el bloque intacto cuando ningún nombre está cogido", () => {
    const destino = { html: "<p>otro</p>", css: ".wf-e8 {\n  color: green;\n}\n" };
    expect(preparaBloque(BLOQUE_CON_REGLAS, destino)).toEqual(BLOQUE_CON_REGLAS);
  });

  it("cambia de nombre la clase que el proyecto ya usa", () => {
    const destino = { html: '<p class="wf-e1">ya estilado</p>', css: "" };
    expect(preparaBloque(BLOQUE_CON_REGLAS, destino)).toEqual({
      html: '<h1 class="wf-e3 titulo">Hola</h1>\n<p class="wf-e2">Cuerpo</p>',
      reglas: [
        { selector: ".wf-e3", cambios: { color: "#b30000" } },
        { selector: ".wf-e2", cambios: { padding: "2rem" } }
      ]
    });
  });

  it("un nombre ocupado solo en la hoja también se cambia", () => {
    const destino = { html: "<p>limpio</p>", css: ".wf-e2 {\n  color: green;\n}\n" };
    expect(preparaBloque(BLOQUE_CON_REGLAS, destino).html).toBe(
      '<h1 class="wf-e1 titulo">Hola</h1>\n<p class="wf-e3">Cuerpo</p>'
    );
  });

  it("respeta los nombres del propio bloque cuando busca uno libre", () => {
    const bloque = {
      html: '<div class="wf-e1"><p class="wf-e2">x</p></div>',
      reglas: [
        { selector: ".wf-e1", cambios: { color: "red" } },
        { selector: ".wf-e2", cambios: { color: "blue" } }
      ]
    };
    const destino = { html: '<span class="wf-e1">usado</span>', css: "" };
    expect(preparaBloque(bloque, destino)).toEqual({
      html: '<div class="wf-e3"><p class="wf-e2">x</p></div>',
      reglas: [
        { selector: ".wf-e3", cambios: { color: "red" } },
        { selector: ".wf-e2", cambios: { color: "blue" } }
      ]
    });
  });

  it("dos nombres cogidos a la vez no chocan entre ellos", () => {
    const destino = { html: '<div class="wf-e1 wf-e2">los dos</div>', css: "" };
    const salida = preparaBloque(BLOQUE_CON_REGLAS, destino);
    expect(salida.html).toBe('<h1 class="wf-e3 titulo">Hola</h1>\n<p class="wf-e4">Cuerpo</p>');
    expect(salida.reglas.map((regla) => regla.selector)).toEqual([".wf-e3", ".wf-e4"]);
  });

  it("un bloque sin reglas no necesita mirar el destino", () => {
    const plano = { html: '<article class="card"><h3>Tarjeta</h3></article>', reglas: [] };
    const destino = { html: '<p class="wf-e1">x</p>', css: ".wf-e1 {\n  color: green;\n}\n" };
    expect(preparaBloque(plano, destino)).toEqual(plano);
  });
});
