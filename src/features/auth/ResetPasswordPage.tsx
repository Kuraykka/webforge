import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { useSession } from "./SessionContext";
import { AuthScreen, PASSWORD_HINT } from "./AuthScreen";

export function ResetPasswordPage() {
  const { auth } = useSession();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await auth.confirmReset(token, password);
      setListo(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cambiar la contraseña.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthScreen
        title="Restablecer contraseña"
        description="El enlace del correo caduca a los 30 minutos y solo funciona una vez."
        footer={
          <Link className="text-accent hover:underline" to="/recuperar">
            Pedir un enlace nuevo
          </Link>
        }
      >
        <p className="text-sm text-ink-muted">Falta el token: pega el enlace completo que te hemos preparado.</p>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Elige una contraseña nueva"
      description={listo ? "Contraseña cambiada: ya puedes iniciar sesión." : "Se cerrarán todas las sesiones abiertas."}
      error={error}
      onSubmit={submit}
      footer={
        <Link className="text-accent hover:underline" to="/login">
          Ir a iniciar sesión
        </Link>
      }
    >
      {listo ? null : (
        <>
          <div>
            <Label htmlFor="password">Contraseña nueva</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="mt-1 text-xs text-ink-faint">{PASSWORD_HINT}</p>
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            Cambiar contraseña
          </Button>
        </>
      )}
    </AuthScreen>
  );
}
