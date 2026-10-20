import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./api";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/**
 * Lo que no cabe en un almacén de datos —bajar y subir ficheros— usa el mismo cliente
 * que el resto de la aplicación: misma cookie de sesión y misma cabecera anti-CSRF.
 */
export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi debe usarse dentro de ApiProvider");
  return api;
}
