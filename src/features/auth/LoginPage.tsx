import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { errorFlag, isApiError } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { useSession } from "./SessionContext";
import { AuthScreen } from "./AuthScreen";
import { restoFormateado, useCountdown } from "./countdown";

export function LoginPage() {
  const { estado, entrar, entrar2fa, error, fallo, challenge, auth, salir } = useSession();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [enlacePedido, setEnlacePedido] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Cada fallo de acceso es un objeto nuevo: con esta marca la cuenta atrás vuelve a arrancar.
  const [marca, setMarca] = useState(0);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => setMarca((n) => n + 1), [fallo]);
  const bloqueo = useCountdown(fallo?.status === 429 ? (fallo.retryAfterSeconds ?? 0) : null, marca);
  const faltaVerificar = isApiError(fallo, 403) && errorFlag(fallo, "verificationRequired");

  if (estado === "autenticado") return <Navigate to={from} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setEnlacePedido(false);
    setAviso(null);
    await entrar(identifier, password);
    setBusy(false);
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setAviso(null);
    await entrar2fa(code);
    setCode("");
    setBusy(false);
  };

  const pedirEnlace = async () => {
    setAviso(null);
    try {
      await auth.resendVerification(identifier.includes("@") ? identifier : "");
      setEnlacePedido(true);
    } catch {
      setAviso("No se pudo pedir el enlace ahora. Inténtalo de nuevo en un momento.");
    }
  };

  if (challenge !== null) {
    return (
      <AuthScreen
        title="Verificación en dos pasos"
        description="Escribe el código de seis dígitos de tu aplicación de autenticación o uno de los códigos de recuperación."
        error={error}
        onSubmit={submitCode}
        footer={
          <button type="button" className="text-accent hover:underline" onClick={() => void salir()}>
            Volver a empezar
          </button>
        }
      >
        <div>
          <Label htmlFor="two-factor-code">Código</Label>
          <Input
            id="two-factor-code"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          Verificar
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Inicia sesión"
      description="Entra con tu correo o tu nombre de usuario para abrir tus proyectos."
      error={aviso ?? error}
      onSubmit={submit}
      footer={
        <div className="flex flex-col gap-1">
          <Link className="text-accent hover:underline" to="/recuperar">
            ¿No recuerdas la contraseña?
          </Link>
          <Link className="text-accent hover:underline" to="/registro">
            Crear una cuenta nueva
          </Link>
        </div>
      }
    >
      <div>
        <Label htmlFor="email">Correo o usuario</Label>
        <Input
          id="email"
          type="text"
          autoComplete="username"
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {bloqueo !== null ? (
        <p className="text-sm text-ink-muted">
          {bloqueo > 0 ? (
            <>
              Puedes reintentar en <span data-testid="bloqueo-resta" className="font-mono">{restoFormateado(bloqueo)}</span>.
            </>
          ) : (
            <span data-testid="bloqueo-resta">0:00</span>
          )}
          {bloqueo === 0 ? " Ya vuelve a poder intentarlo." : ""}
        </p>
      ) : null}
      {faltaVerificar ? (
        <div className="space-y-2">
          <Button type="button" variant="secondary" className="w-full" disabled={busy || identifier === ""} onClick={() => void pedirEnlace()}>
            Pedir otro enlace de verificación
          </Button>
          {enlacePedido ? (
            <p className="text-sm text-ink">Te hemos encolado un enlace nuevo: caduca en tres minutos.</p>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        Entrar
      </Button>
    </AuthScreen>
  );
}
