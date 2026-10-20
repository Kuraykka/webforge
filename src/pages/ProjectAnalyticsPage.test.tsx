import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import { ApiError } from "../lib/api";
import { StoresProvider } from "../lib/stores";
import { ANALYTICS_FIXTURE, fakeAnalytics } from "../features/projects/test-support";
import { localStores, override } from "../test/store-support";
import { ProjectsProvider } from "../features/projects/ProjectsContext";
import type { ProjectStore } from "../features/projects/storage";
import type { AnalyticsStore } from "../features/projects/analytics";
import type { Project } from "../features/projects/types";
import { ProjectAnalyticsPage } from "./ProjectAnalyticsPage";

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

const ACTIVA = {
  ...ANALYTICS_FIXTURE,
  enabled: true,
  measurementId: "G-ABC123XYZ",
  updatedAt: "2026-03-09T10:00:00.000Z"
};

function renderPage(store: AnalyticsStore = fakeAnalytics()) {
  const projects = override<ProjectStore>(localStores().projects, {
    list: async () => [TIENDA],
    history: async () => []
  });
  render(
    <StoresProvider stores={localStores({ analytics: store })}>
      <ProjectsProvider store={projects}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/p1/analitica"]}>
            <Routes>
              <Route path="/projects/:id/analitica" element={<ProjectAnalyticsPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </ProjectsProvider>
    </StoresProvider>
  );
}

const abrir = () => screen.findByLabelText("Identificador de medición");

describe("ProjectAnalyticsPage", () => {
  it("enseña la configuración y el consentimiento previo", async () => {
    renderPage(fakeAnalytics({ read: async () => ACTIVA }));
    await abrir();
    expect((screen.getByLabelText("Identificador de medición") as HTMLInputElement).value).toBe("G-ABC123XYZ");
    expect((screen.getByLabelText("Activar analítica GA4") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Hasta que el visitante acepta no se pide nada a Google/i).textContent).toBeTruthy();
    expect(screen.getByText(/no hay credenciales de la API de datos/i).textContent).toBeTruthy();
  });

  it("guardar manda la configuración y la confirma", async () => {
    const save = vi.fn<AnalyticsStore["save"]>(async (_id, patch) => ({ ...ACTIVA, ...patch }));
    renderPage(fakeAnalytics({ save }));
    await abrir();
    fireEvent.click(screen.getByLabelText("Activar analítica GA4"));
    fireEvent.change(screen.getByLabelText("Identificador de medición"), { target: { value: "g-abc123xyz" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("p1", expect.objectContaining({ enabled: true, measurementId: "g-abc123xyz" }))
    );
    expect(await screen.findByText("Configuración de analítica guardada.")).toBeTruthy();
  });

  it("un identificador que no es de GA4 no llega al servidor", async () => {
    const save = vi.fn<AnalyticsStore["save"]>();
    renderPage(fakeAnalytics({ save }));
    await abrir();
    fireEvent.change(screen.getByLabelText("Identificador de medición"), { target: { value: "UA-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/G-/));
    expect(save).not.toHaveBeenCalled();
  });

  it("generar escribe el cargador y lo cuenta", async () => {
    const generate = vi.fn<AnalyticsStore["generate"]>(async () => ({
      files: ["analytics.js", "index.html"],
      pages: 1,
      enabled: true
    }));
    renderPage(fakeAnalytics({ read: async () => ACTIVA, generate }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Generar analytics.js" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith("p1"));
    expect(await screen.findByText(/Escrito en 1 página/)).toBeTruthy();
    expect(screen.getByText("analytics.js, index.html").textContent).toBeTruthy();
  });

  it("un rechazo del servidor se lee tal cual", async () => {
    const save = vi.fn<AnalyticsStore["save"]>(async () => {
      throw new ApiError(400, "Para activar la analítica hace falta el identificador de medición de GA4.");
    });
    renderPage(fakeAnalytics({ save }));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    expect(
      await screen.findByText("Para activar la analítica hace falta el identificador de medición de GA4.")
    ).toBeTruthy();
  });
});
