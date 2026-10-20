import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ToastProvider } from "../../components/ui/Toast";
import { AdminProvider } from "./AdminContext";
import { AdminPage } from "./AdminPage";
import { ACCOUNTS, fakeAdmin, SETTINGS } from "./test-support";
import type { AdminApi } from "./api";

function renderAdmin(admin = fakeAdmin()) {
  render(
    <ToastProvider>
      <AdminProvider api={admin}>
        <AdminPage />
      </AdminProvider>
    </ToastProvider>
  );
  return admin;
}

function textoDe(label: string): string {
  return screen.getByText(label).closest("div")?.textContent ?? "(sin bloque)";
}

/** El correo de una cuenta también aparece en la actividad, así que la tabla se consulta aparte. */
function cuentas() {
  return within(screen.getByRole("table", { name: /Cuentas registradas/ }));
}

describe("AdminPage", () => {
  it("muestra las métricas y el estado que devuelve el servidor", async () => {
    renderAdmin();
    await waitFor(() => expect(cuentas().getByText("root@dominio.dev").textContent).toBeTruthy());
    expect(textoDe("Cuentas")).toContain("2");
    expect(textoDe("Archivos")).toContain("117,2 KB");
    expect(textoDe("Sesiones abiertas")).toContain("4");
    // Correo y hosting no tienen proveedor: los dos lo dicen, no se finge ninguno.
    expect(screen.getAllByText(/sin proveedor/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1 proyecto con GA4").textContent).toBeTruthy();
    expect(screen.getByText("/tmp/webforge.sqlite").textContent).toBeTruthy();
  });

  it("mientras lee no enseña cifras inventadas", async () => {
    const colgada: AdminApi = {
      ...fakeAdmin(),
      metrics: () => new Promise(() => undefined),
      services: () => new Promise(() => undefined),
      users: () => new Promise(() => undefined),
      activity: () => new Promise(() => undefined),
      settings: () => new Promise(() => undefined)
    };
    renderAdmin(colgada);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("luis@dominio.dev")).toBeNull();
  });

  it("un 403 se enseña como lo que es: sin acceso, sin tabla de cuentas", async () => {
    const sinPermiso = fakeAdmin({
      metrics: async () => {
        throw new ApiError(403, "Hace falta un rol de administración.");
      },
      services: async () => {
        throw new ApiError(403, "Hace falta un rol de administración.");
      },
      users: async () => {
        throw new ApiError(403, "Hace falta un rol de administración.");
      },
      activity: async () => {
        throw new ApiError(403, "Hace falta un rol de administración.");
      },
      settings: async () => {
        throw new ApiError(403, "Hace falta un rol de administración.");
      }
    });
    renderAdmin(sinPermiso);
    await waitFor(() => expect(screen.getByText(/Hace falta un rol de administraci/).textContent).toBeTruthy());
    expect(screen.queryByText("luis@dominio.dev")).toBeNull();
  });

  it("cada cuenta lista lo que ocupa: proyectos, archivos y bytes", async () => {
    renderAdmin();
    await waitFor(() => expect(cuentas().getByText("luis@dominio.dev").textContent).toBeTruthy());
    const uso = cuentas().getByText("luis@dominio.dev").closest("tr");
    expect(uso?.textContent).toMatch(/2 proyectos/);
    expect(uso?.textContent).toMatch(/12 archivos/);
    expect(uso?.textContent).toMatch(/117,2 KB/);
  });

  it("cambiar el rol llama a la API de esa cuenta y vuelve a leer la lista", async () => {
    const admin = fakeAdmin();
    const setRole = vi.fn(admin.setRole);
    const users = vi.fn(admin.users);
    renderAdmin({ ...admin, setRole, users });
    await waitFor(() => expect(screen.getByText("luis@dominio.dev").textContent).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Rol de luis@dominio.dev"), { target: { value: "admin" } });
    await waitFor(() => expect(setRole).toHaveBeenCalledWith("u2", "admin"));
    await waitFor(() => expect(users.mock.calls.length).toBe(2));
  });

  it("una respuesta del servidor al cambiar el rol se lee en la página", async () => {
    const admin = fakeAdmin({
      setRole: async () => {
        throw new ApiError(409, "Debe quedar al menos un administrador en la plataforma.");
      }
    });
    renderAdmin(admin);
    await waitFor(() => expect(cuentas().getByText("root@dominio.dev").textContent).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Rol de root@dominio.dev"), { target: { value: "user" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/al menos un administrador/i));
  });

  it("suspender pasa por su confirmación y cierra las sesiones del servidor", async () => {
    const admin = fakeAdmin();
    const setStatus = vi.fn(admin.setStatus);
    renderAdmin({ ...admin, setStatus });
    await waitFor(() => expect(screen.getByText("luis@dominio.dev").textContent).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Suspender luis@dominio.dev" }));
    const dialogo = screen.getByRole("dialog", { name: /Suspender la cuenta luis@dominio\.dev/ });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Suspender cuenta" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith("u2", "suspendida"));
  });

  it("una cuenta bloqueada se señala y se desbloquea desde el panel", async () => {
    const bloqueada = { ...ACCOUNTS[1]!, lockedUntil: "2026-03-09T10:00:00.000Z", failedAttempts: 3 };
    const unblock = vi.fn(async () => ({ ...bloqueada, lockedUntil: null, failedAttempts: 0 }));
    renderAdmin(fakeAdmin({ users: async () => [bloqueada], unblock }));
    await waitFor(() => expect(cuentas().getByText(/bloqueada 24 horas/i).textContent).toBeTruthy());
    expect(cuentas().getByText("3 intentos fallidos").textContent).toBeTruthy();

    fireEvent.click(cuentas().getByRole("button", { name: "Desbloquear luis@dominio.dev" }));
    await waitFor(() => expect(unblock).toHaveBeenCalledWith("u2"));
  });

  it("borrar una cuenta exige escribir su correo exacto", async () => {
    const admin = fakeAdmin();
    const removeUser = vi.fn(admin.removeUser);
    renderAdmin({ ...admin, removeUser });
    await waitFor(() => expect(screen.getByText("luis@dominio.dev").textContent).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Eliminar luis@dominio.dev" }));
    const dialogo = screen.getByRole("dialog", { name: /Eliminar la cuenta luis@dominio\.dev/ });
    const confirmar = within(dialogo).getByRole("button", { name: "Eliminar cuenta" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    fireEvent.change(within(dialogo).getByLabelText("Correo exacto de la cuenta"), {
      target: { value: "luis@dominio.dev" }
    });
    expect(confirmar.disabled).toBe(false);
    expect(within(dialogo).getByText(/2 proyectos/i).textContent).toBeTruthy();

    fireEvent.click(confirmar);
    await waitFor(() => expect(removeUser).toHaveBeenCalledWith("u2", "luis@dominio.dev"));
  });

  it("la configuración manda solo lo que ha cambiado", async () => {
    const admin = fakeAdmin();
    const updateSettings = vi.fn(admin.updateSettings);
    renderAdmin({ ...admin, updateSettings });
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ allowRegistration: false }));
  });

  it("un refresco de fondo no descarta lo que se está editando", async () => {
    // Cada lectura trae un objeto nuevo (el cliente parsea el JSON): si el formulario reacciona
    // a la identidad en vez de al valor, cualquier refresco borra lo que la administración escribió.
    const settings = vi.fn(async () => ({ ...SETTINGS }));
    const updateSettings = vi.fn();
    renderAdmin(fakeAdmin({ settings, updateSettings }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));
    await waitFor(() => expect(settings.mock.calls.length).toBe(2));

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ allowRegistration: false }));
  });

  it("si otra pestaña cambia un valor, el servidor manda", async () => {
    let lectura = 0;
    const settings = vi.fn(async () => {
      lectura += 1;
      return lectura === 1 ? { ...SETTINGS } : { ...SETTINGS, maxProjectsPerUser: 40 };
    });
    renderAdmin(fakeAdmin({ settings }));
    await waitFor(() => expect(screen.getByLabelText("Proyectos por cuenta")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Proyectos por cuenta"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));
    await waitFor(() => expect(settings.mock.calls.length).toBe(2));

    expect((screen.getByLabelText("Proyectos por cuenta") as HTMLInputElement).value).toBe("40");
    expect((screen.getByRole("button", { name: "Guardar cambios" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("los límites se editan y se envían como números", async () => {
    const admin = fakeAdmin();
    const updateSettings = vi.fn(admin.updateSettings);
    renderAdmin({ ...admin, updateSettings });
    await waitFor(() => expect(screen.getByLabelText("Proyectos por cuenta")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Proyectos por cuenta"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ maxProjectsPerUser: 7 }));
  });

  it("enseña la actividad administrativa con su autor y su detalle", async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByRole("list", { name: "Actividad administrativa" }).textContent).toBeTruthy());
    const lista = screen.getByRole("list", { name: "Actividad administrativa" });
    expect(within(lista).getAllByText("root@dominio.dev").length).toBe(2);
    expect(within(lista).getByText(/Rol cambiado/i).textContent).toBeTruthy();
    expect(within(lista).getByText(/user → admin/).textContent).toBeTruthy();
  });

  it("el botón de actualizar vuelve a leer todo", async () => {
    const admin = fakeAdmin();
    const metrics = vi.fn(admin.metrics);
    renderAdmin({ ...admin, metrics });
    await waitFor(() => expect(screen.getByText("luis@dominio.dev").textContent).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));
    await waitFor(() => expect(metrics.mock.calls.length).toBe(2));
  });
});

describe("AdminPage · correo y actividad", () => {
  it("la bandeja lista los mensajes y sin SMTP no permite reintentar", async () => {
    const outbox = vi.fn(async () => [
      {
        id: "m1",
        recipient: "ana@dominio.dev",
        subject: "Confirma tu correo",
        createdAt: "2026-03-08T09:00:00.000Z",
        sentAt: null,
        attemptedAt: null,
        error: null
      },
      {
        id: "m2",
        recipient: "luis@dominio.dev",
        subject: "Restablece tu contraseña",
        createdAt: "2026-03-08T08:00:00.000Z",
        sentAt: "2026-03-08T08:00:05.000Z",
        attemptedAt: "2026-03-08T08:00:05.000Z",
        error: null
      }
    ]);
    renderAdmin(fakeAdmin({ outbox }));
    expect(await screen.findByText("Confirma tu correo")).toBeTruthy();
    expect(screen.getByText("Restablece tu contraseña").textContent).toBeTruthy();
    expect(screen.getByText("pendiente").textContent).toBe("pendiente");
    expect(screen.getByText("enviado").textContent).toBe("enviado");
    expect((screen.getByRole("button", { name: /Reintentar pendientes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("la actividad de una cuenta muestra sesiones, IPs y accesos, y cierra sus sesiones", async () => {
    const accountActivity = vi.fn(async () => ({
      sessions: [
        {
          id: "s1",
          createdAt: "2026-03-08T08:00:00.000Z",
          lastSeenAt: "2026-03-08T09:00:00.000Z",
          expiresAt: "2026-03-08T20:00:00.000Z",
          userAgent: "Chrome en el portátil",
          ip: "10.0.0.9",
          current: false
        }
      ],
      ips: [{ ip: "10.0.0.9", lastAt: "2026-03-08T09:00:00.000Z", count: 2 }],
      events: [
        {
          id: "e1",
          identifier: "luis@dominio.dev",
          ip: "10.0.0.9",
          userAgent: "Chrome",
          result: "fallo" as const,
          at: "2026-03-08T09:00:00.000Z"
        }
      ]
    }));
    const revokeSessions = vi.fn(async () => ({ revoked: 1 }));
    renderAdmin(fakeAdmin({ accountActivity, revokeSessions }));
    await waitFor(() => expect(screen.getByText("luis@dominio.dev").textContent).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Actividad de luis@dominio.dev" }));
    const dialogo = await screen.findByRole("dialog", { name: /Actividad de luis@dominio\.dev/ });
    expect(await within(dialogo).findByText(/Chrome en el portátil/)).toBeTruthy();
    expect(within(dialogo).getAllByText("10.0.0.9").length).toBeGreaterThan(0);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cerrar todas las sesiones" }));
    await waitFor(() => expect(revokeSessions).toHaveBeenCalledWith("u2"));
  });
});
