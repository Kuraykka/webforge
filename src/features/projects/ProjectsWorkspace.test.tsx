import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast";
import { createApiClient, type FetchLike } from "../../lib/api";
import { ApiProvider } from "../../lib/ApiContext";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { ProjectsProvider } from "./ProjectsContext";
import { ProjectsWorkspace } from "./ProjectsWorkspace";
import type { Project, ProjectHistoryEntry } from "./types";
import type { ProjectStore } from "./storage";

const TIENDA: Project = {
  id: "p1",
  name: "Mi tienda",
  description: "",
  folder: "Sin carpeta",
  tags: [],
  stack: "static",
  status: "borrador",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z"
};

const IMPORTADO: Project = { ...TIENDA, id: "p2", name: "Desde el ZIP" };

const ZIP = new TextEncoder().encode("PK\u0003\u0004contenido");

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function zipResponse(header: string | null = 'attachment; filename="mi-tienda.zip"'): Response {
  return new Response(ZIP, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      ...(header ? { "content-disposition": header } : {})
    }
  });
}

/** Almacén de proyectos reducido a lo que usa la lista: `list` permite contar los refresco. */
function storeInicial(list: ProjectStore["list"], proyectos: Project[]): ProjectStore {
  const primera = proyectos[0]!;
  return {
    list,
    get: async () => primera,
    create: async () => primera,
    rename: async () => primera,
    update: async () => primera,
    duplicate: async () => primera,
    remove: async () => undefined,
    history: async (): Promise<ProjectHistoryEntry[]> => []
  };
}

function renderWorkspace(fetchImpl: FetchLike, store: ProjectStore, entry = "/projects") {
  const direccion = { current: "" };
  function Sonda() {
    const location = useLocation();
    direccion.current = `${location.pathname}${location.search}`;
    return null;
  }
  render(
    <ApiProvider api={createApiClient(fetchImpl)}>
      <StoresProvider stores={localStores()}>
        <ProjectsProvider store={store}>
          <ToastProvider>
            <MemoryRouter initialEntries={[entry]}>
              <ProjectsWorkspace />
              <Sonda />
            </MemoryRouter>
          </ToastProvider>
        </ProjectsProvider>
      </StoresProvider>
    </ApiProvider>
  );
  return direccion;
}

function simularDescarga() {
  const descargas: string[] = [];
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => "blob:prueba"
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    descargas.push(this.download);
  });
  return descargas;
}

describe("ProjectsWorkspace con ZIP", () => {
  it("exporta el proyecto desde su menú y avisa del fichero guardado", async () => {
    const descargas = simularDescarga();
    const fetchImpl = vi.fn<FetchLike>(async () => zipResponse());
    const store = storeInicial(vi.fn<ProjectStore["list"]>(async () => [TIENDA]), [TIENDA]);
    renderWorkspace(fetchImpl, store);

    await screen.findByText("Mi tienda");
    fireEvent.click(screen.getByLabelText("Acciones para Mi tienda"));
    fireEvent.click(await screen.findByRole("button", { name: "Exportar ZIP" }));

    expect(await screen.findByText(/mi-tienda\.zip/)).toBeTruthy();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/projects/p1/export");
    expect(descargas).toEqual(["mi-tienda.zip"]);
  });

  it("importa un ZIP y vuelve a pedir la lista", async () => {
    const list = vi
      .fn<ProjectStore["list"]>()
      .mockResolvedValueOnce([TIENDA])
      .mockResolvedValue([TIENDA, IMPORTADO]);
    const fetchImpl = vi.fn<FetchLike>(async () => json({ project: IMPORTADO }, 201));
    renderWorkspace(fetchImpl, storeInicial(list, [TIENDA]));

    await screen.findByText("Mi tienda");
    fireEvent.change(screen.getByLabelText("Archivo ZIP"), {
      target: { files: [new File([ZIP], "mi-tienda.zip", { type: "application/zip" })] }
    });

    await waitFor(() =>
      expect(fetchImpl.mock.calls.some((call) => call[1]?.method === "POST")).toBe(true)
    );
    expect((await screen.findByText("Desde el ZIP")).textContent).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("un ZIP rechazado por el servidor se cuenta sin refrescar la lista", async () => {
    const list = vi.fn<ProjectStore["list"]>(async () => [TIENDA]);
    const fetchImpl = vi.fn<FetchLike>(async () =>
      json({ error: "El archivo recibido no es un ZIP." }, 400)
    );
    renderWorkspace(fetchImpl, storeInicial(list, [TIENDA]));

    await screen.findByText("Mi tienda");
    fireEvent.change(screen.getByLabelText("Archivo ZIP"), {
      target: { files: [new File(["nada"], "otra-cosa.zip")] }
    });

    expect(await screen.findByText(/no es un ZIP/)).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectsWorkspace con enlaces profundos", () => {
  it("abre el formulario de creación cuando la URL lo pide y se limpia después", async () => {
    const list = vi.fn<ProjectStore["list"]>(async () => [TIENDA]);
    const fetchImpl = vi.fn<FetchLike>(async () => json({}));
    const direccion = renderWorkspace(fetchImpl, storeInicial(list, [TIENDA]), "/projects?nuevo=1");

    await screen.findByRole("dialog", { name: "Nuevo proyecto" });
    await waitFor(() => expect(direccion.current).toBe("/projects"));
  });

  it("cerrar el formulario no vuelve a abrirlo", async () => {
    const list = vi.fn<ProjectStore["list"]>(async () => [TIENDA]);
    const fetchImpl = vi.fn<FetchLike>(async () => json({}));
    renderWorkspace(fetchImpl, storeInicial(list, [TIENDA]), "/projects?nuevo=1");

    await screen.findByRole("dialog", { name: "Nuevo proyecto" });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Nuevo proyecto" })).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Nuevo proyecto" })).toBeNull();
  });

  it("entrar sin el parámetro deja la lista tranquila", async () => {
    const list = vi.fn<ProjectStore["list"]>(async () => [TIENDA]);
    const fetchImpl = vi.fn<FetchLike>(async () => json({}));
    renderWorkspace(fetchImpl, storeInicial(list, [TIENDA]), "/projects");

    await screen.findByText("Mi tienda");
    expect(screen.queryByRole("dialog", { name: "Nuevo proyecto" })).toBeNull();
  });
});
