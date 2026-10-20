import { useEffect, useState } from "react";
import { MailCheck, RefreshCw } from "lucide-react";
import { Badge, Card, Spinner } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { relativeTime } from "../../lib/format";
import { useAdminApi } from "./AdminContext";
import type { OutboxMessage } from "./api";

/** Bandeja de correo del servidor: estado real de cada mensaje, no una lista de deseos. */
export function AdminOutbox({ canSend }: { canSend: boolean }) {
  const api = useAdminApi();
  const { notify } = useToast();
  const [mensajes, setMensajes] = useState<OutboxMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .outbox()
      .then((lista) => {
        if (vivo) setMensajes(lista);
      })
      .catch((cause: unknown) => {
        if (vivo) setError(cause instanceof Error ? cause.message : "No se pudo leer la bandeja.");
      });
    return () => {
      vivo = false;
    };
  }, [api]);

  const reintentar = async () => {
    setBusy(true);
    setError(null);
    try {
      const resultado = await api.retryOutbox();
      notify("success", `${resultado.delivered} entregados, ${resultado.failed} fallidos.`);
      setMensajes(await api.outbox());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo reintentar el envío.");
    } finally {
      setBusy(false);
    }
  };

  const pendientes = (mensajes ?? []).filter((mensaje) => mensaje.sentAt === null).length;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <MailCheck className="h-4 w-4 text-accent" aria-hidden /> Bandeja de correo
        </h2>
        <div className="flex items-center gap-2">
          <Badge tone={canSend ? "success" : "warning"}>{canSend ? "SMTP configurado" : "sin proveedor"}</Badge>
          <Button size="sm" disabled={busy || !canSend} onClick={() => void reintentar()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Reintentar pendientes
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {canSend
          ? "Los mensajes se envían al generarse; los que fallen quedan aquí con su error y se pueden reintentar."
          : "Sin WEBFORGE_SMTP_URL los correos no salen: quedan pendientes con su enlace. Configura el SMTP y reintenta."}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {mensajes === null ? (
        <div className="flex items-center gap-2 py-4 text-sm text-ink-muted">
          <Spinner /> Leyendo la bandeja…
        </div>
      ) : mensajes.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No hay mensajes.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {mensajes.slice(0, 12).map((mensaje) => (
            <li key={mensaje.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">{mensaje.subject}</p>
                <p className="truncate text-xs text-ink-muted">{mensaje.recipient}</p>
                {mensaje.error ? <p className="text-xs text-danger">{mensaje.error}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={mensaje.sentAt ? "success" : mensaje.error ? "danger" : "warning"}>
                  {mensaje.sentAt ? "enviado" : mensaje.error ? "falló" : "pendiente"}
                </Badge>
                <span className="text-xs text-ink-faint">{relativeTime(mensaje.sentAt ?? mensaje.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pendientes > 0 ? <p className="mt-2 text-xs text-ink-faint">{pendientes} pendientes de entrega.</p> : null}
    </Card>
  );
}
