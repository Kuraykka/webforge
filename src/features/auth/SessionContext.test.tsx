import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { AuthApi, SessionInfo } from "./api";
import { SessionProvider, useSession, type SessionContextValue } from "./SessionContext";
import { CURRENT, OTHER_SESSION, USER, fakeAuth } from "./test-support";

const OTRA = OTHER_SESSION;

const INFO: SessionInfo = { user: USER, sessions: [CURRENT] };

let latest: SessionContextValue | null = null;

function Probe() {
  latest = useSession();
  return (
    <div>
      <span data-testid="estado">{latest.estado}</span>
      <span data-testid="correo">{latest.user?.email ?? "-"}</span>
      <button type="button" onClick={() => void latest?.entrar("a@b.dev", "clave")}>
        entrar
      </button>
    </div>
  );
}

function renderSession(auth: AuthApi) {
  latest = null;
  return render(
    <SessionProvider auth={auth}>
      <Probe />
    </SessionProvider>
  );
}

describe("SessionProvider", () => {
  it("empieza comprobando la cookie y termina en anónimo", async () => {
    const { container } = renderSession(fakeAuth());
    expect(container.querySelector('[data-testid="estado"]')?.textContent).toBe("comprobando");
    await waitFor(() => expect(latest?.estado).toBe("anonimo"));
    expect(latest?.user).toBeNull();
  });

  it("una cookie válida deja la identidad disponible", async () => {
    renderSession(fakeAuth({ whoami: async () => INFO }));
    await waitFor(() => expect(latest?.estado).toBe("autenticado"));
    expect(latest?.user?.email).toBe("ana@dominio.dev");
  });

  it("sin servidor la pantalla no se queda comprobando: avisa", async () => {
    renderSession(fakeAuth({ whoami: async () => { throw new ApiError(0, "No se pudo conectar con el servidor."); } }));
    await waitFor(() => expect(latest?.estado).toBe("sin-servidor"));
    expect(latest?.error).toBe("No se pudo conectar con el servidor.");
  });

  it("entrar guarda la identidad y las sesiones que abre el servidor", async () => {
    const auth = fakeAuth({ sessions: async () => [CURRENT] });
    renderSession(auth);
    await waitFor(() => expect(latest?.estado).toBe("anonimo"));
    await act(async () => {
      const ok = await latest?.entrar("ana@dominio.dev", "S3creta-fuerte");
      expect(ok).toBe(true);
    });
    expect(latest?.estado).toBe("autenticado");
    expect(latest?.user?.email).toBe("ana@dominio.dev");
    expect(latest?.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("un acceso fallido deja el mensaje del servidor y no autentica", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(401, "Correo o contraseña incorrectos.");
      }
    });
    renderSession(auth);
    await waitFor(() => expect(latest?.estado).toBe("anonimo"));
    let resultado = true;
    await act(async () => {
      resultado = (await latest?.entrar("ana@dominio.dev", "mala")) ?? false;
    });
    expect(resultado).toBe(false);
    expect(latest?.estado).toBe("anonimo");
    expect(latest?.error).toBe("Correo o contraseña incorrectos.");
  });

  it("registrarse no abre sesión: primero hay que verificar el correo", async () => {
    const auth = fakeAuth();
    const login = vi.spyOn(auth, "login");
    const sessions = vi.spyOn(auth, "sessions");
    renderSession(auth);
    await waitFor(() => expect(latest?.estado).toBe("anonimo"));
    let resultado = false;
    await act(async () => {
      resultado = (await latest?.registrar("ana@dominio.dev", "S3creta-fuerte")) ?? false;
    });
    expect(resultado).toBe(true);
    expect(latest?.estado).toBe("anonimo");
    expect(login).not.toHaveBeenCalled();
    expect(sessions).not.toHaveBeenCalled();
  });

  it("cerrar otra sesión deja la lista como responde el servidor", async () => {
    const revoke = vi.fn(async () => ({ revoked: "s2" }));
    const auth = fakeAuth({
      whoami: async () => ({ ...INFO, sessions: [OTRA, CURRENT] }),
      sessions: async () => [CURRENT],
      revokeSession: revoke
    });
    renderSession(auth);
    await waitFor(() => expect(latest?.sessions.map((s) => s.id)).toEqual(["s2", "s1"]));
    await act(async () => {
      await latest?.cerrarSesion("s2");
    });
    expect(revoke).toHaveBeenCalledWith("s2");
    await waitFor(() => expect(latest?.sessions.map((s) => s.id)).toEqual(["s1"]));
  });

  it("salir cierra la sesión del servidor y limpia la interfaz", async () => {
    const logout = vi.fn(async () => undefined);
    renderSession(fakeAuth({ whoami: async () => INFO, logout }));
    await waitFor(() => expect(latest?.estado).toBe("autenticado"));
    await act(async () => {
      await latest?.salir();
    });
    expect(logout).toHaveBeenCalled();
    expect(latest?.estado).toBe("anonimo");
    expect(latest?.user).toBeNull();
  });

  it("la identidad es administrador cuando el servidor lo dice", async () => {
    renderSession(fakeAuth({ whoami: async () => ({ ...INFO, user: { ...INFO.user, role: "admin" } }) }));
    await waitFor(() => expect(latest?.esAdmin).toBe(true));
  });

  it("comprobar de nuevo recarga la sesión desde el servidor", async () => {
    const whoami = vi.fn<AuthApi["whoami"]>().mockResolvedValue(INFO);
    renderSession(fakeAuth({ whoami }));
    await waitFor(() => expect(latest?.estado).toBe("autenticado"));
    await act(async () => {
      await latest?.comprobar();
    });
    expect(whoami).toHaveBeenCalledTimes(2);
  });

  it("una comprobación pendiente no pisa un acceso reciente", async () => {
    let resolver!: (value: SessionInfo | null) => void;
    const whoami = vi.fn<AuthApi["whoami"]>(
      () =>
        new Promise<SessionInfo | null>((resolve) => {
          resolver = resolve;
        })
    );
    renderSession(fakeAuth({ whoami, sessions: async () => [CURRENT] }));
    await act(async () => {
      await latest?.entrar("ana@dominio.dev", "S3creta-fuerte");
    });
    expect(latest?.estado).toBe("autenticado");

    resolver(null);
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest?.estado).toBe("autenticado");
  });

  it("el bloqueo al entrar se muestra tal cual", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(429, "Demasiados intentos fallidos.");
      }
    });
    renderSession(auth);
    await waitFor(() => expect(latest?.estado).toBe("anonimo"));
    await act(async () => {
      await latest?.entrar("ana@dominio.dev", "mala");
    });
    expect(latest?.error).toBe("Demasiados intentos fallidos.");
  });

  it("fuera del proveedor no hay sesión", () => {
    expect(() => render(<Probe />)).toThrow(/SessionProvider/);
  });
});
