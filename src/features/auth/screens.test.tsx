import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { SessionProvider } from "./SessionContext";
import { RequireAuth } from "./RequireAuth";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { VerifyEmailPage } from "./VerifyEmailPage";
import { SessionBadge } from "./SessionBadge";
import { CURRENT, fakeAuth, USER } from "./test-support";
import type { AuthApi } from "./api";

interface Screen {
  path: string;
  element: ReactNode;
}

const SCREENS: Screen[] = [
  { path: "/login", element: <LoginPage /> },
  { path: "/registro", element: <RegisterPage /> },
  { path: "/recuperar", element: <ForgotPasswordPage /> },
  { path: "/restablecer-contrasena", element: <ResetPasswordPage /> },
  { path: "/verificar-correo", element: <VerifyEmailPage /> },
  { path: "/", element: <RequireAuth><><SessionBadge /><p>tablero</p></></RequireAuth> }
];

function renderAuth(auth: AuthApi, entry: string): RenderResult {
  return render(
    <StoresProvider stores={localStores()}>
      <SessionProvider auth={auth}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            {SCREENS.map((screen) => (
              <Route key={screen.path} path={screen.path} element={screen.element} />
            ))}
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </StoresProvider>
  );
}

// jsdom no activa el envío de un formulario al pulsar el botón: se envía el formulario directamente.
function enviarFormulario(nombre: string) {
  fireEvent.submit(screen.getByRole("form", { name: nombre }));
}

const aviso = () => screen.queryByRole("alert")?.textContent ?? "";
const tablero = () => screen.queryByText("tablero");

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/^Correo( o usuario)?$/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
}

describe("RequireAuth", () => {
  it("sin sesión no deja ver el espacio de trabajo", async () => {
    renderAuth(fakeAuth(), "/");
    await waitFor(() => expect(screen.getByLabelText(/^Correo( o usuario)?$/)).toBeTruthy());
    expect(tablero()).toBeNull();
  });

  it("mientras comprueba la cookie no parpadea el contenido protegido", async () => {
    let resolver!: (value: null) => void;
    const auth = fakeAuth({
      whoami: () =>
        new Promise<null>((resolve) => {
          resolver = resolve;
        })
    });
    renderAuth(auth, "/");
    expect(tablero()).toBeNull();
    expect(screen.getByText(/Comprobando sesión/).textContent).toBeTruthy();
    resolver(null);
    await waitFor(() => expect(screen.getByLabelText(/^Correo( o usuario)?$/)).toBeTruthy());
  });

  it("con sesión válida muestra el contenido", async () => {
    const auth = fakeAuth({ whoami: async () => ({ user: USER, sessions: [] }) });
    renderAuth(auth, "/");
    await waitFor(() => expect(tablero()).toBeTruthy());
  });
});

describe("LoginPage", () => {
  it("envía las credenciales y entra en el panel", async () => {
    const login = vi.fn(async () => USER);
    renderAuth(fakeAuth({ login }), "/login");
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(tablero()).toBeTruthy());
    expect(login).toHaveBeenCalledWith("ana@dominio.dev", "S3creta-fuerte");
  });

  it("muestra el aviso del servidor y se queda en la pantalla", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(401, "Correo o contraseña incorrectos.");
      }
    });
    renderAuth(auth, "/login");
    fill("ana@dominio.dev", "corta");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(aviso()).toBe("Correo o contraseña incorrectos."));
    expect(tablero()).toBeNull();
  });

  it("avisa cuando el servidor no responde", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(0, "No se pudo conectar con el servidor.");
      }
    });
    renderAuth(auth, "/login");
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(aviso()).toMatch(/servidor/));
  });

  it("un acceso sin verificar ofrece pedir otro enlace", async () => {
    const resendVerification = vi.fn(async () => ({ accepted: true }));
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(403, "Falta verificar el correo.", null, { verificationRequired: true });
      },
      resendVerification
    });
    renderAuth(auth, "/login");
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(aviso()).toMatch(/verifica/i));
    fireEvent.click(screen.getByRole("button", { name: /Pedir otro enlace/i }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("ana@dominio.dev"));
    expect(tablero()).toBeNull();
  });

  it("el bloqueo de un día se muestra con la cuenta atrás que dice el servidor", async () => {
    const auth = fakeAuth({
      login: async () => {
        throw new ApiError(429, "Demasiados intentos fallidos: la cuenta queda bloqueada 24 horas.", 86_400);
      }
    });
    renderAuth(auth, "/login");
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(aviso()).toMatch(/24 horas/));
    expect(screen.getByTestId("bloqueo-resta").textContent).toBe("24:00:00");
  });

  it("quien ya tiene sesión no vuelve a ver el formulario", async () => {
    const auth = fakeAuth({ whoami: async () => ({ user: USER, sessions: [] }) });
    renderAuth(auth, "/login");
    await waitFor(() => expect(tablero()).toBeTruthy());
  });
});

describe("LoginPage · segundo factor", () => {
  it("pide el código después de la contraseña y solo entonces abre sesión", async () => {
    const login2fa = vi.fn(async () => USER);
    const auth = fakeAuth({
      login: async () => ({ twoFactorRequired: true as const, challenge: "desafio-1" }),
      login2fa
    });
    renderAuth(auth, "/login");
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Inicia sesión");
    await waitFor(() => expect(screen.getByLabelText("Código")).toBeTruthy());
    expect(tablero()).toBeNull();
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "123456" } });
    enviarFormulario("Verificación en dos pasos");
    await waitFor(() => expect(login2fa).toHaveBeenCalledWith("desafio-1", "123456"));
    await waitFor(() => expect(tablero()).toBeTruthy());
  });
});

describe("RegisterPage", () => {
  it("crea la cuenta, no abre sesión y pide verificar el correo", async () => {
    const register = vi.fn(async () => ({ user: USER, verificationRequired: true }));
    renderAuth(fakeAuth({ register }), "/registro");
    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toBeTruthy());
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Crea tu cuenta");
    await waitFor(() => expect(screen.getByText(/Revisa tu correo/i).textContent).toBeTruthy());
    expect(tablero()).toBeNull();
    expect(register).toHaveBeenCalledWith("ana@dominio.dev", "S3creta-fuerte", undefined);
    expect(screen.getByText(/ana@dominio\.dev/).textContent).toBeTruthy();
    expect(screen.getByTestId("cuenta-verificacion").textContent).toBe("3:00");
  });

  it("el reenvío pide otro enlace y vuelve a contar tres minutos", async () => {
    const resendVerification = vi.fn(async () => ({ accepted: true }));
    const auth = fakeAuth({
      register: async () => ({ user: USER, verificationRequired: true }),
      resendVerification
    });
    renderAuth(auth, "/registro");
    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toBeTruthy());
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Crea tu cuenta");
    await waitFor(() => expect(screen.getByText(/Revisa tu correo/i).textContent).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Reenviar enlace/i }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("ana@dominio.dev"));
    await waitFor(() => expect(screen.getByText(/otro enlace/i).textContent).toBeTruthy());
    expect(screen.getByTestId("cuenta-verificacion").textContent).toBe("3:00");
  });

  it("sin proveedor de correo lo dice en la pantalla de espera", async () => {
    const auth = fakeAuth({ register: async () => ({ user: USER, verificationRequired: true }) });
    renderAuth(auth, "/registro");
    await waitFor(() => expect(screen.getByLabelText("Contraseña")).toBeTruthy());
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Crea tu cuenta");
    await waitFor(() => expect(screen.getByText(/Revisa tu correo/i).textContent).toBeTruthy());
    expect(screen.getByText(/proveedor de correo/i).textContent).toBeTruthy();
  });

  it("respeta el registro cerrado del servidor", async () => {
    const register = vi.fn(async () => ({ user: USER, verificationRequired: true }));
    const auth = fakeAuth({ config: async () => ({ registrationAllowed: false }), register });
    renderAuth(auth, "/registro");
    await waitFor(() => expect(screen.getByText(/desactivado/i).textContent).toBeTruthy());
    expect((screen.getByRole("button", { name: "Crear cuenta" }) as HTMLButtonElement).disabled).toBe(true);
    expect(register).not.toHaveBeenCalled();
  });

  it("un correo ya registrado se muestra tal cual", async () => {
    const auth = fakeAuth({
      register: async () => {
        throw new ApiError(409, "Ya existe una cuenta con ese correo.");
      }
    });
    renderAuth(auth, "/registro");
    await waitFor(() => expect(screen.getByLabelText(/^Correo( o usuario)?$/)).toBeTruthy());
    fill("ana@dominio.dev", "S3creta-fuerte");
    enviarFormulario("Crea tu cuenta");
    await waitFor(() => expect(aviso()).toBe("Ya existe una cuenta con ese correo."));
    expect(screen.queryByText(/Revisa tu correo/i)).toBeNull();
  });
});

describe("ForgotPasswordPage", () => {
  it("pide el enlace sin revelar si el correo existe", async () => {
    const requestReset = vi.fn(async () => ({ accepted: true }));
    renderAuth(fakeAuth({ requestReset }), "/recuperar");
    fireEvent.change(screen.getByLabelText(/^Correo( o usuario)?$/), { target: { value: "ana@dominio.dev" } });
    enviarFormulario("Recupera tu acceso");
    await waitFor(() => expect(requestReset).toHaveBeenCalledWith("ana@dominio.dev"));
    await waitFor(() => expect(screen.getByText(/proveedor de correo/i).textContent).toBeTruthy());
  });
});

describe("ResetPasswordPage", () => {
  it("usa el token del enlace y una contraseña nueva", async () => {
    const confirmReset = vi.fn(async () => undefined);
    renderAuth(fakeAuth({ confirmReset }), "/restablecer-contrasena?token=abc123");
    fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: "Nueva-1234-segura" } });
    enviarFormulario("Elige una contraseña nueva");
    await waitFor(() => expect(confirmReset).toHaveBeenCalledWith("abc123", "Nueva-1234-segura"));
    await waitFor(() => expect(screen.getByText(/ya puedes iniciar sesión/i).textContent).toBeTruthy());
  });

  it("un token caducado muestra el aviso del servidor", async () => {
    const auth = fakeAuth({
      confirmReset: async () => {
        throw new ApiError(400, "El enlace no es válido o ya se usó.");
      }
    });
    renderAuth(auth, "/restablecer-contrasena?token=viejo");
    fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: "Nueva-1234-segura" } });
    enviarFormulario("Elige una contraseña nueva");
    await waitFor(() => expect(aviso()).toBe("El enlace no es válido o ya se usó."));
  });

  it("sin token en la URL pide el enlace de nuevo", () => {
    renderAuth(fakeAuth(), "/restablecer-contrasena");
    expect(screen.getByText(/pega el enlace/i).textContent).toBeTruthy();
    expect(screen.queryByLabelText("Contraseña nueva")).toBeNull();
  });
});

describe("SessionBadge", () => {
  it("muestra la cuenta y cierra el acceso", async () => {
    const logout = vi.fn(async () => undefined);
    const auth = fakeAuth({ whoami: async () => ({ user: USER, sessions: [CURRENT] }), logout });
    renderAuth(auth, "/");
    await waitFor(() => expect(tablero()).toBeTruthy());
    expect(screen.getByText("ana@dominio.dev").textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/^Correo( o usuario)?$/)).toBeTruthy());
  });

  it("no aparece sin sesión", async () => {
    renderAuth(fakeAuth({ whoami: async () => null }), "/");
    await waitFor(() => expect(screen.getByLabelText(/^Correo( o usuario)?$/)).toBeTruthy());
    expect(screen.queryByText("ana@dominio.dev")).toBeNull();
  });
});

describe("VerifyEmailPage", () => {
  it("confirma el correo con el token del enlace", async () => {
    const verifyEmail = vi.fn(async () => undefined);
    renderAuth(fakeAuth({ verifyEmail }), "/verificar-correo?token=abc");
    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith("abc"));
    await waitFor(() => expect(screen.getByText(/correo confirmado/i).textContent).toBeTruthy());
  });

  it("un enlace usado se reporta con el mensaje del servidor", async () => {
    const auth = fakeAuth({
      verifyEmail: async () => {
        throw new ApiError(400, "El enlace no es válido o ya se usó.");
      }
    });
    renderAuth(auth, "/verificar-correo?token=usado");
    await waitFor(() => expect(aviso()).toBe("El enlace no es válido o ya se usó."));
  });

  it("un enlace caducado explica el plazo de tres minutos", async () => {
    const auth = fakeAuth({
      verifyEmail: async () => {
        throw new ApiError(400, "El enlace no es válido o ya se usó.");
      }
    });
    renderAuth(auth, "/verificar-correo?token=viejo");
    await waitFor(() => expect(aviso()).toBe("El enlace no es válido o ya se usó."));
    expect(screen.getByText(/tres minutos/i).textContent).toBeTruthy();
  });

  it("sin token no se gasta ninguna petición", async () => {
    const verifyEmail = vi.fn(async () => undefined);
    renderAuth(fakeAuth({ verifyEmail }), "/verificar-correo");
    expect(screen.getByText(/sin token/i).textContent).toBeTruthy();
    await Promise.resolve();
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
