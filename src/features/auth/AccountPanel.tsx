import { useState, type FormEvent } from "react";
import { Badge, Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { relativeTime } from "../../lib/format";
import { PASSWORD_HINT } from "./AuthScreen";
import { useSession } from "./SessionContext";
import { TwoFactorCard } from "./TwoFactorCard";

const ROLE_LABEL = { user: "usuario", admin: "administrador" } as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

/** Cuenta, contraseña y sesiones del usuario: los datos salen siempre del servidor. */
export function AccountPanel() {
  const { user, sessions, esAdmin, auth, cerrarSesion } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await auth.changePassword(current, next);
      setNotice(`Contraseña cambiada: se han cerrado ${result.revokedSessions} sesiones más.`);
      setCurrent("");
      setNext("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const others = sessions.filter((session) => !session.current);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{user.email}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              {user.username ? <span className="font-mono">@{user.username}</span> : null}
              {user.username ? " · " : ""}
              Miembro desde {new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(user.createdAt))}
              {user.verifiedAt ? " · correo confirmado" : " · correo sin confirmar"}
            </p>
          </div>
          <Badge tone={esAdmin ? "accent" : "neutral"}>{ROLE_LABEL[user.role]}</Badge>
        </div>
      </Card>

      <TwoFactorCard />

      <Card>
        <h2 className="text-sm font-semibold text-ink">Cambiar contraseña</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Al guardar se cierran las demás sesiones y los enlaces de recuperación pendientes.
        </p>
        <form className="mt-3 space-y-3" aria-label="Cambia tu contraseña" onSubmit={submit}>
          <div>
            <Label htmlFor="account-current">Contraseña actual</Label>
            <Input
              id="account-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="account-next">Contraseña nueva</Label>
            <Input
              id="account-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              required
            />
            <p className="mt-1 text-xs text-ink-faint">{PASSWORD_HINT}</p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="text-sm text-success">{notice}</p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy}>
            Cambiar contraseña
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink">Sesiones activas</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {others.length === 0
            ? "Solo este navegador tiene la sesión abierta."
            : `${others.length} ${others.length === 1 ? "sesión abierta" : "sesiones abiertas"} en otros dispositivos.`}
        </p>
        <ul className="mt-2 divide-y divide-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {session.userAgent || "Dispositivo sin identificar"}
                </p>
                <p className="text-xs text-ink-faint">
                  {session.ip} · vista {relativeTime(session.lastSeenAt)}
                </p>
              </div>
              {session.current ? (
                <Badge tone="success">esta sesión</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Cerrar sesión de ${session.userAgent || "dispositivo sin identificar"}`}
                  onClick={() => void cerrarSesion(session.id)}
                >
                  Cerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
