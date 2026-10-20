import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSession } from "./SessionContext";
import { AuthScreen } from "./AuthScreen";

/** La pantalla protegida solo se monta con sesión confirmada: el dato nunca está en el navegador. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { estado } = useSession();
  const location = useLocation();

  if (estado === "comprobando") {
    return (
      <AuthScreen title="WebForge" description="Comprobando sesión…">
        <p className="text-sm text-ink-faint">Espera un momento.</p>
      </AuthScreen>
    );
  }
  if (estado !== "autenticado") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}
