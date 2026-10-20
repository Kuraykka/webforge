import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { StoresProvider } from "../lib/stores";
import { localStores } from "../test/store-support";
import { SessionProvider } from "../features/auth/SessionContext";
import { ThemeProvider } from "../features/theme/ThemeProvider";
import { fakeAuth, USER } from "../features/auth/test-support";
import { fakeSearch, SEARCH_FIXTURE } from "../features/search/test-support";
import type { SearchResults, SearchStore } from "../features/search/search";
import { TopBar } from "./TopBar";

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{`${pathname}${search}`}</p>;
}

const route = () => screen.getByTestId("ruta").textContent ?? "";

function renderBarra(store: SearchStore = fakeSearch(), auth = fakeAuth()) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <ThemeProvider>
        <StoresProvider stores={localStores({ search: store })}>
          <SessionProvider auth={auth}>
            <TopBar collapsed={false} onToggleCollapse={() => undefined} onOpenMobile={() => undefined} />
            <Where />
          </SessionProvider>
        </StoresProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const campo = () => screen.getByRole("combobox", { name: "Buscar proyectos y archivos" });

/** Abre la lista y espera a que exista. */
async function abrir() {
  // En el navegador un clic también enfoca: así es como la barra despliega la lista.
  fireEvent.focus(campo());
  fireEvent.click(campo());
  return screen.findByRole("listbox");
}

const escribir = (texto: string) => {
  fireEvent.change(campo(), { target: { value: texto } });
};

const VACIO: SearchResults = { term: "", projects: [], files: [] };

describe("TopBar", () => {
  it("muestra el proyecto y el archivo donde está el texto", async () => {
    const find = vi.fn<SearchStore["find"]>(async (term) => ({ ...SEARCH_FIXTURE, term }));
    renderBarra(fakeSearch({ find }));
    escribir("tienda");
    const lista = await screen.findByRole("listbox");
    expect(await within(lista).findByRole("option", { name: /^Mi tienda/ })).toBeTruthy();
    expect(within(lista).getByRole("option", { name: /^index\.html/ }).textContent).toContain("línea 2");
    expect(within(lista).getByRole("option", { name: /^index\.html/ }).textContent).toContain("mi tienda online");
    await waitFor(() => expect(find).toHaveBeenCalledWith("tienda"));
  });

  it("sin escribir ya ofrece acciones rápidas", async () => {
    renderBarra();
    const lista = await abrir();
    expect(within(lista).getByText("Nuevo proyecto")).toBeTruthy();
    expect(within(lista).getByText("Ir al panel")).toBeTruthy();
  });

  it("cada opción cuelga directamente de la lista", async () => {
    renderBarra();
    const lista = await abrir();
    const opcion = within(lista).getByRole("option", { name: /Ir a proyectos/ });
    expect(opcion.parentElement?.parentElement).toBe(lista);
  });

  it("lo escrito deja fuera las acciones que no encajan", async () => {
    renderBarra(fakeSearch({ find: async () => VACIO }));
    escribir("ajustes");
    const lista = await screen.findByRole("listbox");
    expect(await within(lista).findByRole("option", { name: /Abrir ajustes/ })).toBeTruthy();
    expect(within(lista).queryByText("Nuevo proyecto")).toBeNull();
  });

  it("un archivo abre el editor en su ruta y su línea", async () => {
    renderBarra();
    escribir("tienda");
    const opcion = await screen.findByRole("option", { name: /^index\.html/ });
    fireEvent.click(within(opcion).getByRole("button"));
    await waitFor(() => expect(route()).toBe("/projects/p1/editor?file=index.html"));
    expect(campo().getAttribute("value")).toBe("");
  });

  it("un proyecto abre su ficha", async () => {
    renderBarra();
    escribir("tienda");
    const opcion = await screen.findByRole("option", { name: /^Mi tienda/ });
    fireEvent.click(within(opcion).getByRole("button"));
    await waitFor(() => expect(route()).toBe("/projects/p1"));
  });

  it("el acceso de administración solo aparece para quien lo es", async () => {
    renderBarra(fakeSearch(), fakeAuth({ whoami: async () => ({ user: USER, sessions: [] }) }));
    const lista = await abrir();
    expect(within(lista).queryByText(/administración/i)).toBeNull();
  });

  it("con rol de administración la acción aparece y lleva al panel", async () => {
    renderBarra(fakeSearch(), fakeAuth({ whoami: async () => ({ user: { ...USER, role: "admin" }, sessions: [] }) }));
    const lista = await abrir();
    const opcion = await within(lista).findByRole("option", { name: /administración/i });
    fireEvent.click(within(opcion).getByRole("button"));
    await waitFor(() => expect(route()).toBe("/admin"));
  });

  it("el atajo Ctrl+K pone el foco en la barra", () => {
    renderBarra();
    expect(campo() === document.activeElement).toBe(false);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(campo() === document.activeElement).toBe(true);
  });

  it("Escape cierra la lista sin borrar lo escrito", async () => {
    renderBarra();
    escribir("tienda");
    await screen.findByRole("listbox");
    fireEvent.keyDown(campo(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(campo().getAttribute("value")).toBe("tienda");
  });

  it("las flechas mueven la opción activa y Enter la abre", async () => {
    renderBarra();
    await abrir();
    fireEvent.keyDown(campo(), { key: "ArrowDown" });
    expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true }).textContent).toContain(
      "Nuevo proyecto"
    );
    fireEvent.keyDown(campo(), { key: "ArrowDown" });
    expect(within(screen.getByRole("listbox")).getByRole("option", { selected: true }).textContent).toContain(
      "Ir a proyectos"
    );
    fireEvent.keyDown(campo(), { key: "Enter" });
    await waitFor(() => expect(route()).toBe("/projects"));
  });

  it("mientras busca lo dice y el aviso se quita al llegar", async () => {
    let soltar: (value: SearchResults) => void = () => undefined;
    const find = vi.fn<SearchStore["find"]>(
      () =>
        new Promise<SearchResults>((resolve) => {
          soltar = resolve;
        })
    );
    renderBarra(fakeSearch({ find }));
    escribir("tienda");
    expect(await screen.findByText(/Buscando/)).toBeTruthy();
    // La promesa solo existe cuando la barra decide preguntar: antes no hay a quién soltar.
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    act(() => soltar(SEARCH_FIXTURE));
    await screen.findByRole("option", { name: /^Mi tienda/ });
    expect(screen.queryByText(/Buscando/)).toBeNull();
  });

  it("un fallo del servidor se cuenta en la lista", async () => {
    const store = fakeSearch({
      find: async () => {
        throw new ApiError(500, "No se pudo conectar con el servidor.");
      }
    });
    renderBarra(store);
    escribir("tienda");
    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo conectar");
  });

  it("si nada encaja, lo dice", async () => {
    renderBarra(fakeSearch({ find: async (term) => ({ term, projects: [], files: [] }) }));
    escribir("kkkk");
    expect(await screen.findByText(/Sin coincidencias para/)).toBeTruthy();
  });

  it("cerrar sesión usa la API de verdad", async () => {
    const logout = vi.fn(async () => undefined);
    renderBarra(fakeSearch(), fakeAuth({ logout, whoami: async () => ({ user: USER, sessions: [] }) }));
    const lista = await abrir();
    const opcion = await within(lista).findByRole("option", { name: /Cerrar sesión/ });
    fireEvent.click(within(opcion).getByRole("button"));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("un término de un carácter no consulta nada", async () => {
    const find = vi.fn<SearchStore["find"]>(async (term) => ({ term, projects: [], files: [] }));
    renderBarra(fakeSearch({ find }));
    escribir("x");
    await new Promise((r) => setTimeout(r, 400));
    expect(find).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("un término vacío no consulta nada", async () => {
    const find = vi.fn<SearchStore["find"]>(async (term) => ({ term, projects: [], files: [] }));
    renderBarra(fakeSearch({ find }));
    await abrir();
    await new Promise((r) => setTimeout(r, 400));
    expect(find).not.toHaveBeenCalled();
  });

  it("un término muy largo se frena antes de salir", async () => {
    const find = vi.fn<SearchStore["find"]>(async (term) => ({ term, projects: [], files: [] }));
    renderBarra(fakeSearch({ find }));
    escribir(`x${"y".repeat(200)}`);
    expect((await screen.findByRole("alert")).textContent).toContain("120 caracteres");
    expect(find).not.toHaveBeenCalled();
  });
});
