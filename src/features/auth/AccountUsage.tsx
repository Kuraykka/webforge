import { useEffect, useState } from "react";
import { Card, Spinner } from "../../components/ui/Card";
import { formatBytes } from "../../lib/format";
import { useSession } from "./SessionContext";
import type { AccountUsage as Usage } from "./api";

/**
 * El uso y la cuota salen del servidor: el navegador no lleva la cuenta de lo que ocupa
 * cada cuenta, solo lee y muestra lo que pregunta.
 */
export function AccountUsage({ revision = 0 }: { revision?: number }) {
  const { auth } = useSession();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setUsage(null);
    setError(null);
    auth
      .usage()
      .then((dato) => {
        if (vivo) setUsage(dato);
      })
      .catch((cause: unknown) => {
        if (vivo) setError(cause instanceof Error ? cause.message : "No se pudo leer el uso de la cuenta.");
      });
    return () => {
      vivo = false;
    };
  }, [auth, revision]);

  const total = usage?.maxProjectsPerUser ?? 0;
  const usados = usage?.projects ?? 0;
  const porcentaje = total > 0 ? Math.min(100, Math.round((usados / total) * 100)) : 0;

  return (
    <Card role="region" aria-label="Uso de la cuenta" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Uso de la cuenta</h2>
        <p className="text-xs text-ink-faint">Medido por el servidor</p>
      </div>

      {usage ? (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink" aria-label="Lo que ocupa la cuenta">
            <li>
              {usage.projects} {usage.projects === 1 ? "proyecto" : "proyectos"}
            </li>
            <li>
              {usage.files} {usage.files === 1 ? "archivo" : "archivos"}
            </li>
            <li>{formatBytes(usage.bytes)}</li>
          </ul>

          <div
            role="progressbar"
            aria-label="Proyectos de la cuenta sobre su cuota"
            aria-valuenow={usage.projects}
            aria-valuemin={0}
            aria-valuemax={usage.maxProjectsPerUser}
            aria-valuetext={`${usage.projects} de ${usage.maxProjectsPerUser} proyectos`}
          >
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${porcentaje}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-ink-muted">
              {usage.projects} de {usage.maxProjectsPerUser} proyectos · {formatBytes(usage.maxBytesPerProject)} por
              proyecto
            </p>
          </div>
        </>
      ) : error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Midiendo…
        </div>
      )}
    </Card>
  );
}
