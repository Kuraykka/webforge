import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { StoresProvider } from "../lib/stores";
import { localStores, override } from "../test/store-support";
import { ProjectsProvider } from "../features/projects/ProjectsContext";
import type { ProjectStore } from "../features/projects/storage";
import type { NewProjectInput, Project } from "../features/projects/types";
import { PLANTILLAS } from "../../shared/plantillas";
import { PlantillasPage } from "./PlantillasPage";

const PROYECTO: Project = {
  id: "p1",
  name: "Panadería Norte",
  description: "",
  folder: "Plantillas",
  tags: ["negocio-local"],
  stack: "static",
  status: "borrador",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z"
};

function Donde() {
  const { pathname } = useLocation();
  return <p data-testid="ruta">{pathname}</p>;
}

function renderPagina(create: ProjectStore["create"]) {
  const projects = override<ProjectStore>(localStores().projects, {
    list: async () => [],
    create
  });
  render(
    <StoresProvider stores={localStores({ projects })}>
      <ProjectsProvider store={projects}>
        <MemoryRouter initialEntries={["/plantillas"]}>
          <Routes>
            <Route path="/plantillas" element={<PlantillasPage />} />
            <Route path="/projects/:id/editor" element={<p>Editor</p>} />
          </Routes>
          <Donde />
        </MemoryRouter>
      </ProjectsProvider>
    </StoresProvider>
  );
}

/** Elige una familia y escribe el nombre del proyecto que va a nacer de ella. */
async function elegir(nombre: string, proyecto: string) {
  fireEvent.click(screen.getByRole("button", { name: `Usar la plantilla ${nombre}` }));
  fireEvent.change(screen.getByLabelText("Nombre del proyecto *"), { target: { value: proyecto } });
}

describe("la pantalla de plantillas", () => {
  it("enseña las diez familias con lo que trae cada una", () => {
    renderPagina(async (input) => ({ ...PROYECTO, name: input.name }));
    for (const plantilla of PLANTILLAS) {
      expect(screen.getByRole("heading", { name: plantilla.nombre })).toBeTruthy();
      expect(screen.getByRole("button", { name: `Usar la plantilla ${plantilla.nombre}` })).toBeTruthy();
    }
    expect(screen.getAllByRole("article").length).toBe(PLANTILLAS.length);
  });

  it("el buscador deja solo las familias que encajan", () => {
    renderPagina(async (input) => ({ ...PROYECTO, name: input.name }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filtrar plantillas" }), { target: { value: "barrio" } });
    expect(screen.getAllByRole("article").length).toBe(1);
    expect(screen.getByRole("heading", { name: "Negocio de barrio" })).toBeTruthy();
  });

  it("crear desde una plantilla manda sus archivos reales y lleva al editor", async () => {
    const recibos: NewProjectInput[] = [];
    const ir = vi.fn();
    renderPagina(async (input) => {
      recibos.push(input);
      ir();
      return { ...PROYECTO, name: input.name };
    });

    await elegir("Negocio de barrio", "Panadería Norte");
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(recibos.length).toBe(1));
    const input = recibos[0]!;
    expect(input.name).toBe("Panadería Norte");
    expect(input.stack).toBe("static");
    expect(input.tags).toContain("negocio-local");
    expect(input.files?.["index.html"]).toContain("<!doctype html>");
    expect(input.files?.["index.html"]).toContain("LocalBusiness");
    expect(input.files?.["sitemap.xml"]).toContain("TU-DOMINIO.example");
    // La navegación ocurre justo después de crear: se espera el valor, no solo que el nodo exista.
    await waitFor(() => expect(screen.getByTestId("ruta").textContent).toBe("/projects/p1/editor"));
    expect(ir).toHaveBeenCalledTimes(1);
  });

  it("sin nombre no se crea nada y se pide escribirlo", async () => {
    const create = vi.fn(async (input: NewProjectInput) => ({ ...PROYECTO, name: input.name }));
    renderPagina(create);
    fireEvent.click(screen.getByRole("button", { name: "Usar la plantilla Landing de producto" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    expect((await screen.findByRole("alert")).textContent).toContain("nombre");
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("ruta").textContent).toBe("/plantillas");
  });

  it("un rechazo del servidor se lee en la pantalla y deja reintentar", async () => {
    const create = vi.fn(async () => {
      throw new Error("Has alcanzado el límite de proyectos por cuenta (1).");
    });
    renderPagina(create);
    await elegir("Blog con suscripción", "Cuaderno de recados");
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    expect((await screen.findByRole("alert")).textContent).toContain("límite de proyectos");
    expect(screen.getByTestId("ruta").textContent).toBe("/plantillas");
    expect((screen.getByRole("button", { name: "Crear proyecto" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("dice sin rodeos qué hay que cambiar antes de publicar", () => {
    renderPagina(async (input) => ({ ...PROYECTO, name: input.name }));
    const aviso = screen.getByText(/TU-DOMINIO\.example/);
    expect(aviso.textContent).toContain("por-rellenar");
  });
});
