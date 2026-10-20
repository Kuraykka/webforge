import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../components/ui/Toast";
import { StoresProvider } from "../lib/stores";
import { override, localStores } from "../test/store-support";
import { ProjectsProvider } from "../features/projects/ProjectsContext";
import { fakeEnv, fakeVersions } from "../features/projects/test-support";
import type { EnvStore, EnvEnvironment } from "../features/projects/env";
import type { Project } from "../features/projects/types";
import type { ProjectStore } from "../features/projects/storage";
import { ProjectDetailPage } from "./ProjectDetailPage";

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

function renderPage(env: EnvStore = fakeEnv()) {
  const projects = override<ProjectStore>(localStores().projects, {
    list: async () => [TIENDA],
    history: async () => []
  });
  render(
    <StoresProvider stores={localStores({ versions: fakeVersions(), env })}>
      <ProjectsProvider store={projects}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/p1"]}>
            <Routes>
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </ProjectsProvider>
    </StoresProvider>
  );
}

async function abrirPestaña(nombre: RegExp) {
  await screen.findByRole("heading", { name: "Mi tienda" });
  fireEvent.click(screen.getByRole("tab", { name: nombre }));
}

describe("ProjectDetailPage · pestaña Entorno", () => {
  it("muestra las variables del proyecto al abrir la pestaña", async () => {
    renderPage();
    await abrirPestaña(/Entorno/);
    expect(await screen.findByText("Variables de entorno")).toBeTruthy();
    expect(await screen.findByText("API_KEY")).toBeTruthy();
    expect(document.body.textContent).not.toContain("sk-privada-123");
  });

  it("pide el entorno marcado cuando se cambia", async () => {
    const vistos: EnvEnvironment[] = [];
    const list = vi.fn<EnvStore["list"]>(async (_p, environment) => {
      vistos.push(environment);
      return [];
    });
    renderPage(fakeEnv({ list }));
    await abrirPestaña(/Entorno/);
    fireEvent.click(screen.getByRole("button", { name: "Producción" }));
    await waitFor(() => expect(vistos).toEqual(["desarrollo", "produccion"]));
  });

  it("las demás pestañas siguen funcionando", async () => {
    renderPage();
    await abrirPestaña(/Historial/);
    expect(await screen.findByText("Versiones")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Ajustes/ }));
    expect(await screen.findByText("Configuración del proyecto")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Entorno/ }));
    expect(await screen.findByText("Variables de entorno")).toBeTruthy();
  });
});
