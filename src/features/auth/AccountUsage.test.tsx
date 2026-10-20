import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { AccountUsage } from "./AccountUsage";
import { SessionProvider } from "./SessionContext";
import { fakeAuth, type UsageFixture } from "./test-support";

function renderUsage(usage: UsageFixture) {
  render(
    <SessionProvider auth={fakeAuth({ usage })}>
      <AccountUsage />
    </SessionProvider>
  );
}

const USO = { projects: 3, files: 9, bytes: 1200, maxProjectsPerUser: 25, maxBytesPerProject: 5242880 };

describe("AccountUsage", () => {
  it("enseña lo que ocupa la cuenta: proyectos, archivos y bytes", async () => {
    renderUsage(async () => USO);
    await waitFor(() => expect(screen.getByText("3 proyectos").textContent).toBeTruthy());
    expect(screen.getByText("9 archivos").textContent).toBeTruthy();
    expect(screen.getByText("1,2 KB").textContent).toBeTruthy();
  });

  it("la cuota la marca el servidor, no lo que ve el navegador", async () => {
    renderUsage(async () => USO);
    await waitFor(() => expect(screen.getByRole("progressbar").textContent).toBeTruthy());
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("3");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuemax")).toBe("25");
    expect(screen.getByText(/3 de 25 proyectos/).textContent).toBeTruthy();
    expect(screen.getByText(/5 MB por proyecto/).textContent).toBeTruthy();
  });

  it("el proyecto en solitario también se lee en singular", async () => {
    renderUsage(async () => ({ ...USO, projects: 1 }));
    await waitFor(() => expect(screen.getByText(/1 de 25 proyectos/).textContent).toBeTruthy());
  });

  it("un rechazo del servidor se muestra tal cual", async () => {
    renderUsage(async () => {
      throw new ApiError(401, "Inicia sesión para continuar.");
    });
    await waitFor(() => expect(screen.getByText("Inicia sesión para continuar.").textContent).toBeTruthy());
  });
});
