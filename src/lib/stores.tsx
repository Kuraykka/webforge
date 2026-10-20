import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./api";
import { HttpFileStore } from "../features/files/httpStorage";
import { HttpProjectStore } from "../features/projects/httpStorage";
import { HttpVersionStore } from "../features/projects/versions";
import { HttpEnvStore } from "../features/projects/env";
import { HttpSeoStore } from "../features/projects/seo";
import { HttpAnalyticsStore } from "../features/projects/analytics";
import { HttpRunStore } from "../features/projects/runs";
import { HttpSearchStore } from "../features/search/search";
import { HttpComponentStore } from "../features/builder/library";
import type { FileStore } from "../features/files/storage";
import type { ProjectStore } from "../features/projects/storage";
import type { VersionStore } from "../features/projects/versions";
import type { EnvStore } from "../features/projects/env";
import type { SeoStore } from "../features/projects/seo";
import type { AnalyticsStore } from "../features/projects/analytics";
import type { RunStore } from "../features/projects/runs";
import type { SearchStore } from "../features/search/search";
import type { ComponentStore } from "../features/builder/library";

export interface AppStores {
  projects: ProjectStore;
  files: FileStore;
  versions: VersionStore;
  env: EnvStore;
  seo: SeoStore;
  analytics: AnalyticsStore;
  search: SearchStore;
  /** Bloques que la cuenta guardó con el constructor. */
  components: ComponentStore;
  /** Ejecuciones del proyecto dentro del aislamiento del servidor. */
  runs: RunStore;
}

/** Datos de verdad: el navegador ya no es la base de datos de la plataforma. */
export function createHttpStores(api: ApiClient): AppStores {
  return {
    projects: new HttpProjectStore(api),
    files: new HttpFileStore(api),
    versions: new HttpVersionStore(api),
    env: new HttpEnvStore(api),
    seo: new HttpSeoStore(api),
    analytics: new HttpAnalyticsStore(api),
    search: new HttpSearchStore(api),
    components: new HttpComponentStore(api),
    runs: new HttpRunStore(api)
  };
}

const StoresContext = createContext<AppStores | null>(null);

export function StoresProvider({ stores, children }: { stores: AppStores; children: ReactNode }) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

export function useStores(): AppStores {
  const ctx = useContext(StoresContext);
  if (!ctx) throw new Error("useStores debe usarse dentro de StoresProvider");
  return ctx;
}
