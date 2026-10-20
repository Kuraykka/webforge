import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, isApiError } from "../../lib/api";
import { isTwoFactorChallenge, type ActiveSession, type AuthApi, type SessionUser } from "./api";

export type SessionState = "comprobando" | "anonimo" | "autenticado" | "sin-servidor";

export interface SessionContextValue {
  estado: SessionState;
  user: SessionUser | null;
  sessions: ActiveSession[];
  error: string | null;
  /** El error de la última operación fallida: la pantalla necesita el estado y el `retry-after`. */
  fallo: ApiError | null;
  /** Desafío pendiente del segundo factor; `null` cuando no se está a medias del acceso. */
  challenge: string | null;
  esAdmin: boolean;
  auth: AuthApi;
  comprobar(): Promise<void>;
  entrar(identifier: string, password: string): Promise<boolean>;
  entrar2fa(code: string): Promise<boolean>;
  registrar(email: string, password: string, username?: string): Promise<boolean>;
  salir(): Promise<void>;
  cerrarSesion(id: string): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

function asApiError(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}

/** Estado de la sesión: lo sabe la cookie, así que el arranque siempre pasa por el servidor. */
export function SessionProvider({ auth, children }: { auth: AuthApi; children: ReactNode }) {
  const [estado, setEstado] = useState<SessionState>("comprobando");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fallo, setFallo] = useState<ApiError | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const mounted = useRef(true);
  // Toda mutación de sesión descarta el resultado de una comprobación antigua que llegue tarde.
  const marca = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setAnonymous = useCallback(() => {
    setUser(null);
    setSessions([]);
    setEstado("anonimo");
  }, []);

  const comprobar = useCallback(async () => {
    const propia = marca.current;
    try {
      const info = await auth.whoami();
      if (!mounted.current || marca.current !== propia) return;
      if (!info) {
        setError(null);
        setFallo(null);
        setAnonymous();
        return;
      }
      setError(null);
      setFallo(null);
      setUser(info.user);
      setSessions(info.sessions);
      setEstado("autenticado");
    } catch (cause) {
      if (!mounted.current || marca.current !== propia) return;
      if (isApiError(cause, 401)) {
        setAnonymous();
        return;
      }
      setError(messageOf(cause));
      setFallo(asApiError(cause));
      setEstado("sin-servidor");
    }
  }, [auth, setAnonymous]);

  useEffect(() => {
    void comprobar();
  }, [comprobar]);

  const entrar = useCallback(
    async (identifier: string, password: string): Promise<boolean> => {
      marca.current += 1;
      setError(null);
      setFallo(null);
      setChallenge(null);
      try {
        const resultado = await auth.login(identifier, password);
        // El segundo factor no es un fallo: es otro paso del mismo acceso.
        if (isTwoFactorChallenge(resultado)) {
          if (mounted.current) setChallenge(resultado.challenge);
          return false;
        }
        const abiertas = await auth.sessions();
        if (!mounted.current) return false;
        setUser(resultado);
        setSessions(abiertas);
        setEstado("autenticado");
        return true;
      } catch (cause) {
        if (mounted.current) {
          setError(messageOf(cause));
          setFallo(asApiError(cause));
          setAnonymous();
        }
        return false;
      }
    },
    [auth, setAnonymous]
  );

  const entrar2fa = useCallback(
    async (code: string): Promise<boolean> => {
      if (challenge === null) return false;
      setError(null);
      setFallo(null);
      try {
        const identidad = await auth.login2fa(challenge, code);
        const abiertas = await auth.sessions();
        if (!mounted.current) return false;
        setChallenge(null);
        setUser(identidad);
        setSessions(abiertas);
        setEstado("autenticado");
        return true;
      } catch (cause) {
        if (mounted.current) {
          // El desafío se consume aunque el código falle: hay que volver a escribir la contraseña.
          setChallenge(null);
          setError(messageOf(cause));
          setFallo(asApiError(cause));
          setAnonymous();
        }
        return false;
      }
    },
    [auth, challenge, setAnonymous]
  );

  const registrar = useCallback(
    async (email: string, password: string, username?: string): Promise<boolean> => {
      setError(null);
      setFallo(null);
      try {
        const registro = await auth.register(email, password, username);
        // La cuenta nace sin verificar: no hay sesión que abrir, así que el estado sigue anónimo.
        return registro.verificationRequired;
      } catch (cause) {
        if (mounted.current) {
          setError(messageOf(cause));
          setFallo(asApiError(cause));
        }
        return false;
      }
    },
    [auth]
  );

  const salir = useCallback(async () => {
    marca.current += 1;
    try {
      await auth.logout();
    } catch {
      // La cookie ya no sirve aunque el cierre no llegue: la interfaz vuelve al acceso.
    }
    if (!mounted.current) return;
    setError(null);
    setFallo(null);
    setChallenge(null);
    setAnonymous();
  }, [auth, setAnonymous]);

  const cerrarSesion = useCallback(
    async (id: string) => {
      try {
        await auth.revokeSession(id);
        const abiertas = await auth.sessions();
        if (mounted.current) {
          setSessions(abiertas);
          setError(null);
          setFallo(null);
        }
      } catch (cause) {
        if (mounted.current) {
          setError(messageOf(cause));
          setFallo(asApiError(cause));
        }
      }
    },
    [auth]
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      estado,
      user,
      sessions,
      error,
      fallo,
      challenge,
      esAdmin: user?.role === "admin",
      auth,
      comprobar,
      entrar,
      entrar2fa,
      registrar,
      salir,
      cerrarSesion
    }),
    [estado, user, sessions, error, fallo, challenge, auth, comprobar, entrar, entrar2fa, registrar, salir, cerrarSesion]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession debe usarse dentro de SessionProvider");
  return ctx;
}
