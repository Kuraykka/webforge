import type { ReactNode } from "react";
import { BarChart3, CloudOff, Database, Mail, Server, Watch } from "lucide-react";
import { Badge, Card } from "../../components/ui/Card";
import { formatBytes, relativeTime } from "../../lib/format";
import type { AdminEvent, PlatformMetrics, ServiceStatus } from "./api";

const ACTION_LABELS: Record<string, string> = {
  "usuario.rol_cambiado": "Rol cambiado",
  "usuario.suspendido": "Cuenta suspendida",
  "usuario.reactivado": "Cuenta reactivada",
  "usuario.eliminado": "Cuenta eliminada",
  "configuracion.actualizada": "Configuración actualizada"
};

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink">{value}</dd>
      {hint ? <dd className="text-xs text-ink-faint">{hint}</dd> : null}
    </div>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-sm text-ink-muted">{title}</span>
      <span className="flex flex-wrap items-baseline justify-end gap-2 text-sm text-ink">{children}</span>
    </li>
  );
}

const STATUS_LABELS = { borrador: "borrador", en_desarrollo: "en desarrollo", listo: "listo" } as const;

/** Lo que la plataforma es ahora mismo: cifras de uso y estado real de cada servicio. */
export function AdminStatus({ metrics, services }: { metrics: PlatformMetrics; services: ServiceStatus }) {
  const estado = metrics.projects.byStatus;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <h2 className="text-sm font-semibold text-ink">Métricas de uso</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Cuentas" value={metrics.accounts.total} hint={`${metrics.accounts.admins} de administración`} />
          <Stat
            label="Proyectos"
            value={metrics.projects.total}
            hint={Object.entries(STATUS_LABELS)
              .map(([key, label]) => `${estado[key as keyof typeof estado]} ${label}`)
              .join(" · ")}
          />
          <Stat label="Archivos" value={metrics.files.total} hint={formatBytes(metrics.files.bytes)} />
          <Stat label="Sesiones abiertas" value={metrics.sessions.active} />
          <Stat label="Cuentas confirmadas" value={metrics.accounts.verified} hint={`${metrics.accounts.suspended} suspendidas`} />
          <Stat label="Eventos registrados" value={metrics.activity.events} />
        </dl>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink">Estado de los servicios</h2>
        <ul className="mt-3 space-y-2.5">
          <Row title="Base de datos">
            <Badge tone={services.database.writable ? "success" : "danger"}>
              {services.database.writable ? "escribe y lee" : "sin escritura"}
            </Badge>
            <Database className="h-4 w-4 text-ink-faint" aria-hidden />
            <span className="break-all text-xs text-ink-faint">{services.database.file}</span>
          </Row>
          <Row title="Correo">
            <Badge tone={services.mail.status === "smtp" ? "success" : "warning"}>{services.mail.status}</Badge>
            <Mail className="h-4 w-4 text-ink-faint" aria-hidden />
          </Row>
          <Row title="Bandeja local">
            <Watch className="h-4 w-4 text-ink-faint" aria-hidden />
            {services.outbox.pending} mensajes pendientes
          </Row>
          <Row title="Proceso">
            <Server className="h-4 w-4 text-ink-faint" aria-hidden />
            <span className="text-xs">{services.app.env}</span>
            <span className="text-xs text-ink-faint">{services.app.node}</span>
            <span className="text-xs text-ink-faint">{services.app.uptimeSeconds} s en marcha</span>
          </Row>
          <Row title="Analítica">
            <Badge tone={metrics.analytics.enabledProjects > 0 ? "accent" : "neutral"}>
              {metrics.analytics.enabledProjects} {metrics.analytics.enabledProjects === 1 ? "proyecto con GA4" : "proyectos con GA4"}
            </Badge>
            <BarChart3 className="h-4 w-4 text-ink-faint" aria-hidden />
          </Row>
          <Row title="Hosting y dominios">
            <Badge tone="warning">sin proveedor</Badge>
            <CloudOff className="h-4 w-4 text-ink-faint" aria-hidden />
          </Row>
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
          Sin proveedor de correo ni de hosting: los enlaces se quedan en la bandeja del servidor y la plataforma no
          simula despliegues ni dominios. La analítica solo se carga en los sitios generados con consentimiento.
        </p>
      </Card>
    </div>
  );
}

export function AdminActivity({ events }: { events: AdminEvent[] }) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Actividad administrativa</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Todavía no hay ninguna operación de administración registrada.</p>
      ) : (
        <ul aria-label="Actividad administrativa" className="mt-3 space-y-3">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{ACTION_LABELS[event.action] ?? event.action}</p>
                <p className="text-xs text-ink-muted">{event.actorEmail}</p>
                {event.detail ? <p className="text-xs text-ink-faint">{event.detail}</p> : null}
              </div>
              <span className="text-xs text-ink-faint">{relativeTime(event.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
