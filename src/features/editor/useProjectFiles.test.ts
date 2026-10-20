import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageFileStore, type FileStore } from "../files/storage";
import type { Project } from "../projects/types";
import { useProjectFiles } from "./useProjectFiles";

const PROJECT: Project = {
  id: "p-1",
  name: "Mi web",
  description: "",
  folder: "mi-web",
  tags: [],
  stack: "static",
  status: "borrador",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const sleep = (ms: number) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));

function setup(project: Project | null = PROJECT, envoltura?: (base: FileStore) => FileStore) {
  const notify = vi.fn();
  const base = new LocalStorageFileStore();
  const store = envoltura ? envoltura(base) : base;
  const view = renderHook(() => useProjectFiles(project, store, notify));
  return { ...view, notify, store, base };
}

/** Almacén cuyo primer escrito se demora: deja un autoguardado en vuelo mientras entra otro. */
function conPrimerEscritoLento(base: FileStore, ms: number): FileStore {
  let quedan = 1;
  return {
    list: (projectId) => base.list(projectId),
    read: (projectId, path) => base.read(projectId, path),
    create: (projectId, path, content) => base.create(projectId, path, content),
    rename: (projectId, from, to) => base.rename(projectId, from, to),
    remove: (projectId, path) => base.remove(projectId, path),
    ensureSeeded: (projectId, stack, projectName) => base.ensureSeeded(projectId, stack, projectName),
    removeProject: (projectId) => base.removeProject(projectId),
    write: async (projectId, path, content) => {
      if (quedan-- > 0) await new Promise((done) => setTimeout(done, ms));
      return base.write(projectId, path, content);
    }
  };
}

describe("useProjectFiles", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("un autoguardado en vuelo no pisa lo que acaba de escribir el constructor", async () => {
    // El escrito del autoguardado va lento y sigue en vuelo cuando el constructor guarda el suyo.
    // Si llegan en otro orden, el almacén se queda con el texto viejo y la interfaz dice «guardado».
    const { result, base } = setup(PROJECT, (store) => conPrimerEscritoLento(store, 300));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.change("<p>autoguardado viejo</p>"));
    await sleep(1050);
    await act(async () => void (await result.current.applyChange("<p>hecho en el constructor</p>")));
    await sleep(400);

    expect((await base.read(PROJECT.id, "index.html")).content).toBe("<p>hecho en el constructor</p>");
    expect(result.current.saveState).toBe("saved");
  });

  it("siembra la plantilla y abre index.html", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summaries.map((file) => file.path)).toContain("index.html");
    expect(result.current.openPath).toBe("index.html");
    expect(result.current.content).toContain("<html");
    expect(result.current.saveState).toBe("saved");
  });

  it("no pisa los archivos ya existentes al sembrar", async () => {
    const store = new LocalStorageFileStore();
    await store.write(PROJECT.id, "index.html", "<p>mío</p>");
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.content).toBe("<p>mío</p>");
  });

  it("cambiar de archivo no finge «sin guardar» ni escribe el texto viejo en la ruta nueva", async () => {
    const { result, store } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createFile("about.html", "<p>acerca</p>");
    });
    expect(result.current.openPath).toBe("about.html");
    expect(result.current.content).toBe("<p>acerca</p>");
    expect(result.current.saveState).toBe("saved");

    act(() => result.current.change("<p>acerca editado</p>"));
    expect(result.current.saveState).toBe("dirty");

    await act(async () => {
      result.current.open("index.html");
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(result.current.openPath).toBe("index.html");
    expect(result.current.content).toContain("<html");
    // La pareja ruta/texto cambia de una vez: no hay render intermedio con el texto anterior.
    expect(result.current.saveState).toBe("saved");

    await sleep(1500);
    expect((await store.read(PROJECT.id, "about.html")).content).toBe("<p>acerca editado</p>");
    expect((await store.read(PROJECT.id, "index.html")).content).toContain("<html");
  });

  it("autoguarda un segundo después de escribir", async () => {
    const { result, store } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.change("<p>editado</p>"));
    expect(result.current.saveState).toBe("dirty");

    await sleep(1200);
    await waitFor(async () => expect((await store.read(PROJECT.id, "index.html")).content).toBe("<p>editado</p>"));
    expect(result.current.saveState).toBe("saved");
  });

  it("applyChange guarda de inmediato y no deja un segundo guardado pendiente", async () => {
    const { result, store } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => void (await result.current.applyChange("<p>visual</p>")));
    expect(result.current.content).toBe("<p>visual</p>");
    expect((await store.read(PROJECT.id, "index.html")).content).toBe("<p>visual</p>");

    await sleep(1200);
    expect(result.current.saveState).toBe("saved");
  });

  it("guarda el archivo pendiente antes de cambiar de archivo", async () => {
    const { result, store } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => void (await result.current.createFile("about.html", "<h1>about</h1>")));
    expect(result.current.openPath).toBe("about.html");

    act(() => result.current.change("<h1>about editado</h1>"));
    act(() => result.current.open("index.html"));
    await waitFor(() => expect(result.current.openPath).toBe("index.html"));

    expect(result.current.content).toContain("<html");
    expect((await store.read(PROJECT.id, "about.html")).content).toBe("<h1>about editado</h1>");
  });

  it("renombra y elimina actualizando el estado", async () => {
    const { result, store, notify } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => void (await result.current.renameFile("index.html", "pagina.html")));
    expect(result.current.openPath).toBe("pagina.html");
    expect(result.current.summaries.map((file) => file.path)).toContain("pagina.html");
    expect((await store.read(PROJECT.id, "pagina.html")).content).toContain("<html");

    await act(async () => void (await result.current.removeFile("pagina.html")));
    expect(result.current.openPath).toBeNull();
    expect(result.current.content).toBe("");
    expect(notify).toHaveBeenCalledWith("success", "Eliminado pagina.html.");
  });

  it("avisa cuando la ruta ya existe", async () => {
    const { result, notify } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => void (await result.current.createFile("index.html")));
    expect(notify).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.openPath).toBe("index.html");
  });

  it("escribe lo pendiente al desmontar", async () => {
    const { result, store, unmount } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.change("<p>sin guardar</p>"));
    await sleep(0);
    unmount();

    await waitFor(async () =>
      expect((await store.read(PROJECT.id, "index.html")).content).toBe("<p>sin guardar</p>")
    );
  });

  it("sin proyecto no carga nada", async () => {
    const { result } = setup(null);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summaries).toEqual([]);
    expect(result.current.openPath).toBeNull();
  });

  /**
   * El editor solo vuelve a sincronizar su documento cuando `revision` cambia. Si también
   * cambiara con lo escrito a mano, React devolvería un texto más viejo que el del editor,
   * el editor lo impondría, y el bucle se sostendría solo hasta reventar.
   */
  it("solo sube la revisión cuando el texto llega de fuera", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.revision).toBe("number");

    const alAbrir = result.current.revision;
    act(() => result.current.change("escrito a mano"));
    expect(result.current.revision).toBe(alAbrir);

    await act(async () => void (await result.current.applyChange("<p>desde el constructor</p>")));
    expect(result.current.revision).toBe(alAbrir + 1);

    await act(async () => {
      result.current.open("styles.css");
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(result.current.revision).toBe(alAbrir + 2);
  });
});

/**
 * El histórico es uno solo y vive aquí: lo que se escribe a mano, lo que inserta el
 * constructor y lo que cambian los estilos se deshacen por el mismo camino y se guarda
 * cada paso en el almacén en el momento de deshacerlo.
 */
describe("useProjectFiles · histórico", () => {
  let original = "";

  async function ready() {
    const view = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    original = view.result.current.content;
    return view;
  }

  const deshacer = async (view: { result: { current: { undo: () => Promise<boolean> } } }) =>
    act(async () => void (await view.result.current.undo()));

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("empieza sin nada que deshacer ni rehacer", async () => {
    const { result } = await ready();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("deshacer devuelve el texto anterior y lo escribe en el almacén", async () => {
    const { result, store } = await ready();

    act(() => result.current.change("<p>uno</p>"));
    await deshacer({ result });

    expect(result.current.content).toBe(original);
    expect((await store.read(PROJECT.id, "index.html")).content).toBe(original);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("rehacer recupera lo deshecho", async () => {
    const { result, store } = await ready();

    act(() => result.current.change("<p>uno</p>"));
    await deshacer({ result });
    await act(async () => void (await result.current.redo()));

    expect(result.current.content).toBe("<p>uno</p>");
    expect((await store.read(PROJECT.id, "index.html")).content).toBe("<p>uno</p>");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("una ráfaga de escritura cuenta como un solo paso", async () => {
    const { result } = await ready();

    act(() => result.current.change("<p>a</p>"));
    act(() => result.current.change("<p>ab</p>"));
    act(() => result.current.change("<p>abc</p>"));
    await deshacer({ result });

    expect(result.current.content).toBe(original);
    expect(result.current.canUndo).toBe(false);
  });

  it("lo escrito con un rato de por medio es un paso nuevo", async () => {
    const { result } = await ready();

    act(() => result.current.change("<p>A</p>"));
    await sleep(700);
    act(() => result.current.change("<p>AB</p>"));

    await deshacer({ result });
    expect(result.current.content).toBe("<p>A</p>");

    await deshacer({ result });
    expect(result.current.content).toBe(original);
  });

  it("cada acción del constructor es un paso independiente", async () => {
    const { result } = await ready();

    await act(async () => void (await result.current.applyChange("<p>v1</p>")));
    await act(async () => void (await result.current.applyChange("<p>v2</p>")));

    await deshacer({ result });
    expect(result.current.content).toBe("<p>v1</p>");

    await deshacer({ result });
    expect(result.current.content).toBe(original);

    await act(async () => {
      await result.current.redo();
      await result.current.redo();
    });
    expect(result.current.content).toBe("<p>v2</p>");
  });

  it("un paso puede tocar varios archivos y deshacerse entero", async () => {
    const { result, store } = await ready();
    const css = (await store.read(PROJECT.id, "styles.css")).content;

    await act(
      async () =>
        void (await result.current.applyEdits([
          { path: "index.html", content: "<p>con estilo</p>" },
          { path: "styles.css", content: `${css}\n.wf-p { color: red; }` }
        ]))
    );
    expect((await store.read(PROJECT.id, "styles.css")).content).toContain(".wf-p");

    await deshacer({ result });

    expect(result.current.content).toBe(original);
    expect((await store.read(PROJECT.id, "styles.css")).content).toBe(css);
  });

  it("escribir después de deshacer cierra el camino de rehacer", async () => {
    const { result } = await ready();

    act(() => result.current.change("<p>uno</p>"));
    await deshacer({ result });
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.change("<p>otro</p>"));
    await sleep(700);
    act(() => result.current.change("<p>otro mas</p>"));
    expect(result.current.canRedo).toBe(false);
  });

  it("dejar de teclear cierra el paso y ya se puede deshacer", async () => {
    const { result } = await ready();

    act(() => result.current.change("<p>a mano</p>"));
    expect(result.current.canUndo).toBe(false);

    await sleep(700);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await deshacer({ result });
    expect(result.current.content).toBe(original);
  });

  it("deshacer no deja un autoguardado pendiente que vuelva a escribir el texto deshecho", async () => {
    const { result, store } = await ready();

    act(() => result.current.change("<p>uno</p>"));
    await sleep(300);
    act(() => result.current.change("<p>uno dos</p>"));
    await deshacer({ result });
    await sleep(1300);

    expect(result.current.saveState).toBe("saved");
    expect((await store.read(PROJECT.id, "index.html")).content).toBe(original);
  });

  it("dos deshaceres pedidos sin esperar retroceden dos pasos distintos", async () => {
    const { result } = await ready();

    await act(async () => void (await result.current.applyChange("<p>uno</p>")));
    await act(async () => void (await result.current.applyChange("<p>dos</p>")));

    await act(async () => {
      const primero = result.current.undo();
      const segundo = result.current.undo();
      await Promise.all([primero, segundo]);
    });

    expect(result.current.content).toBe(original);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("el histórico se queda solo con los últimos pasos", async () => {
    const { result } = await ready();

    for (let i = 0; i < 125; i++) {
      await act(async () => void (await result.current.applyChange(`<p>${i}</p>`)));
    }
    expect(result.current.canUndo).toBe(true);

    for (let i = 0; i < 121; i++) {
      await act(async () => void (await result.current.undo()));
    }
    expect(result.current.content).toBe("<p>4</p>");
    expect(result.current.canUndo).toBe(false);
  });

  it("deshacer alcanza el archivo ya cerrado sin tocar el abierto", async () => {
    const { result, store } = await ready();

    act(() => result.current.change("<p>uno</p>"));
    await act(async () => {
      result.current.open("styles.css");
      await new Promise((done) => setTimeout(done, 50));
    });
    const css = result.current.content;

    await deshacer({ result });

    expect(result.current.openPath).toBe("styles.css");
    expect(result.current.content).toBe(css);
    expect((await store.read(PROJECT.id, "index.html")).content).toBe(original);
  });
});
