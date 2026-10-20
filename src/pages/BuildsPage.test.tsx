import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { StoresProvider } from "../lib/stores";
import { localStores } from "../test/store-support";
import { JAULA_FIXTURE, fakeRuns } from "../features/projects/test-support";
import type { CuentaRun, EstadoDeJaula, RunStore } from "../features/projects/runs";
import { BuildsPage } from "./BuildsPage";

const SIN_RED = /sin red/i;

function renderPage(runs: RunStore) {
  render(
    <StoresProvider stores={localStores({ runs })}>
      <MemoryRouter initialEntries={["/builds"]}>
        <BuildsPage />
      </MemoryRouter>
    </StoresProvider>
  );
}

const texto = () => document.body.textContent ?? "";

describe("BuildsPage · aislamiento", () => {
  it("cuenta los topes del servidor tal como los declara", async () => {
    renderPage(fakeRuns());
    await screen.findByRole("heading", { name: "Aislamiento del servidor" });
    expect(await screen.findByText("Disponible")).toBeTruthy();
    expect(texto()).toContain("bwrap");
    expect(texto()).toMatch(SIN_RED);
    expect(texto()).toContain("2 MB");
    expect(texto()).toContain("64 KB");
  });

  it("lo que la plataforma no hace está dicho, no callado", async () => {
    renderPage(fakeRuns());
    await screen.findByRole("heading", { name: "Aislamiento del servidor" });
    expect(texto()).toMatch(/dependencias/);
    expect(texto()).toMatch(/terminal/i);
  });

  it("un servidor sin jaula lo deja claro", async () => {
    const estado = vi.fn<RunStore["estado"]>(async () => ({
      ...JAULA_FIXTURE,
      disponible: false
    }) satisfies EstadoDeJaula);
    renderPage(fakeRuns({ estado }));
    expect(await screen.findByText(/No hay aislamiento/)).toBeTruthy();
    expect(texto()).toMatch(/no se puede ejecutar/);
  });
});

describe("BuildsPage · ejecuciones de la cuenta", () => {
  it("lista las de todos los proyectos y enlaza cada una a su editor", async () => {
    renderPage(fakeRuns());
    const lista = await screen.findByRole("list", { name: "Ejecuciones de la cuenta" });
    expect(lista.textContent).toContain("index.js");
    const enlaces = screen.getAllByRole("link");
    expect(enlaces.map((link) => link.getAttribute("href"))).toContain("/projects/p1/editor");
    expect(enlaces.map((link) => link.textContent)).toContain("Blog");
  });

  it("el registro se pide al servidor al pulsar su botón", async () => {
    const log = vi.fn<RunStore["log"]>(async () => "$ node index.js\nhola desde la jaula");
    renderPage(fakeRuns({ log }));
    await screen.findByRole("list", { name: "Ejecuciones de la cuenta" });
    fireEvent.click(screen.getAllByRole("button", { name: "Registro" })[0]!);
    const registro = await screen.findByRole("log", { name: "Registro de la ejecución" });
    expect(registro.textContent).toContain("hola desde la jaula");
    expect(log).toHaveBeenCalledWith("p1", expect.any(String));
  });

  it("un proyecto sin ejecuciones se dice en vez de fingir la lista", async () => {
    renderPage(fakeRuns({ listAll: async (): Promise<CuentaRun[]> => [] }));
    expect(await screen.findByText(/Todavía no hay ejecuciones/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Ejecuciones de la cuenta" })).toBeNull();
  });

  it("un fallo al consultar se muestra en pantalla", async () => {
    renderPage(
      fakeRuns({
        listAll: async () => {
          throw new Error("El servidor no respondió.");
        }
      })
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("El servidor no respondió.");
  });

  it("el botón de actualizar vuelve a preguntar", async () => {
    const listAll = vi.fn<RunStore["listAll"]>(async () => []);
    renderPage(fakeRuns({ listAll }));
    await screen.findByText(/Todavía no hay ejecuciones/);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar las ejecuciones" }));
    await vi.waitFor(() => expect(listAll).toHaveBeenCalledTimes(2));
  });
});
