import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "./SessionContext";
import { AuthScreen } from "./AuthScreen";

type Resultado = "enviando" | "confirmado" | "fallido";

export function VerifyEmailPage() {
  const { auth, comprobar } = useSession();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [estado, setEstado] = useState<Resultado | "sin-token">(token ? "enviando" : "sin-token");
  const [error, setError] = useState<string | null>(null);
  const lanzado = useRef(false);

  useEffect(() => {
    if (!token || lanzado.current) return;
    // El enlace es de un solo uso: el segundo arranque de StrictMode no debe volver a consumirlo.
    lanzado.current = true;
    auth
      .verifyEmail(token)
      .then(async () => {
        setEstado("confirmado");
        await comprobar();
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "No se pudo confirmar el correo.");
        setEstado("fallido");
      });
  }, [auth, comprobar, token]);

  if (!token) {
    return (
      <AuthScreen
        title="Confirmar el correo"
        description="Enlace sin token: no se ha enviado ninguna petición al servidor."
        footer={
          <Link className="text-accent hover:underline" to="/login">
            Ir a iniciar sesión
          </Link>
        }
      >
        <p className="text-sm text-ink-muted">Revisa el enlace recibido, falta el parámetro token.</p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Confirmar el correo"
      description={
        estado === "confirmado"
          ? "Correo confirmado. Ya puedes usar todas las funciones de la plataforma."
          : estado === "fallido"
            ? "No hemos podido confirmar el correo."
            : "Comprobando el enlace…"
      }
      error={error}
      footer={
        <Link className="text-accent hover:underline" to="/login">
          Ir a iniciar sesión
        </Link>
      }
    >
      <p className="text-sm text-ink-muted">
        {estado === "enviando"
          ? "Enviando el token del enlace…"
          : estado === "confirmado"
            ? "Gracias por confirmar la dirección."
            : "El enlace caduca a los tres minutos: puedes pedir otro desde el acceso."}
      </p>
    </AuthScreen>
  );
}
