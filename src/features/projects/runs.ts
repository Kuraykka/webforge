import type { ApiClient } from "../../lib/api";
import type { BadgeTone } from "../../components/ui/Card";

/**
 * Ejecuciones del proyecto en el servidor. La orden nunca es un comando: se pide un tipo y, si
 * toca, el archivo y el entorno cuyas variables se inyectan. Lo que corre lo decide el servidor.
 */
export type RunEstado = "corriendo" | "terminada" | "fallida" | "cancelada";
export type RunTipo = "script" | "comprobar";

export const RUN_TIPOS: { id: RunTipo; label: string; descripcion: string }[] = [
  { id: "script", label: "Script del proyecto", descripcion: "Ejecuta un archivo .js, .mjs o .cjs con node." },
  { id: "comprobar", label: "Comprobar el proyecto", descripcion: "Sintaxis y estructura de los archivos, sin ejecutar nada." }
];

export const RUN_ESTADO_LABELS: Record<RunEstado, string> = {
  corriendo: "En curso",
  terminada: "Terminada",
  fallida: "Fallida",
  cancelada: "Cortada por tiempo"
};

/** Con qué color se lee cada estado, para que el historial del editor y el de la cuenta coincidan. */
export const RUN_ESTADO_TONO: Record<RunEstado, BadgeTone> = {
  terminada: "success",
  fallida: "danger",
  cancelada: "warning",
  corriendo: "accent"
};

export interface ProjectRun {
  id: string;
  projectId: string;
  tipo: string;
  archivo: string | null;
  estado: RunEstado;
  codigo: number | null;
  senal: string | null;
  ms: number | null;
  salidaBytes: number;
  truncado: boolean;
  creadaEn: string;
  terminadaEn: string | null;
}

export interface SolicitudDeRun {
  tipo: RunTipo;
  archivo?: string;
  entorno?: string;
}

export interface RunLanzada {
  run: ProjectRun;
  log: string;
}

/** Lo de un proyecto, pero con el nombre que lo identifica cuando se ve mezclado con los demás. */
export interface CuentaRun extends ProjectRun {
  nombreProyecto: string;
}

export interface LimitesDeJaula {
  cpuSegundos: number;
  ficheroBytes: number;
  tmpfsBytes: number;
  memoriaHeapMB: number;
  procesos: number;
  descriptores: number;
  tiempoRealMs: number;
  salidaBytes: number;
}

/** Lo que el servidor puede afirmar de su aislamiento: qué ejecutable usa y hasta dónde llega. */
export interface EstadoDeJaula {
  disponible: boolean;
  binario: string;
  /** `false` es lo normal: la jaula sale sin red y por eso no se pueden instalar dependencias. */
  red: boolean;
  tipos: string[];
  limites: LimitesDeJaula;
}

export interface RunStore {
  list(projectId: string): Promise<ProjectRun[]>;
  /** Las ejecuciones de todos los proyectos de la cuenta, de la más nueva a la más antigua. */
  listAll(): Promise<CuentaRun[]>;
  estado(): Promise<EstadoDeJaula>;
  launch(projectId: string, solicitud: SolicitudDeRun): Promise<RunLanzada>;
  log(projectId: string, runId: string): Promise<string>;
}

interface ListPayload {
  runs: ProjectRun[];
}

interface EstadoPayload {
  jaula: EstadoDeJaula;
}

interface RunPayload {
  run: ProjectRun;
  log: string;
}

function ref(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/runs${suffix}`;
}

export class HttpRunStore implements RunStore {
  constructor(private readonly api: ApiClient) {}

  async list(projectId: string): Promise<ProjectRun[]> {
    return (await this.api.get<ListPayload>(ref(projectId))).runs;
  }

  async listAll(): Promise<CuentaRun[]> {
    return (await this.api.get<{ runs: CuentaRun[] }>("/api/runs")).runs;
  }

  async estado(): Promise<EstadoDeJaula> {
    return (await this.api.get<EstadoPayload>("/api/runs/estado")).jaula;
  }

  /** La petición se queda abierta hasta que el proceso cierra: aquí no hay que ir consultando. */
  async launch(projectId: string, solicitud: SolicitudDeRun): Promise<RunLanzada> {
    return await this.api.post<RunPayload>(ref(projectId), solicitud);
  }

  async log(projectId: string, runId: string): Promise<string> {
    const payload = await this.api.get<RunPayload>(ref(projectId, `/${encodeURIComponent(runId)}`));
    return payload.log;
  }
}
