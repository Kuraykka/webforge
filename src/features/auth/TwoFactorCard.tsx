import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge, Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { useSession } from "./SessionContext";
import type { TwoFactorStatus } from "./api";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

/** TOTP para cualquier cuenta; si está activo, el acceso pide el código además de la contraseña. */
export function TwoFactorCard() {
  const { auth } = useSession();
  const [estado, setEstado] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [baja, setBaja] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    auth
      .twoFactor()
      .then((valor) => {
        if (vivo) setEstado(valor);
      })
      .catch((cause: unknown) => {
        if (vivo) setError(messageOf(cause));
      });
    return () => {
      vivo = false;
    };
  }, [auth]);

  const refrescar = async () => {
    setEstado(await auth.twoFactor());
  };

  const empezar = async () => {
    setBusy(true);
    setError(null);
    setAviso(null);
    setCodigos(null);
    try {
      setSetup(await auth.setupTwoFactor());
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmar = async () => {
    setBusy(true);
    setError(null);
    try {
      const resultado = await auth.confirmTwoFactor(codigo);
      setCodigos(resultado.recoveryCodes);
      setSetup(null);
      setCodigo("");
      await refrescar();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const desactivar = async () => {
    setBusy(true);
    setError(null);
    setAviso(null);
    try {
      await auth.disableTwoFactor(password, baja);
      setPassword("");
      setBaja("");
      setCodigos(null);
      await refrescar();
      setAviso("Verificación en dos pasos desactivada.");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-accent" aria-hidden /> Verificación en dos pasos
        </h2>
        {estado ? (
          <Badge tone={estado.enabled ? "success" : "neutral"}>{estado.enabled ? "activada" : "desactivada"}</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Además de la contraseña, se pedirá un código de seis dígitos de tu aplicación de autenticación. Sin servicio de
        mensajes ni dependencias externas: el secreto se guarda cifrado en el servidor.
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {aviso ? <p className="mt-3 text-sm text-ink">{aviso}</p> : null}

      {codigos ? (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <p className="text-sm text-ink">Guarda estos códigos de recuperación: solo se muestran una vez.</p>
          <ul aria-label="Códigos de recuperación" className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm text-ink">
            {codigos.map((valor) => (
              <li key={valor}>{valor}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {estado?.enabled ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-faint">Quedan {estado.recoveryCodes} códigos de recuperación sin usar.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="2fa-disable-password">Contraseña para desactivar</Label>
              <Input
                id="2fa-disable-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="2fa-disable-code">Código para desactivar</Label>
              <Input
                id="2fa-disable-code"
                autoComplete="one-time-code"
                value={baja}
                onChange={(event) => setBaja(event.target.value)}
              />
            </div>
          </div>
          <Button variant="secondary" disabled={busy || password === "" || baja === ""} onClick={() => void desactivar()}>
            Desactivar verificación en dos pasos
          </Button>
        </div>
      ) : setup ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink-muted">
            Añade el secreto a tu aplicación o abre el enlace de configuración. Después escribe el código que muestre.
          </p>
          <p className="text-xs text-ink-muted">Secreto</p>
          <code className="block break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-ink">
            {setup.secret}
          </code>
          <p className="text-xs text-ink-muted">Enlace para la aplicación</p>
          <code className="block break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-ink-muted">
            {setup.otpauth}
          </code>
          <div>
            <Label htmlFor="2fa-code">Código de 6 dígitos</Label>
            <Input id="2fa-code" autoComplete="one-time-code" value={codigo} onChange={(event) => setCodigo(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || codigo === ""} onClick={() => void confirmar()}>
              Activar
            </Button>
            <Button variant="secondary" onClick={() => setSetup(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3" variant="primary" disabled={busy || estado === null} onClick={() => void empezar()}>
          Configurar verificación en dos pasos
        </Button>
      )}
    </Card>
  );
}
