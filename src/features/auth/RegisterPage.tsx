import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { useSession } from "./SessionContext";
import { AuthScreen, PASSWORD_HINT } from "./AuthScreen";
import { VERIFICATION_SECONDS, restoFormateado, useCountdown } from "./countdown";

/** Pantalla que espera el enlace: sin confirmación la cuenta no tiene sesión. */
function EsperaVerificacion({ correo, onVolver }: { correo: string; onVolver: () => void }) {
  const { auth } = useSession();
  const [envio, setEnvio] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const restante = useCountdown(VERIFICATION_SECONDS, envio);

  const reenviar = async () => {
    setOcupado(true);
    setAviso(null);
    try {
      await auth.resendVerification(correo);
      setEnvio((n) => n + 1);
    } catch {
      setAviso("No se pudo pedir otro enlace ahora. Inténtalo de nuevo en un momento.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <AuthScreen
      title="Revisa tu correo"
      description={`Hemos encolado un enlace de verificación para ${correo}. Entra en él para activar la cuenta.`}
      error={aviso}
      footer={
        <button type="button" className="text-accent hover:underline" onClick={onVolver}>
          Usar otro correo
        </button>
      }
    >
      <p className="text-sm text-ink-muted">
        {restante !== null && restante > 0
          ? "Tiempo restante para usar el enlace:"
          : "El enlace ya caducó: pide otro para recibir uno nuevo."}
      </p>
      {envio > 0 ? <p className="text-sm text-ink">Te hemos encolado otro enlace.</p> : null}
      <p data-testid="cuenta-verificacion" className="font-mono text-2xl text-ink">
        {restoFormateado(restante ?? 0)}
      </p>
      <Button type="button" variant="secondary" className="w-full" disabled={ocupado} onClick={() => void reenviar()}>
        Reenviar enlace
      </Button>
      <p className="text-xs text-ink-faint">
        Sin proveedor de correo configurado el mensaje no sale del servidor: se queda en la bandeja de salida que
        revisa la administración.
      </p>
      <Link className="block text-sm text-accent hover:underline" to="/login">
        Ya lo he verificado: iniciar sesión
      </Link>
    </AuthScreen>
  );
}

export function RegisterPage() {
  const { estado, registrar, auth, error } = useSession();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [abierto, setAbierto] = useState<boolean | null>(null);
  const [pendiente, setPendiente] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    auth
      .config()
      .then((config) => {
        if (vivo) setAbierto(config.registrationAllowed);
      })
      .catch(() => {
        if (vivo) setAbierto(false);
      });
    return () => {
      vivo = false;
    };
  }, [auth]);

  if (estado === "autenticado") return <Navigate to="/" replace />;
  if (pendiente) return <EsperaVerificacion correo={pendiente} onVolver={() => setPendiente(null)} />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const verificado = await registrar(email, password, username.trim() === "" ? undefined : username);
    setBusy(false);
    if (verificado) setPendiente(email);
  };

  const cerrado = abierto === false;

  return (
    <AuthScreen
      title="Crea tu cuenta"
      description={
        cerrado
          ? "El auto-registro está desactivado en este servidor. Pide una cuenta a la administración."
          : "Con un correo y una contraseña ya puedes crear proyectos."
      }
      error={abierto === null ? null : error}
      onSubmit={submit}
      footer={
        <Link className="text-accent hover:underline" to="/login">
          Ya tengo cuenta
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
          disabled={cerrado}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="username">Nombre de usuario (opcional)</Label>
        <Input
          id="username"
          type="text"
          autoComplete="username"
          disabled={cerrado}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-faint">
          De 3 a 30 caracteres: letras, números, punto, guion y guion bajo. Si lo dejas vacío se deriva del correo.
        </p>
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          disabled={cerrado}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="mt-1 text-xs text-ink-faint">{PASSWORD_HINT}</p>
      </div>
      <Button type="submit" variant="primary" className="w-full" disabled={cerrado || busy}>
        Crear cuenta
      </Button>
      <p className="text-xs text-ink-faint">
        Al crear la cuenta se genera un enlace de confirmación que caduca en tres minutos: hasta que no entres en él
        no podrás iniciar sesión.
      </p>
    </AuthScreen>
  );
}
