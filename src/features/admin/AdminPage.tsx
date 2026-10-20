import { RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card, EmptyState, Spinner } from "../../components/ui/Card";
import { PageHeader } from "../../pages/PageHeader";
import { AdminAccounts } from "./AdminAccounts";
import { AdminConfig } from "./AdminConfig";
import { useAdminData } from "./AdminContext";
import { AdminActivity, AdminStatus } from "./AdminStatus";
import { AdminOutbox } from "./AdminOutbox";

/**
 * Panel de administración: todos los datos y todas las decisiones de permiso vienen del
 * servidor. Aquí no se calcula nada local que pueda sustituir esa comprobación.
 */
export function AdminPage() {
  const { data, loading, busy, error, forbidden, reload, run } = useAdminData();

  return (
    <div>
      <PageHeader
        title="Administración"
        description="Cuentas, cuotas, configuración y estado de los servicios."
        actions={
          <Button onClick={() => void reload()} disabled={busy || loading}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Actualizar
          </Button>
        }
      />

      <div className="space-y-4">
        {loading ? (
          <Card>
            <div className="flex items-center gap-2 text-sm text-ink-muted">
              <Spinner /> Leyendo el estado del servidor…
            </div>
          </Card>
        ) : null}

        {forbidden && !loading ? (
          <EmptyState
            icon={<ShieldAlert className="h-6 w-6" aria-hidden />}
            title="Sin acceso a la administración"
            description={error ?? "Hace falta un rol de administración."}
          />
        ) : null}

        {!forbidden && error ? (
          <Card className="border-danger/40">
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          </Card>
        ) : null}

        {data ? (
          <>
            <AdminStatus metrics={data.metrics} services={data.services} />
            <AdminOutbox canSend={data.services.mail.status === "smtp"} />
            <AdminAccounts accounts={data.accounts} busy={busy} run={run} />
            <AdminConfig settings={data.settings} busy={busy} run={run} />
            <AdminActivity events={data.activity} />
          </>
        ) : null}
      </div>
    </div>
  );
}
