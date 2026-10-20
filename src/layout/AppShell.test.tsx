import { render, screen } from "@testing-library/react";
import { lazy, type ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SessionProvider } from "../features/auth/SessionContext";
import { fakeAuth } from "../features/auth/test-support";
import { ThemeProvider } from "../features/theme/ThemeProvider";
import { StoresProvider } from "../lib/stores";
import { localStores } from "../test/store-support";
import { AppShell } from "./AppShell";

/** Un módulo que tarda: así se ve si el shell deja la pantalla en blanco mientras llega. */
const Lento = lazy(
  () =>
    new Promise<{ default: () => ReactElement }>((resolve) => {
      setTimeout(() => resolve({ default: () => <h1>Módulo pesado</h1> }), 30);
    })
);

function renderShell() {
  render(
    <MemoryRouter initialEntries={["/pesado"]}>
      <ThemeProvider>
        <StoresProvider stores={localStores()}>
          <SessionProvider auth={fakeAuth()}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="pesado" element={<Lento />} />
              </Route>
            </Routes>
          </SessionProvider>
        </StoresProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  it("avisa mientras el módulo de la pantalla está llegando", async () => {
    renderShell();
    expect(screen.getByText("Llegando la pantalla…")).toBeTruthy();
    expect(screen.queryByText("Módulo pesado")).toBeNull();
    await screen.findByText("Módulo pesado");
  });
});
