import type { RestoreResult, VersionContent, VersionStore, VersionSummary } from "./versions";
import type { EnvSecret, EnvStore, EnvVariable } from "./env";
import type { EstadoDeJaula, ProjectRun, RunStore } from "./runs";
import type { ProjectSeo, SeoAnalysis, SeoStore } from "./seo";
import type { AnalyticsStore, ProjectAnalytics } from "./analytics";

export const VERSION_FIXTURE: VersionSummary = {
  id: "v1",
  projectId: "p1",
  label: "Antes del cambio",
  createdAt: "2026-03-01T10:00:00.000Z",
  files: 3,
  bytes: 128
};

export const FULL_FIXTURE: VersionContent = { ...VERSION_FIXTURE, content: [{ path: "index.html", content: "hola" }] };

export const RESTORE_FIXTURE: RestoreResult = {
  restored: VERSION_FIXTURE,
  safety: { ...VERSION_FIXTURE, id: "v0", label: "Antes de recuperar «Antes del cambio»" }
};

/** Falso `VersionStore`: solo se reemplazan los métodos que interesan a cada prueba. */
export function fakeVersions(overrides: Partial<VersionStore> = {}): VersionStore {
  const store: VersionStore = {
    list: async () => [VERSION_FIXTURE],
    save: async (_projectId, label) => ({ ...VERSION_FIXTURE, id: "v9", label: label.trim() === "" ? "Versión manual" : label }),
    read: async () => FULL_FIXTURE,
    restore: async () => RESTORE_FIXTURE,
    remove: async () => undefined
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}

export const ENV_FIXTURE: EnvVariable = {
  id: "e1",
  projectId: "p1",
  environment: "desarrollo",
  key: "API_KEY",
  bytes: 10,
  updatedAt: "2026-03-01T10:00:00.000Z"
};

export const ENV_SECRET: EnvSecret = { ...ENV_FIXTURE, value: "sk-privada-123" };

/**
 * Falso `EnvStore`: los secretos no se guardan en el navegador, así que este doble solo
 * devuelve lo que cada prueba haya pedido y sirve para verificar qué llamó la interfaz.
 */
export function fakeEnv(overrides: Partial<EnvStore> = {}): EnvStore {
  const store: EnvStore = {
    list: async () => [ENV_FIXTURE],
    save: async (_projectId, environment, key, value) => ({
      ...ENV_FIXTURE,
      id: `e-${key}`,
      environment,
      key: key.toUpperCase(),
      bytes: value.length
    }),
    reveal: async () => ENV_SECRET,
    remove: async () => undefined
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}

export const RUN_FIXTURE: ProjectRun = {
  id: "r1",
  projectId: "p1",
  tipo: "script",
  archivo: "index.js",
  estado: "terminada",
  codigo: 0,
  senal: null,
  ms: 120,
  salidaBytes: 11,
  truncado: false,
  creadaEn: "2026-03-01T10:00:00.000Z",
  terminadaEn: "2026-03-01T10:00:00.120Z"
};

export const RUN_FALLIDA: ProjectRun = {
  ...RUN_FIXTURE,
  id: "r2",
  estado: "fallida",
  codigo: 1,
  ms: 88,
  salidaBytes: 30
};

export const JAULA_FIXTURE: EstadoDeJaula = {
  disponible: true,
  binario: "bwrap",
  red: false,
  tipos: ["script", "comprobar"],
  limites: { cpuSegundos: 20, ficheroBytes: 2_097_152, tmpfsBytes: 33_554_432, memoriaHeapMB: 512, procesos: 256, descriptores: 256, tiempoRealMs: 30_000, salidaBytes: 65_536 }
};

/**
 * Falso `RunStore`: registra lo que la interfaz pidió para que cada prueba compruebe que no
 * inventó un comando ni envió un entorno que nadie eligió.
 */
export function fakeRuns(overrides: Partial<RunStore> = {}): RunStore {
  const store: RunStore = {
    list: async () => [RUN_FIXTURE, RUN_FALLIDA],
    listAll: async () => [
      { ...RUN_FALLIDA, nombreProyecto: "Blog" },
      { ...RUN_FIXTURE, nombreProyecto: "Mi sitio" }
    ],
    estado: async () => JAULA_FIXTURE,
    launch: async (_projectId, solicitud) => ({
      run: { ...RUN_FIXTURE, id: "r-nueva", tipo: solicitud.tipo, archivo: solicitud.archivo ?? null },
      log: `$ node ${solicitud.archivo ?? ""}\nsalida`
    }),
    log: async () => "$ node index.js\nhola desde la jaula"
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}

export const SEO_FIXTURE: ProjectSeo = {
  projectId: "p1",
  siteUrl: "https://mitienda.dev",
  titleTemplate: "%s · Mi tienda",
  description: "Bicicletas de barrio",
  language: "es",
  ogImage: "/og.png",
  schemaType: "Store",
  noindex: false,
  sitemap: true,
  robotsExtra: "",
  updatedAt: null
};

export const ANALYSIS_FIXTURE: SeoAnalysis = {
  aviso: "Señales calculadas sobre los archivos del proyecto.",
  paginas: [
    {
      path: "index.html",
      titulo: "Inicio · Mi tienda",
      descripcion: "Bicicletas de barrio",
      h1: 1,
      idioma: "es",
      canonical: "https://mitienda.dev",
      noindex: false,
      palabras: 120,
      imagenes: 1,
      imagenesSinAlt: 0,
      enlaces: 2,
      enlacesVacios: 0,
      jsonLd: 1,
      pesoBytes: 4096
    }
  ],
  problemas: [
    { nivel: "aviso", regla: "viewport-falta", mensaje: "Falta la meta viewport.", pagina: "index.html" }
  ],
  duplicados: { titulos: [], descripciones: [] },
  enlacesRotos: [],
  resumen: {
    paginas: 1,
    errores: 0,
    avisos: 1,
    sugerencias: 0,
    conTitulo: 1,
    conDescripcion: 1,
    conH1: 1,
    conJsonLd: 1
  },
  peso: {
    htmlBytes: 4096,
    cssBytes: 1024,
    jsBytes: 512,
    imagenBytes: 2048,
    otrosBytes: 0,
    scripts: 1,
    hojas: 1,
    imagenes: 1,
    imagenesSinDimensiones: 0
  }
};

export function fakeSeo(overrides: Partial<SeoStore> = {}): SeoStore {
  let actual: ProjectSeo = SEO_FIXTURE;
  const store: SeoStore = {
    read: async () => actual,
    save: async (_projectId, patch) => {
      actual = { ...actual, ...patch, updatedAt: "2026-03-09T10:00:00.000Z" };
      return actual;
    },
    generate: async () => ({ files: ["index.html", "sitemap.xml", "robots.txt"], pages: 1 }),
    analysis: async () => ANALYSIS_FIXTURE
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}

export const ANALYTICS_FIXTURE: ProjectAnalytics = {
  projectId: "p1",
  enabled: false,
  measurementId: "",
  trackCta: true,
  trackForms: true,
  thankYouPaths: "",
  updatedAt: null
};

export function fakeAnalytics(overrides: Partial<AnalyticsStore> = {}): AnalyticsStore {
  let actual: ProjectAnalytics = ANALYTICS_FIXTURE;
  const store: AnalyticsStore = {
    read: async () => actual,
    save: async (_projectId, patch) => {
      actual = { ...actual, ...patch, updatedAt: "2026-03-09T10:00:00.000Z" };
      return actual;
    },
    generate: async () => ({ files: ["analytics.js", "index.html"], pages: 1, enabled: actual.enabled })
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}
