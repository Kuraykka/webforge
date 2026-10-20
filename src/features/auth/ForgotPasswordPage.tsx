import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { useSession } from "./SessionContext";
import { AuthScreen } from "./AuthScreen";

export function ForgotPasswordPage() {
  const { auth } = useSession();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.requestReset(email);
      setEnviado(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar el enlace.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      title="Recupera tu acceso"
      description="Escribe tu correo y preparamos un enlace de un solo uso."
      error={error}
      onSubmit={submit}
      footer={
        <Link className="text-accent hover:underline" to="/login">
          Volver a iniciar sesión
        </Link>
      }
    >
      <div>
        <Label htmlFor="email">Correo</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        Enviar enlace
      </Button>
      {enviado ? (
        <p className="text-xs text-ink-muted">
          Si el correo tiene cuenta, el enlace ya está preparado. Ahora mismo no hay proveedor de correo configurado,
          así que el mensaje se queda en la bandeja local del servidor y lo gestiona la administración.
        </p>
      ) : (
        <p className="text-xs text-ink-faint">
          No decimos si un correo tiene cuenta: la respuesta es siempre la misma.
        </p>
      )}
    </AuthScreen>
  );
}
