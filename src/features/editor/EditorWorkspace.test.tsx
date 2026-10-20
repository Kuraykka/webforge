import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { fakeComponents } from "../builder/test-support";
import type { NewProjectInput } from "../projects/types";
import { ProjectsProvider } from "../projects/ProjectsContext";
import { EditorWorkspace } from "./EditorWorkspace";

const PAGE = `<!doctype html>
<html lang="es">
  <body>
    <main>
      <h1>Hola</h1>
    </main>
  </body>
</html>
`;

/** La misma página con una clase de estilo del constructor puesta en el título. */
const CON_ESTILO = `<!doctype html>
<html lang="es">
  <body>
    <main>
      <h1 class="wf-e1">Hola</h1>
    </main>
  </body>
</html>
`;

const shared = vi.hoisted(() => ({
  value: "",
  reveal: null as { start: number; end: number; token: number; focus: boolean } | null
}));

vi.mock("./CodeEditor", async () => {
  const { createElement } = await import("react");
  const CodeEditor = (props: {
    value: string;
    onChange: (next: string) => void;
    reveal?: { start: number; end: number; token: number; focus: boolean } | null;
  }) => {
    shared.value = props.value;
    shared.reveal = props.reveal ?? null;
    return createElement("textarea", {
      "data-testid": "code-editor",
      value: props.value,
      onChange: (event: { target: { value: string } }) => props.onChange(event.target.value)
    });
  };
  return { CodeEditor };
});

let stores = localStores();

const INPUT: NewProjectInput = { name: "Tienda", description: "", folder: "tienda", tags: [], stack: "static" };

function emit(data: Record<string, unknown>, from: "frame" | "outside" = "frame") {
  const frame = screen.getByTestId("preview-frame") as HTMLIFrameElement;
  const source = from === "frame" ? frame.contentWindow : window;
  window.dispatchEvent(new MessageEvent("message", { source: source as unknown as MessageEventSource, data }));
}

function selectFromPreview(path: string, tag: string, from: "frame" | "outside" = "frame") {
  emit({ wf: true, type: "wf:select", detalle: { path, tag, descriptor: tag, text: "Hola", classes: [], attributes: [] } }, from);
}

function editorValue() {
  return (screen.getByTestId("code-editor") as HTMLTextAreaElement).value;
}

const previewDoc = () => (screen.getByTestId("preview-frame") as HTMLIFrameElement).getAttribute("srcdoc") ?? "";

/** Empieza el arrastre de un botón de la paleta, como lo haría el ratón sobre el Inspector. */
interface DatosArrastre {
  setData: ReturnType<typeof vi.fn>;
  setDragImage: () => void;
  effectAllowed: string;
}

function arrastrarBloque(label: string) {
  const boton = screen.getByRole("button", { name: label });
  const datos: DatosArrastre = { setData: vi.fn(), setDragImage: () => undefined, effectAllowed: "" };
  const event = new Event("dragstart", { bubbles: true, cancelable: true }) as Event & { dataTransfer: DatosArrastre };
  event.dataTransfer = datos;
  fireEvent(boton, event);
  return { boton, datos };
}

async function renderWorkspace(projectId: string, search = "", expected = PAGE) {
  render(
    <StoresProvider stores={stores}>
      <ProjectsProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/projects/${projectId}/editor${search}`]}>
            <Routes>
              <Route path="/projects/:id/editor" element={<EditorWorkspace />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </ProjectsProvider>
    </StoresProvider>
  );
  // Con quince archivos de prueba en paralelo el primer pintado pasa de un segundo:
  // el presupuesto extra quita el salto sin cambiar lo que se comprueba.
  await waitFor(() => expect(editorValue()).toBe(expected), { timeout: 8000 });
  await waitFor(() => expect(previewDoc()).toContain("<h1"), { timeout: 8000 });
}

function enableBuilder() {
  const group = screen.getByRole("group", { name: "Modo de trabajo" });
  fireEvent.click(within(group).getByRole("button", { name: "Constructor" }));
}

// El presupuesto de cada prueba lo da `testTimeout` de la configuración: con la suite completa
// en paralelo el primer pintado pasa de los 5 s por defecto. Los waitFor de abajo piden 8 s.
describe("EditorWorkspace", () => {
  let projectId = "";

  beforeEach(async () => {
    window.localStorage.clear();
    // Almacenes nuevos para cada prueba: la biblioteca tiene memoria propia y no debe heredar
    // los bloques que guardó la prueba anterior.
    stores = localStores();
    shared.value = "";
    shared.reveal = null;
    const project = await stores.projects.create(INPUT);
    projectId = project.id;
    await stores.files.write(projectId, "index.html", PAGE);
  });

  it("carga el explorador, el editor y la vista previa aislada", async () => {
    await renderWorkspace(projectId);

    const explorer = screen.getByLabelText("Explorador de archivos");
    expect(within(explorer).getByRole("button", { name: "index.html" })).toBeTruthy();
    expect(editorValue()).toBe(PAGE);

    const frame = screen.getByTestId("preview-frame") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame.getAttribute("srcdoc")).toContain("data-wf-path");
    expect(frame.getAttribute("srcdoc")).toContain("<h1");
  });

  it("escribir en el editor se autoguarda en el almacén", async () => {
    await renderWorkspace(projectId);
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: "<p>escrito a mano</p>" } });

    await waitFor(
      async () => expect((await stores.files.read(projectId, "index.html")).content).toBe("<p>escrito a mano</p>"),
      { timeout: 8000 }
    );
  });

  it("el modo ejecuciones abre el panel y cede el hueco del editor", async () => {
    await renderWorkspace(projectId);
    const group = screen.getByRole("group", { name: "Modo de trabajo" });
    fireEvent.click(within(group).getByRole("button", { name: "Ejecuciones" }));

    const historial = await screen.findByRole("list", { name: "Ejecuciones del proyecto" });
    expect(within(historial).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByTestId("code-editor")).toBeNull();
    // La siembra del stack estático aporta main.js: el panel lo ve porque recibe los archivos reales.
    const destino = (await screen.findByRole("combobox", { name: "Archivo a ejecutar" })) as HTMLSelectElement;
    expect(destino.value).toBe("main.js");
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() =>
      expect(screen.getByRole("log", { name: "Registro de la ejecución" }).textContent).toContain("$ node main.js")
    );
    // La vista previa no se mueve por cambiar de modo.
    expect(previewDoc()).toContain("<h1");
  });

  it("el constructor escribe HTML real en el archivo y en el editor", async () => {
    await renderWorkspace(projectId);
    enableBuilder();

    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
      expect(screen.getByText("<h1>")).toBeTruthy();
    });
    expect(shared.reveal).not.toBeNull();
    // Un clic en la vista previa no puede robarle el foco: cortaría la edición de texto en curso.
    expect(shared.reveal?.focus).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Botón" }));

    await waitFor(() => expect(editorValue()).toContain("class=\"boton\""));
    expect(shared.reveal?.focus).toBe(true);
    const saved = await stores.files.read(projectId, "index.html");
    expect(saved.content).toContain('<a class="boton"');
    expect(saved.content).toContain("<h1>Hola");
  });

  it("la paleta expone los bloques de estructura, contenido y medio", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
    });

    for (const label of [
      "Encabezado con menú",
      "Menú de navegación",
      "Portada",
      "Rejilla de 3",
      "Rejilla de 4",
      "Tabla",
      "Diálogo modal",
      "Enlace",
      "Icono SVG",
      "Vídeo"
    ]) {
      expect(screen.getByRole("button", { name: label }), `falta ${label} en la paleta`).toBeTruthy();
    }
  });

  it("insertar la rejilla la escribe dentro del main y la vista previa la pinta", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0", "main");
      expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rejilla de 3" }));

    await waitFor(() => expect(editorValue()).toContain('class="rejilla rejilla-3"'));
    const fuente = editorValue();
    expect(fuente.indexOf("rejilla-3")).toBeGreaterThan(fuente.indexOf("<main"));
    expect(fuente.indexOf("rejilla-3")).toBeLessThan(fuente.indexOf("</main>"));
    // La vista previa se refresca con retardo: hay que esperarla.
    await waitFor(() => expect(previewDoc()).toContain('class="rejilla rejilla-3"'), { timeout: 4000 });
    expect((await stores.files.read(projectId, "index.html")).content).toContain("rejilla-hueco");
  });

  it("cada bloque se coloca en el hueco que declara y el aviso lo dice", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByText(/Se insertará dentro de/)).toBeTruthy();
    });

    // «Separador» pide después: el aviso cambia y el `<hr>` cae justo tras el título.
    fireEvent.click(screen.getByRole("button", { name: "Separador" }));

    await waitFor(() => expect(editorValue()).toContain("<hr class=\"separador\""));
    expect(editorValue()).toMatch(/<\/h1>\s*<hr class="separador"/);
    expect(screen.getByText(/Se insertará después de/)).toBeTruthy();
  });

  it("arrastrar un bloque y soltarlo en la vista previa lo inserta en el hueco marcado", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    arrastrarBloque("Rejilla de 4");
    const escudo = screen.getByTestId("drag-shield");
    fireEvent.dragOver(escudo, { clientX: 40, clientY: 60 });
    // La vista previa contesta con la ruta y el hueco que hay bajo ese punto.
    emit({ wf: true, type: "wf:hit", path: "0.0.0.0", slot: "after" });
    fireEvent.drop(escudo, { clientX: 40, clientY: 60 });

    await waitFor(() => expect(editorValue()).toContain('class="rejilla rejilla-4"'), { timeout: 8000 });
    const fuente = editorValue();
    expect(fuente.indexOf("rejilla-4")).toBeGreaterThan(fuente.indexOf("</h1>"));
    expect(fuente.indexOf("rejilla-4")).toBeLessThan(fuente.indexOf("</main>"));
    expect((await stores.files.read(projectId, "index.html")).content).toContain("rejilla-4");
    expect(screen.getByText(/insertado en el hueco marcado/)).toBeTruthy();
  });

  it("sin respuesta de destino no se inventa ninguna inserción", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    arrastrarBloque("Rejilla de 4");
    const escudo = screen.getByTestId("drag-shield");
    const antes = editorValue();

    fireEvent.drop(escudo, { clientX: 40, clientY: 60 });

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect(editorValue()).toBe(antes);
    expect((await stores.files.read(projectId, "index.html")).content).toBe(antes);
  });

  it("el escudo solo existe mientras dura el arrastre", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    const { boton } = arrastrarBloque("Rejilla de 4");
    expect(screen.getByTestId("drag-shield")).toBeTruthy();
    fireEvent.dragEnd(boton);
    expect(screen.queryByTestId("drag-shield")).toBeNull();

    const antes = editorValue();
    emit({ wf: true, type: "wf:hit", path: "0.0.0.0", slot: "after" });
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(editorValue()).toBe(antes);
  });

  it("la paleta se puede arrastrar sin haber seleccionado ningún elemento", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    // El destino lo marca el puntero sobre la vista previa: no hace falta elegir un elemento antes.
    const { boton } = arrastrarBloque("Rejilla de 4");
    expect(boton.hasAttribute("disabled")).toBe(false);
    expect(boton.getAttribute("draggable")).toBe("true");
    expect(screen.getByTestId("drag-shield")).toBeTruthy();
  });

  it("pulsar un bloque sin selección avisa en lugar de insertar a ciegas", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    const antes = editorValue();
    fireEvent.click(screen.getByRole("button", { name: "Rejilla de 4" }));
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(screen.getByText(/Arrastra el bloque/).textContent).toContain("selecciona antes un elemento");
    expect(editorValue()).toBe(antes);
  });

  it("el arrastre no viaja como texto plano para que el editor no lo cuele en el fuente", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejilla de 4" })).toBeTruthy());

    // CodeMirror acepta el `text/plain` que caiga en su zona: si el bloque viajara así, soltarlo
    // sobre el editor escribiría «wf:rejilla-4» en mitad del HTML.
    const { datos } = arrastrarBloque("Rejilla de 4");
    expect(datos.setData).toHaveBeenCalledWith("application/x-webforge-component", "rejilla-4");
    expect(datos.setData.mock.calls.map(([tipo]) => tipo)).not.toContain("text/plain");
  });

  it("aplica el texto editado en el inspector al fuente", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByLabelText("Texto")).toBeTruthy();
    });

    // La selección del lienzo puede volver a pintar el inspector entre la consulta y el cambio;
    // se repite el cambio hasta que el botón quede habilitado, como haría una persona escribiendo.
    await waitFor(() => {
      fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Adiós" } });
      expect((screen.getByRole("button", { name: "Aplicar texto" }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar texto" }));

    // Con la suite completa en paralelo el vuelo del almacén tarda más del margen por defecto.
    await waitFor(() => expect(editorValue()).toContain(">Adiós</h1>"), { timeout: 15000 });
    expect((await stores.files.read(projectId, "index.html")).content).toContain(">Adiós</h1>");
  });

  it("un color del inspector escribe la clase en el HTML y la regla en la hoja", async () => {
    await stores.files.write(projectId, "styles.css", ":root {\n  --accent: #2563eb;\n}\n");
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("group", { name: "Estilos del elemento" })).toBeTruthy();
    });

    const bloque = screen.getByRole("group", { name: "Estilos del elemento" });
    fireEvent.change(within(bloque).getByLabelText("Color de texto"), { target: { value: "#b30000" } });
    fireEvent.click(within(bloque).getByRole("button", { name: "Aplicar estilos" }));

    // El HTML solo gana la clase y el color vive en la hoja: ambos archivos en un mismo paso.
    await waitFor(() => expect(editorValue()).toContain('class="wf-e1"'), { timeout: 8000 });
    expect((await stores.files.read(projectId, "styles.css")).content).toContain("color: #b30000");
    await waitFor(() => expect(previewDoc()).toContain("#b30000"), { timeout: 8000 });
    expect(screen.getByText(/Estilo aplicado en \.wf-e1/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(editorValue()).toBe(PAGE), { timeout: 8000 });
    expect((await stores.files.read(projectId, "styles.css")).content).toBe(":root {\n  --accent: #2563eb;\n}\n");
  });

  it("quitar los estilos del elemento borra la clase y su regla", async () => {
    await stores.files.write(projectId, "styles.css", ":root {\n  --accent: #2563eb;\n}\n");
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("group", { name: "Estilos del elemento" })).toBeTruthy();
    });

    const bloque = screen.getByRole("group", { name: "Estilos del elemento" });
    fireEvent.change(within(bloque).getByLabelText("Color de texto"), { target: { value: "#b30000" } });
    fireEvent.click(within(bloque).getByRole("button", { name: "Aplicar estilos" }));
    await waitFor(() => expect(editorValue()).toContain('class="wf-e1"'), { timeout: 8000 });

    fireEvent.click(within(bloque).getByRole("button", { name: "Quitar estilos" }));
    await waitFor(() => expect(editorValue()).not.toContain("wf-e1"), { timeout: 8000 });
    // La clase se va con sus declaraciones; el `<link>` de la hoja se queda, porque sigue existiendo.
    expect(editorValue()).not.toContain('class=""');
    const css = (await stores.files.read(projectId, "styles.css")).content;
    expect(css).not.toContain("wf-e1");
    expect(css).toContain("--accent: #2563eb");
  });

  it("las variables del tema se escriben en la hoja sin tocar el HTML", async () => {
    await stores.files.write(
      projectId,
      "styles.css",
      ':root {\n  --accent: #2563eb;\n}\n\n[data-theme="oscuro"] {\n  --accent: #60a5fa;\n}\n'
    );
    await renderWorkspace(projectId);
    enableBuilder();

    const tema = screen.getByRole("group", { name: "Variables del tema" });
    fireEvent.click(within(tema).getByRole("button", { name: "Oscuro" }));
    fireEvent.change(within(tema).getByLabelText("Acento"), { target: { value: "#f0abfc" } });
    fireEvent.click(within(tema).getByRole("button", { name: "Aplicar tema" }));

    await waitFor(
      async () => expect((await stores.files.read(projectId, "styles.css")).content.includes("#f0abfc")).toBe(true),
      { timeout: 8000 }
    );
    const css = (await stores.files.read(projectId, "styles.css")).content;
    // El bloque claro es otro bloque: no se toca.
    expect(css).toContain("--accent: #2563eb");
    expect(css).toContain('[data-theme="oscuro"] {\n  --accent: #f0abfc;\n}');
    // El HTML no gana clases: como mucho el enlace que hacía falta para que la hoja se cargue.
    expect(editorValue()).not.toContain("wf-e");
    expect(editorValue()).toContain('<link rel="stylesheet" href="styles.css" />');
  });

  it("un valor de estilo imposible de leer no se escribe", async () => {
    await stores.files.write(projectId, "styles.css", ":root {\n  --accent: #2563eb;\n}\n");
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("group", { name: "Estilos del elemento" })).toBeTruthy();
    });

    const bloque = screen.getByRole("group", { name: "Estilos del elemento" });
    fireEvent.change(within(bloque).getByLabelText("Color de texto"), { target: { value: "red;}body{display:none" } });
    fireEvent.click(within(bloque).getByRole("button", { name: "Aplicar estilos" }));

    await waitFor(() => expect(screen.getByText(/no puede contener/)).toBeTruthy(), { timeout: 8000 });
    expect(editorValue()).toBe(PAGE);
    expect((await stores.files.read(projectId, "styles.css")).content).toBe(":root {\n  --accent: #2563eb;\n}\n");
  });

  it("ignora mensajes que no vienen del iframe", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    selectFromPreview("0.0.0.0", "h1", "outside");

    await new Promise((done) => setTimeout(done, 150));
    expect(screen.getByText(/Ningún elemento seleccionado/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Duplicar/ })).toBeNull();
  });

  it("recoge los mensajes de consola de la vista previa", async () => {
    await renderWorkspace(projectId);

    emit({ wf: true, type: "wf:console", level: "error", message: "ReferenceError: x", origen: "app.js", linea: 3 });
    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("ReferenceError: x"));

    const consola = screen.getByRole("log");
    expect(consola.textContent).toContain("app.js:3");
    expect(consola.textContent).toContain("error");
  });

  it("crea archivos nuevos desde el explorador", async () => {
    await renderWorkspace(projectId);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo archivo" }));
    fireEvent.change(screen.getByLabelText("Ruta"), { target: { value: "src/app.js" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear archivo" }));

    await waitFor(() => expect(editorValue()).toBe(""));
    expect((await stores.files.read(projectId, "src/app.js")).content).toBe("");
  });

  it("abre el archivo que pide la URL", async () => {
    await stores.files.write(projectId, "styles.css", "body { color: crimson; }");
    await renderWorkspace(projectId, "?file=styles.css", "body { color: crimson; }");

    const explorer = screen.getByLabelText("Explorador de archivos");
    expect(within(explorer).getByRole("button", { name: "styles.css" })).toBeTruthy();
  });

  it("un archivo dentro de una carpeta se ve en el árbol al abrirlo desde la URL", async () => {
    await stores.files.write(projectId, "src/estilos.css", "body { color: crimson; }");
    await renderWorkspace(projectId, "?file=src%2Festilos.css", "body { color: crimson; }");

    const explorer = screen.getByLabelText("Explorador de archivos");
    // Las carpetas se abren en un efecto posterior al primer pintado: se espera a ver el archivo.
    const archivo = await within(explorer).findByRole("button", { name: "estilos.css" }, { timeout: 8000 });
    expect(archivo.getAttribute("aria-current")).toBe("page");
    expect(within(explorer).getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("una ruta inexistente en la URL no rompe el editor: abre el de siempre", async () => {
    await renderWorkspace(projectId, "?file=no-existe.css");
    expect(editorValue()).toBe(PAGE);
  });

  it("los botones de deshacer y rehacer siguen el histórico y escriben en el almacén", async () => {
    await renderWorkspace(projectId);
    const deshacer = screen.getByRole("button", { name: "Deshacer" });
    const rehacer = screen.getByRole("button", { name: "Rehacer" });
    expect(deshacer.hasAttribute("disabled")).toBe(true);
    expect(rehacer.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: "<p>a mano</p>" } });
    // La ráfaga de escritura se cierra medio segundo después de dejar de teclear: hasta entonces
    // no hay paso que deshacer.
    await waitFor(() => expect(deshacer.hasAttribute("disabled")).toBe(false), { timeout: 4000 });

    fireEvent.click(deshacer);
    await waitFor(() => expect(editorValue()).toBe(PAGE));
    expect((await stores.files.read(projectId, "index.html")).content).toBe(PAGE);

    fireEvent.click(rehacer);
    await waitFor(() => expect(editorValue()).toBe("<p>a mano</p>"));
    await waitFor(
      async () => expect((await stores.files.read(projectId, "index.html")).content).toBe("<p>a mano</p>"),
      { timeout: 8000 }
    );
  });

  it("Ctrl+Z deshace lo que hizo el constructor", async () => {
    await renderWorkspace(projectId);
    enableBuilder();
    await waitFor(() => {
      selectFromPreview("0.0.0.0", "h1");
      expect(screen.getByRole("button", { name: "Botón" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Botón" }));
    await waitFor(() => expect(editorValue()).toContain('class="boton"'));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(editorValue()).toBe(PAGE));
    expect((await stores.files.read(projectId, "index.html")).content).toBe(PAGE);
  });

  it("Ctrl+Mayús+Z rehace sin desmontar la selección", async () => {
    await renderWorkspace(projectId);
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: "<p>dos</p>" } });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(editorValue()).toBe(PAGE));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(editorValue()).toBe("<p>dos</p>"));
  });

  describe("biblioteca de bloques de la cuenta", () => {
    /** Abre el constructor con el `<h1>` seleccionado, que es lo que se puede guardar. */
    async function seleccionaTitulo() {
      await renderWorkspace(projectId);
      enableBuilder();
      await waitFor(() => {
        selectFromPreview("0.0.0.0", "h1");
        expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
      });
    }

    it("guarda la selección tal como está escrita en el fuente", async () => {
      await seleccionaTitulo();
      expect(screen.getByText("Tu biblioteca")).toBeTruthy();
      expect(screen.getByText(/Aún no has guardado/)).toBeTruthy();

      fireEvent.change(screen.getByLabelText("Nombre del bloque"), { target: { value: "Titular grande" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Titular grande" })).toBeTruthy());
      expect(screen.getByText(/«Titular grande» guardado/)).toBeTruthy();
      const [guardado] = await stores.components.list();
      expect(guardado?.html).toBe("<h1>Hola</h1>");
      expect(guardado?.name).toBe("Titular grande");
      // Guardar un bloque no toca el archivo del proyecto.
      expect(editorValue()).toBe(PAGE);
    });

    it("sin selección no hay nada que guardar y lo dice", async () => {
      await renderWorkspace(projectId);
      enableBuilder();
      await waitFor(() => expect(screen.getByText("Tu biblioteca")).toBeTruthy());
      expect(screen.getByText(/Selecciona un elemento/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Guardar bloque" })).toBeNull();
    });

    it("un bloque guardado se inserta al pulsarlo, sin romper el elemento de solo texto", async () => {
      await stores.components.create({ name: "Tarjeta propia", html: '<article class="card"><h3>Tarjeta</h3></article>' });
      await seleccionaTitulo();

      fireEvent.click(screen.getByRole("button", { name: "Tarjeta propia" }));

      await waitFor(() => expect(editorValue()).toContain('<article class="card">'));
      // El `<h1>` no admite un `<article>` dentro: el bloque cae a continuación, intacto.
      expect(editorValue()).toMatch(/<h1>Hola<\/h1>\s*<article class="card">/);
      expect((await stores.files.read(projectId, "index.html")).content).toContain("Tarjeta");
    });

    it("un bloque guardado se puede arrastrar hasta el hueco marcado", async () => {
      await stores.components.create({ name: "Tarjeta propia", html: '<article class="card"><h3>Tarjeta</h3></article>' });
      await renderWorkspace(projectId);
      enableBuilder();
      await waitFor(() => expect(screen.getByRole("button", { name: "Tarjeta propia" })).toBeTruthy());

      arrastrarBloque("Tarjeta propia");
      const escudo = screen.getByTestId("drag-shield");
      fireEvent.dragOver(escudo, { clientX: 40, clientY: 60 });
      emit({ wf: true, type: "wf:hit", path: "0.0.0", slot: "inside-end" });
      fireEvent.drop(escudo, { clientX: 40, clientY: 60 });

      await waitFor(() => expect(editorValue()).toContain('<article class="card">'), { timeout: 8000 });
      expect(editorValue()).toMatch(/<article class="card">[\s\S]*<\/main>/);
      expect(screen.getByText(/insertado en el hueco marcado/)).toBeTruthy();
    });

    it("quita un bloque de la biblioteca", async () => {
      await stores.components.create({ name: "Tarjeta propia", html: "<p>tarjeta</p>" });
      await renderWorkspace(projectId);
      enableBuilder();
      await waitFor(() => expect(screen.getByRole("button", { name: "Tarjeta propia" })).toBeTruthy());

      fireEvent.click(screen.getByRole("button", { name: "Quitar el bloque Tarjeta propia" }));

      await waitFor(() => expect(screen.queryByRole("button", { name: "Tarjeta propia" })).toBeNull());
      expect(await stores.components.list()).toHaveLength(0);
      expect(screen.getByText(/Aún no has guardado/)).toBeTruthy();
    });

    it("el rechazo del servidor se ve y no añade el bloque", async () => {
      stores = localStores({
        components: fakeComponents({
          create: async () => {
            throw new Error("Ya tienes un bloque llamado «Titular grande».");
          }
        })
      });
      await seleccionaTitulo();

      fireEvent.change(screen.getByLabelText("Nombre del bloque"), { target: { value: "Titular grande" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

      await waitFor(() => expect(screen.getByText(/Ya tienes un bloque llamado/)).toBeTruthy());
      expect(screen.queryByRole("button", { name: "Titular grande" })).toBeNull();
    });

    it("las marcas de la vista previa no viajan dentro del bloque reutilizado", async () => {
      await stores.components.create({ name: "Tarjeta propia", html: '<p data-wf-path="0.0.0.0">tarjeta</p>' });
      await seleccionaTitulo();

      fireEvent.click(screen.getByRole("button", { name: "Tarjeta propia" }));

      await waitFor(() => expect(editorValue()).toContain("tarjeta"));
      expect(editorValue()).toContain("<p>tarjeta</p>");
      expect(editorValue()).not.toContain("data-wf-path");
    });

    it("guarda también las reglas de sus clases de estilo", async () => {
      await stores.files.write(projectId, "index.html", CON_ESTILO);
      await stores.files.write(projectId, "styles.css", ".wf-e1 {\n  color: #b30000;\n}\n");
      await renderWorkspace(projectId, "", CON_ESTILO);
      enableBuilder();
      await waitFor(() => {
        selectFromPreview("0.0.0.0", "h1");
        expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
      });

      fireEvent.change(screen.getByLabelText("Nombre del bloque"), { target: { value: "Titular rojo" } });
      fireEvent.click(screen.getByRole("button", { name: "Guardar bloque" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Titular rojo" })).toBeTruthy());
      const [guardado] = await stores.components.list();
      expect(guardado?.html).toBe('<h1 class="wf-e1">Hola</h1>');
      expect(guardado?.reglas).toEqual([{ selector: ".wf-e1", cambios: { color: "#b30000" } }]);
    });

    it("insertar un bloque con estilos escribe la hoja en el mismo paso de histórico", async () => {
      await stores.components.create({
        name: "Titular rojo",
        html: '<h1 class="wf-e1">Hola</h1>',
        reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }]
      });
      await stores.files.write(projectId, "styles.css", ":root {\n  --accent: #2563eb;\n}\n");
      await seleccionaTitulo();

      fireEvent.click(screen.getByRole("button", { name: "Titular rojo" }));

      await waitFor(() => expect(editorValue()).toContain('<h1 class="wf-e1">Hola</h1>'), { timeout: 8000 });
      await waitFor(
        async () => expect((await stores.files.read(projectId, "styles.css")).content).toContain("color: #b30000"),
        { timeout: 8000 }
      );
      const css = (await stores.files.read(projectId, "styles.css")).content;
      expect(css).toContain(".wf-e1 {\n  color: #b30000;\n}");
      expect(css).toContain("--accent: #2563eb");
      // La hoja se escribe aunque el documento no la enlazara: sin `<link>` no se vería.
      expect(editorValue()).toContain('<link rel="stylesheet" href="styles.css" />');

      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      await waitFor(() => expect(editorValue()).toBe(PAGE), { timeout: 8000 });
      expect((await stores.files.read(projectId, "styles.css")).content).toBe(":root {\n  --accent: #2563eb;\n}\n");
    });

    it("reutilizar un bloque no reestiliza a un elemento que ya usa ese nombre", async () => {
      await stores.components.create({
        name: "Titular rojo",
        html: '<h1 class="wf-e1">Hola</h1>',
        reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }]
      });
      await stores.files.write(projectId, "index.html", CON_ESTILO);
      await stores.files.write(projectId, "styles.css", ".wf-e1 {\n  color: green;\n}\n");
      await renderWorkspace(projectId, "", CON_ESTILO);
      enableBuilder();
      await waitFor(() => expect(screen.getByRole("button", { name: "Titular rojo" })).toBeTruthy());
      await waitFor(() => {
        selectFromPreview("0.0.0.0", "h1");
        expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Titular rojo" }));

      await waitFor(() => expect(editorValue()).toContain('<h1 class="wf-e2">Hola</h1>'), { timeout: 8000 });
      const css = (await stores.files.read(projectId, "styles.css")).content;
      expect(css).toContain(".wf-e2 {\n  color: #b30000;\n}");
      // El verde del proyecto sigue siendo verde: el bloque no le pisa la clase.
      expect(css).toContain(".wf-e1 {\n  color: green;\n}");
      expect(editorValue()).toContain('<h1 class="wf-e1">Hola</h1>');
    });

    it("arrastrar un bloque con estilos también escribe la hoja", async () => {
      await stores.components.create({
        name: "Titular rojo",
        html: '<h1 class="wf-e1">Hola</h1>',
        reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }]
      });
      await stores.files.write(projectId, "styles.css", ":root {\n  --accent: #2563eb;\n}\n");
      await renderWorkspace(projectId);
      enableBuilder();
      await waitFor(() => expect(screen.getByRole("button", { name: "Titular rojo" })).toBeTruthy());

      arrastrarBloque("Titular rojo");
      const escudo = screen.getByTestId("drag-shield");
      fireEvent.dragOver(escudo, { clientX: 40, clientY: 60 });
      emit({ wf: true, type: "wf:hit", path: "0.0.0", slot: "inside-end" });
      fireEvent.drop(escudo, { clientX: 40, clientY: 60 });

      await waitFor(() => expect(editorValue()).toContain('<h1 class="wf-e1">Hola</h1>'), { timeout: 8000 });
      await waitFor(
        async () => expect((await stores.files.read(projectId, "styles.css")).content).toContain(".wf-e1 {"),
        { timeout: 8000 }
      );
      expect(screen.getByText(/«Titular rojo» insertado/)).toBeTruthy();
    });

    it("sin hoja de estilos avisa de que el bloque pierde sus estilos", async () => {
      await stores.components.create({
        name: "Titular rojo",
        html: '<h1 class="wf-e1">Hola</h1>',
        reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }]
      });
      await renderWorkspace(projectId);
      // La hoja se quita desde el explorador: sin archivo no hay donde escribir las reglas del bloque.
      fireEvent.click(screen.getByRole("button", { name: "Eliminar styles.css" }));
      fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Eliminar styles.css" })).toBeNull(), {
        timeout: 8000
      });

      enableBuilder();
      await waitFor(() => {
        selectFromPreview("0.0.0.0", "h1");
        expect(screen.getByRole("button", { name: /Duplicar/ })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole("button", { name: "Titular rojo" }));

      await waitFor(() => expect(editorValue()).toContain('<h1 class="wf-e1">Hola</h1>'), { timeout: 8000 });
      expect(screen.getByText(/sin sus estilos/)).toBeTruthy();
      expect((await stores.files.list(projectId)).map((file) => file.path)).not.toContain("styles.css");
    });
  });
});
