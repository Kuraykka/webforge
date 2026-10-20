import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalStorageFileStore, type FileStore } from "../files/storage";
import { StoresProvider } from "../../lib/stores";
import { LocalStorageProjectStore } from "./storage";
import { readImportMarker, writeImportMarker, type ImportMarker, type StorePair } from "./importLocal";
import { ImportBanner } from "./ImportBanner";
import { localStores, MemoryStorage, override } from "../../test/store-support";
import type { NewProjectInput } from "./types";

const INPUT: NewProjectInput = { name: "Tienda", description: "", folder: "", tags: [], stack: "static" };

/** El navegador del usuario: aquí vive lo que se creó antes de la base de datos. */
async function seedBrowser(files: Record<string, string>, input = INPUT) {
  const project = await new LocalStorageProjectStore().create(input);
  const store = new LocalStorageFileStore();
  for (const [path, content] of Object.entries(files)) await store.write(project.id, path, content);
  return project;
}

function account(): StorePair {
  return { projects: new LocalStorageProjectStore(new MemoryStorage()), files: new LocalStorageFileStore(new MemoryStorage()) };
}

function renderBanner(target: StorePair, marker?: ImportMarker, onImported?: () => Promise<void>) {
  if (marker) writeImportMarker(marker, window.localStorage);
  render(
    <StoresProvider stores={localStores()}>
      <ImportBanner target={target} onImported={onImported} />
    </StoresProvider>
  );
}

describe("ImportBanner", () => {
  it("ofrece los proyectos que el navegador guardaba antes", async () => {
    await seedBrowser({ "index.html": "<h1>Hola</h1>" });
    renderBanner(account());
    await waitFor(() => expect(screen.getByText(/1 proyecto guardado en este navegador/).textContent).toBeTruthy());
    expect(screen.getByRole("button", { name: "Importar a mi cuenta" }).textContent).toBeTruthy();
  });

  it("sin datos del navegador no aparece nada", async () => {
    renderBanner(account());
    await waitFor(() => expect(screen.queryByText(/guardado en este navegador/)).toBeNull());
  });

  it("un marcador previo cierra la oferta", async () => {
    await seedBrowser({ "index.html": "<h1>Hola</h1>" });
    renderBanner(account(), { doneAt: new Date().toISOString(), projects: 4, files: 9, skipped: [], failed: [] });
    await waitFor(() => expect(screen.queryByText(/guardado en este navegador/)).toBeNull());
    expect(screen.queryByRole("button", { name: "Importar a mi cuenta" })).toBeNull();
  });

  it("importa los archivos, deja el marcador puesto y avisa al panel", async () => {
    const local = await seedBrowser({ "index.html": "<h1>Hola</h1>", "styles.css": "a{}" });
    const target = account();
    const onImported = vi.fn(async () => undefined);
    renderBanner(target, undefined, onImported);

    fireEvent.click(await screen.findByRole("button", { name: "Importar a mi cuenta" }));
    await waitFor(() => expect(screen.getByText(/Importados 1 proyecto y 2 archivos/).textContent).toBeTruthy());

    const imported = await target.projects.list();
    expect(imported).toHaveLength(1);
    expect((await target.files.read(imported[0]!.id, "index.html")).content).toBe("<h1>Hola</h1>");
    // El origen sigue intacto hasta que el usuario compruebe la copia.
    expect((await new LocalStorageFileStore().read(local.id, "index.html")).content).toBe("<h1>Hola</h1>");
    expect(readImportMarker(window.localStorage)?.projects).toBe(1);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("los nombres que ya están en la cuenta se anuncian como omitidos", async () => {
    await seedBrowser({ "index.html": "<h1>Hola</h1>" });
    const target = account();
    await target.projects.create(INPUT);
    renderBanner(target);

    fireEvent.click(await screen.findByRole("button", { name: "Importar a mi cuenta" }));
    await waitFor(() => expect(screen.getByText(/1 omitido/i).textContent).toBeTruthy());
    expect(await target.projects.list()).toHaveLength(1);
  });

  it("descartar la oferta la cierra sin tocar los datos", async () => {
    const local = await seedBrowser({ "index.html": "<h1>Hola</h1>" });
    const target = account();
    renderBanner(target);

    fireEvent.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(screen.queryByText(/guardado en este navegador/)).toBeNull());
    expect(readImportMarker(window.localStorage)?.projects).toBe(0);
    expect(await target.projects.list()).toHaveLength(0);
    expect((await new LocalStorageFileStore().list(local.id)).map((f) => f.path)).toEqual(["index.html"]);
  });

  it("un fallo del servidor se muestra con su aviso y permite reintentar", async () => {
    await seedBrowser({ "index.html": "<h1>Hola</h1>" });
    const target = account();
    const rejected: StorePair = {
      projects: target.projects,
      files: override<FileStore>(target.files, {
        write: async (_projectId, path) => {
          throw new Error(`«${path}» supera el límite de 512 KB por archivo.`);
        }
      })
    };
    renderBanner(rejected);

    fireEvent.click(await screen.findByRole("button", { name: "Importar a mi cuenta" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("supera el límite"));
    // Sin marcador el aviso vuelve en el próximo arranque: la importación no ha terminado.
    expect(readImportMarker(window.localStorage)).toBeNull();
  });
});
