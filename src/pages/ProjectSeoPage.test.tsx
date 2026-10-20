import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../lib/api";
import { StoresProvider } from "../lib/stores";
import { ANALYSIS_FIXTURE, SEO_FIXTURE, fakeSeo } from "../features/projects/test-support";
import { localStores, override } from "../test/store-support";
import { ProjectsProvider } from "../features/projects/ProjectsContext";
import type { ProjectStore } from "../features/projects/storage";
import type { SeoStore } from "../features/projects/seo";
import type { Project } from "../features/projects/types";
import { ProjectSeoPage } from "./ProjectSeoPage";

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

function renderPage(seo: SeoStore = fakeSeo()) {
  const projects = override<ProjectStore>(localStores().projects, {
    list: async () => [TIENDA],
    history: async () => []
  });
  render(
    <StoresProvider stores={localStores({ seo })}>
      <ProjectsProvider store={projects}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/p1/seo"]}>
            <Routes>
              <Route path="/projects/:id/seo" element={<ProjectSeoPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </ProjectsProvider>
    </StoresProvider>
  );
}

const abrir = () => screen.findByDisplayValue("https://mitienda.dev");

describe("ProjectSeoPage", () => {
  it("enseña los ajustes guardados y avisa de que no es una medición de campo", async () => {
    renderPage();
    await abrir();
    expect((screen.getByLabelText("Descripción para buscadores") as HTMLTextAreaElement).value).toBe(
      "Bicicletas de barrio"
    );
    expect((screen.getByLabelText("Plantilla del título") as HTMLInputElement).value).toBe("%s · Mi tienda");
    expect((screen.getByLabelText("Tipo de Schema.org") as HTMLSelectElement).value).toBe("Store");
    expect(screen.getByText(/no es una medición de campo/i).textContent).toBeTruthy();
  });

  it("guardar envía el formulario y lo confirma", async () => {
    const save = vi.fn<SeoStore["save"]>(async (_id, patch) => ({
      ...SEO_FIXTURE,
      ...patch,
      updatedAt: "2026-03-09T10:00:00.000Z"
    }));
    renderPage(fakeSeo({ save }));
    await abrir();
    fireEvent.change(screen.getByLabelText("Descripción para buscadores"), { target: { value: "Bicis y taller" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("p1", expect.objectContaining({ description: "Bicis y taller" })));
    expect(await screen.findByText("Ajustes de SEO guardados.")).toBeTruthy();
  });

  it("un dominio sin https no llega al servidor", async () => {
    const save = vi.fn<SeoStore["save"]>();
    renderPage(fakeSeo({ save }));
    await abrir();
    fireEvent.change(screen.getByLabelText("Dominio del sitio"), { target: { value: "http://mitienda.dev" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/https/));
    expect(save).not.toHaveBeenCalled();
  });

  it("generar escribe los archivos y lo cuenta", async () => {
    const generate = vi.fn<SeoStore["generate"]>(async () => ({
      files: ["index.html", "sitemap.xml", "robots.txt"],
      pages: 1
    }));
    renderPage(fakeSeo({ generate }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: /Generar archivos SEO/ }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText(/Archivos escritos en 1 página/)).toBeTruthy();
  });

  it("el análisis enseña problemas y enlaces rotos", async () => {
    const analysis = async () => ({
      ...ANALYSIS_FIXTURE,
      problemas: [{ nivel: "error" as const, regla: "h1-falta", mensaje: "Falta un encabezado h1.", pagina: "index.html" }],
      enlacesRotos: [{ pagina: "index.html", href: "contacto.html" }],
      resumen: { ...ANALYSIS_FIXTURE.resumen, errores: 1, avisos: 0 }
    });
    renderPage(fakeSeo({ analysis }));
    expect(await screen.findByText(/Falta un encabezado h1\./)).toBeTruthy();
    expect(screen.getByText("contacto.html").textContent).toBe("contacto.html");
  });

  it("un rechazo del servidor se lee tal cual", async () => {
    const save = vi.fn<SeoStore["save"]>(async () => {
      throw new ApiError(400, "Para publicar el sitemap hace falta el dominio del sitio.");
    });
    renderPage(fakeSeo({ save }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Guardar ajustes" }));
    expect(await screen.findByText("Para publicar el sitemap hace falta el dominio del sitio.")).toBeTruthy();
  });
});
