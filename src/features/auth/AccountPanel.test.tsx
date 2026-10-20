import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { AccountPanel } from "./AccountPanel";
import { SessionProvider } from "./SessionContext";
import { fakeAuth, OTHER_SESSION, USER, CURRENT } from "./test-support";

async function renderPanel(auth = fakeAuth(), user = USER, sessions = [CURRENT]) {
  render(
    <SessionProvider auth={{ ...auth, whoami: async () => ({ user, sessions }) }}>
      <AccountPanel />
    </SessionProvider>
  );
  // El panel solo existe con sesión confirmada: el arranque pasa por el servidor.
  await waitFor(() => expect(screen.getByText("ana@dominio.dev").textContent).toBeTruthy());
}

const aviso = () => screen.queryByRole("alert")?.textContent ?? "";

function fillPasswords(current: string, next: string) {
  fireEvent.change(screen.getByLabelText("Contraseña actual"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: next } });
}

describe("AccountPanel", () => {
  it("ensena la cuenta y su rol", async () => {
    await renderPanel();
    expect(screen.getByText("ana@dominio.dev").textContent).toBeTruthy();
    expect(screen.getByText(/usuario/i).textContent).toBeTruthy();
  });

  it("un rol de administración se distingue", async () => {
    await renderPanel(fakeAuth(), { ...USER, role: "admin" });
    expect(screen.getByText(/administrador/i).textContent).toBeTruthy();
  });

  it("cambia la contraseña y dice cuántas sesiones ha cerrado", async () => {
    const changePassword = vi.fn(async () => ({ changed: true, revokedSessions: 2 }));
    await renderPanel(fakeAuth({ changePassword }));
    fillPasswords("S3creta-vieja", "S3creta-nueva");
    fireEvent.submit(screen.getByRole("form", { name: "Cambia tu contraseña" }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith("S3creta-vieja", "S3creta-nueva"));
    await waitFor(() => expect(screen.getByText(/2 sesiones/).textContent).toBeTruthy());
  });

  it("el rechazo del servidor se muestra tal cual", async () => {
    const changePassword = vi.fn(async () => {
      throw new ApiError(403, "La contraseña actual no es correcta.");
    });
    await renderPanel(fakeAuth({ changePassword }));
    fillPasswords("cual", "S3creta-nueva");
    fireEvent.submit(screen.getByRole("form", { name: "Cambia tu contraseña" }));
    await waitFor(() => expect(aviso()).toBe("La contraseña actual no es correcta."));
  });

  it("lista las sesiones abiertas y permite cerrar las ajenas", async () => {
    const revokeSession = vi.fn(async () => ({ revoked: OTHER_SESSION.id }));
    const sessions = vi.fn(async () => [CURRENT]);
    await renderPanel(fakeAuth({ revokeSession, sessions }), USER, [CURRENT, OTHER_SESSION]);

    expect(screen.getByText(OTHER_SESSION.userAgent).textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Cerrar sesión de ${OTHER_SESSION.userAgent}` }));
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith(OTHER_SESSION.id));
    await waitFor(() => expect(screen.queryByText(OTHER_SESSION.userAgent)).toBeNull());
  });

  it("la sesión en curso no se cierra desde la lista", async () => {
    await renderPanel();
    expect(screen.getByText(/esta sesión/i).textContent).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cerrar sesión/ })).toBeNull();
  });
});

describe("AccountPanel · verificación en dos pasos", () => {
  it("configura el TOTP, confirma el código y enseña los de recuperación una vez", async () => {
    const setupTwoFactor = vi.fn(async () => ({ secret: "GEZDGNBVGY3TQOJQ", otpauth: "otpauth://totp/WebForge:ana" }));
    const confirmTwoFactor = vi.fn(async () => ({ enabled: true, recoveryCodes: ["AAAAA-BBBBB", "CCCCC-DDDDD"] }));
    const twoFactor = vi.fn(async () =>
      confirmTwoFactor.mock.calls.length === 0
        ? { enabled: false, pending: false, recoveryCodes: 0 }
        : { enabled: true, pending: false, recoveryCodes: 2 }
    );
    await renderPanel(fakeAuth({ setupTwoFactor, confirmTwoFactor, twoFactor }));

    const configurar = await screen.findByRole("button", { name: "Configurar verificación en dos pasos" });
    await waitFor(() => expect((configurar as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(configurar);
    expect(await screen.findByText("GEZDGNBVGY3TQOJQ")).toBeTruthy();
    expect(screen.getByText(/otpauth:\/\/totp/).textContent).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Activar" }));
    await waitFor(() => expect(confirmTwoFactor).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText("AAAAA-BBBBB")).toBeTruthy();
    expect(screen.getByText("CCCCC-DDDDD").textContent).toBeTruthy();
  });

  it("desactivar exige contraseña y código y avisa al terminar", async () => {
    const disableTwoFactor = vi.fn(async () => undefined);
    const twoFactor = vi.fn(async () => ({ enabled: true, pending: false, recoveryCodes: 3 }));
    await renderPanel(fakeAuth({ disableTwoFactor, twoFactor }));

    fireEvent.change(await screen.findByLabelText("Contraseña para desactivar"), { target: { value: "S3creta" } });
    fireEvent.change(screen.getByLabelText("Código para desactivar"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Desactivar verificación en dos pasos" }));
    await waitFor(() => expect(disableTwoFactor).toHaveBeenCalledWith("S3creta", "123456"));
    expect(await screen.findByText(/desactivada\./)).toBeTruthy();
  });
});
