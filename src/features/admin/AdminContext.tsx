import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "../../components/ui/Toast";
import { isApiError } from "../../lib/api";
import type { AdminAccount, AdminApi, AdminEvent, AdminSettings, PlatformMetrics, ServiceStatus } from "./api";

const AdminContext = createContext<AdminApi | null>(null);

/** El cliente de administración se construye una vez con el cliente HTTP común. */
export function AdminProvider({ api, children }: { api: AdminApi; children: ReactNode }) {
  return <AdminContext.Provider value={api}>{children}</AdminContext.Provider>;
}

export function useAdminApi(): AdminApi {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdminApi debe usarse dentro de AdminProvider");
  return ctx;
}

export interface AdminData {
  metrics: PlatformMetrics;
  services: ServiceStatus;
  accounts: AdminAccount[];
  activity: AdminEvent[];
  settings: AdminSettings;
}

export type AdminRun = (action: () => Promise<unknown>, message?: string) => Promise<void>;

export interface AdminState {
  data: AdminData | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** El servidor ha dicho que no hay rol de administración: no hay nada que fingir. */
  forbidden: boolean;
  reload(): Promise<void>;
  run: AdminRun;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ha fallado la operación.";
}

/**
 * Toda la lectura del panel sale del servidor en un único bloque: si una parte falla,
 * el panel lo dice en vez de mezclar datos reales con huecos vacíos.
 */
export function useAdminData(): AdminState {
  const api = useAdminApi();
  const { notify } = useToast();
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [metrics, services, accounts, activity, settings] = await Promise.all([
        api.metrics(),
        api.services(),
        api.users(),
        api.activity(),
        api.settings()
      ]);
      if (!mounted.current) return;
      setData({ metrics, services, accounts, activity, settings });
      setForbidden(false);
    } catch (cause) {
      if (!mounted.current) return;
      setError(messageOf(cause));
      setForbidden(isApiError(cause, 403));
    } finally {
      // Solo la primera lectura deja el panel vacío: revalidar no debe desmontar lo que se está viendo.
      if (mounted.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback<AdminRun>(
    async (action, message) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await reload();
        if (message) notify("success", message);
      } catch (cause) {
        if (mounted.current) setError(messageOf(cause));
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [notify, reload]
  );

  return useMemo(
    () => ({ data, loading, busy, error, forbidden, reload, run }),
    [data, loading, busy, error, forbidden, reload, run]
  );
}
