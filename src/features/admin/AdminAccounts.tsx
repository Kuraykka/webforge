import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge, Card, Spinner } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { ConfirmDialog, Modal } from "../../components/ui/Modal";
import { formatBytes, relativeTime } from "../../lib/format";
import type { UserRole, UserStatus } from "../auth/api";
import { useAdminApi, type AdminRun } from "./AdminContext";
import { useToast } from "../../components/ui/Toast";
import type { AccountActivity, AdminAccount } from "./api";

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "user", label: "usuario" },
  { value: "admin", label: "administrador" }
];

interface Props {
  accounts: AdminAccount[];
  busy: boolean;
  run: AdminRun;
}

/**
 * Roles, estados y borrados se ejecutan llamando al servidor: la interfaz solo enseña el
 * resultado, nunca decide si una operación está permitida.
 */
export function AdminAccounts({ accounts, busy, run }: Props) {
  const api = useAdminApi();
  const { notify } = useToast();
  const [suspendTarget, setSuspendTarget] = useState<AdminAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAccount | null>(null);
  const [activityOf, setActivityOf] = useState<AdminAccount | null>(null);
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const cambiarRol = (account: AdminAccount, role: UserRole) => {
    void run(() => api.setRole(account.id, role), `El rol de ${account.email} es ${role === "admin" ? "administrador" : "usuario"}.`);
  };

  const cambiarEstado = (account: AdminAccount, status: UserStatus) => {
    void run(
      () => api.setStatus(account.id, status),
      status === "suspendida" ? `${account.email} suspendida y con las sesiones cerradas.` : `${account.email} activada.`
    );
  };

  const desbloquear = (account: AdminAccount) => {
    void run(
      () => api.unblock(account.id),
      `${account.email} desbloqueada: puede volver a iniciar sesión.`
    );
  };

  const abrirActividad = async (account: AdminAccount) => {
    setActivityOf(account);
    setActivity(null);
    setActivityError(null);
    setActivityBusy(true);
    try {
      setActivity(await api.accountActivity(account.id));
    } catch (cause) {
      setActivityError(cause instanceof Error ? cause.message : "No se pudo leer la actividad.");
    } finally {
      setActivityBusy(false);
    }
  };

  const revocarSesiones = async () => {
    if (!activityOf) return;
    setActivityBusy(true);
    setActivityError(null);
    try {
      const resultado = await api.revokeSessions(activityOf.id);
      notify("success", `${resultado.revoked} sesiones cerradas en ${activityOf.email}.`);
      setActivity(await api.accountActivity(activityOf.id));
    } catch (cause) {
      setActivityError(cause instanceof Error ? cause.message : "No se pudieron cerrar las sesiones.");
    } finally {
      setActivityBusy(false);
    }
  };

  const eliminar = (account: AdminAccount) => {
    void run(() => api.removeUser(account.id, confirmText.trim()), `${account.email} ha sido eliminada.`);
    setDeleteTarget(null);
    setConfirmText("");
  };

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Cuentas y permisos</h2>
        <p className="text-xs text-ink-faint">{accounts.length} en la plataforma</p>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Cuentas registradas con su rol, su estado y lo que ocupan</caption>
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1 font-medium">Cuenta</th>
              <th className="py-1 font-medium">Rol</th>
              <th className="py-1 font-medium">Uso</th>
              <th className="py-1 font-medium">Último acceso</th>
              <th className="py-1 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-t border-border align-middle">
                <td className="py-2 pr-2">
                  <p className="max-w-48 truncate font-medium text-ink">{account.email}</p>
                  {account.username ? <p className="font-mono text-xs text-ink-faint">@{account.username}</p> : null}
                  <p className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={account.status === "activa" ? "success" : "danger"}>{account.status}</Badge>
                    {account.role === "admin" ? (
                      <Badge tone={account.twoFactorEnabled ? "success" : "warning"}>
                        {account.twoFactorEnabled ? "2FA" : "sin 2FA"}
                      </Badge>
                    ) : null}
                    {account.verifiedAt === null ? (
                      <span className="text-xs text-ink-faint">correo sin confirmar</span>
                    ) : null}
                    {account.lockedUntil !== null ? (
                      <>
                        <Badge tone="warning">bloqueada 24 horas</Badge>
                        <span className="text-xs text-ink-faint">{account.failedAttempts} intentos fallidos</span>
                      </>
                    ) : null}
                  </p>
                </td>
                <td className="py-2 pr-2">
                  <select
                    aria-label={`Rol de ${account.email}`}
                    value={account.role}
                    disabled={busy}
                    onChange={(event) => cambiarRol(account, event.target.value as UserRole)}
                    className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-2 text-ink-muted">
                  {account.projects} proyectos · {account.files} archivos · {formatBytes(account.bytes)}
                </td>
                <td className="py-2 pr-2 text-ink-muted">
                  {account.lastLoginAt ? relativeTime(account.lastLoginAt) : "nunca"}
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" disabled={busy} onClick={() => void abrirActividad(account)} aria-label={`Actividad de ${account.email}`}>
                      Actividad
                    </Button>
                    {account.lockedUntil !== null ? (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => desbloquear(account)}
                        aria-label={`Desbloquear ${account.email}`}
                      >
                        Desbloquear
                      </Button>
                    ) : null}
                    {account.status === "activa" ? (
                      <Button size="sm" disabled={busy} onClick={() => setSuspendTarget(account)} aria-label={`Suspender ${account.email}`}>
                        Suspender
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={() => cambiarEstado(account, "activa")} aria-label={`Reactivar ${account.email}`}>
                        Reactivar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        setDeleteTarget(account);
                        setConfirmText("");
                      }}
                      aria-label={`Eliminar ${account.email}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={suspendTarget !== null}
        title={`Suspender la cuenta ${suspendTarget?.email ?? ""}`}
        message="Se cerrarán todas sus sesiones abiertas y no podrá iniciar sesión hasta reactivarla. Sus proyectos siguen en la base de datos."
        confirmLabel="Suspender cuenta"
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => {
          if (suspendTarget) cambiarEstado(suspendTarget, "suspendida");
          setSuspendTarget(null);
        }}
      />

      {activityOf ? (
        <Modal
          open
          title={`Actividad de ${activityOf.email}`}
          description="Sesiones abiertas, IPs desde las que se intentó entrar y últimos accesos."
          onClose={() => setActivityOf(null)}
        >
          {activityBusy && activity === null ? (
            <div className="flex items-center gap-2 py-4 text-sm text-ink-muted">
              <Spinner /> Leyendo la actividad…
            </div>
          ) : null}
          {activityError ? (
            <p role="alert" className="text-sm text-danger">
              {activityError}
            </p>
          ) : null}
          {activity ? (
            <div className="space-y-4 text-sm">
              <section>
                <h3 className="text-xs font-semibold uppercase text-ink-muted">Sesiones abiertas ({activity.sessions.length})</h3>
                {activity.sessions.length === 0 ? (
                  <p className="mt-1 text-ink-muted">Ninguna.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {activity.sessions.map((sesion) => (
                      <li key={sesion.id} className="text-ink-muted">
                        <span className="text-ink">{sesion.userAgent || "sin agente"}</span> ·{" "}
                        <span className="font-mono text-xs">{sesion.ip}</span> · {relativeTime(sesion.lastSeenAt)}
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" className="mt-2" disabled={activityBusy} onClick={() => void revocarSesiones()}>
                  Cerrar todas las sesiones
                </Button>
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase text-ink-muted">IPs recientes</h3>
                {activity.ips.length === 0 ? (
                  <p className="mt-1 text-ink-muted">Sin accesos registrados.</p>
                ) : (
                  <ul className="mt-1 space-y-1 font-mono text-xs text-ink-muted">
                    {activity.ips.map((ip) => (
                      <li key={ip.ip}>
                        {ip.ip} · {ip.count} intento(s) · {relativeTime(ip.lastAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-xs font-semibold uppercase text-ink-muted">Últimos accesos</h3>
                {activity.events.length === 0 ? (
                  <p className="mt-1 text-ink-muted">Sin eventos.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {activity.events.slice(0, 12).map((evento) => (
                      <li key={evento.id} className="text-ink-muted">
                        <Badge tone={evento.result === "exito" ? "success" : evento.result === "bloqueado" ? "danger" : "warning"}>
                          {evento.result}
                        </Badge>{" "}
                        <span className="font-mono text-xs">{evento.ip}</span> · {relativeTime(evento.at)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          open
          title={`Eliminar la cuenta ${deleteTarget.email}`}
          description="Se borran la cuenta, sus proyectos, sus archivos y sus sesiones. No se puede deshacer."
          onClose={() => setDeleteTarget(null)}
        >
          <p className="text-sm text-ink-muted">
            Se eliminarán {deleteTarget.projects} proyectos y {formatBytes(deleteTarget.bytes)}.
          </p>
          <div className="mt-3">
            <Label htmlFor="confirmar-correo">Correo exacto de la cuenta</Label>
            <Input
              id="confirmar-correo"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={deleteTarget.email}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={confirmText.trim() !== deleteTarget.email} onClick={() => eliminar(deleteTarget)}>
              Eliminar cuenta
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}
