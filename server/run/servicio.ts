import type { ConfigDeJaula } from "../config.ts";
import { NotFoundError } from "../errors.ts";
import type { Sql } from "../db.ts";
import { normalizePath } from "../../shared/paths.ts";
import { envParaRun } from "../repositories/env.ts";
import { listFiles, readFile } from "../repositories/files.ts";
import { addProjectHistory } from "../repositories/projects.ts";
import { createRun, finishRun, purgarRuns, type ProjectRun } from "../repositories/runs.ts";
import { fuenteDelComprobador } from "./comprobador.ts";
import { prepararWorkdir, type ArchivoDeProyecto, type TrabajoPreparado } from "./preparar.ts";
import { recetaDeRun, RUTA_COMPROBADOR, type SolicitudDeRun } from "./recetas.ts";
import { ejecutarEnJaula, jaulaDisponible, JaulaNoDisponibleError } from "./runner.ts";

/**
 * El recorrido completo de una ejecución: copiar el proyecto, lanzarlo en la jaula y anotar el
 * resultado. Es síncrona de principio a fin porque no hay demonio que consulte después: la petición
 * HTTP se queda abierta hasta que el proceso cierra, y ese reloj es también lo que lo detiene.
 */
export interface PeticionDeRun {
  ownerUserId: string;
  projectId: string;
  solicitud: SolicitudDeRun;
  /** Si se pide, sus variables del entorno declarado entran en el proceso. */
  entorno?: string;
}

export interface DependenciasDeRun {
  db: Sql;
  jaula: ConfigDeJaula;
  /** Clave para descifrar las variables que se inyectan en la jaula. */
  envKey: Buffer;
}

export interface RunTerminado {
  run: ProjectRun;
  log: string;
}

function archivosDelProyecto(db: Sql, ownerUserId: string, projectId: string): ArchivoDeProyecto[] {
  const salida: ArchivoDeProyecto[] = [];
  for (const entrada of listFiles(db, ownerUserId, projectId)) {
    const archivo = readFile(db, ownerUserId, projectId, entrada.path);
    if (archivo) salida.push({ path: archivo.path, content: archivo.content });
  }
  return salida;
}

/** La cabecera dice qué corrió; el resto es la salida tal cual la produjo el proceso. */
function cuaderno(cmd: readonly string[], salida: string, truncado: boolean, motivo?: string): string {
  const lineas = [`$ ${cmd.join(" ")}`, salida];
  if (truncado) lineas.push("[la salida superó el tope declarado y se cortó]");
  if (motivo !== undefined) lineas.push(`[no se pudo ejecutar: ${motivo}]`);
  return lineas.join("\n").trimEnd();
}

export async function ejecutarSolicitud(deps: DependenciasDeRun, peticion: PeticionDeRun): Promise<RunTerminado> {
  const { db, jaula, envKey } = deps;
  // Se comprueba antes de abrir la fila: un servidor sin jaula no deja ni historial de intentos.
  if (!jaulaDisponible(jaula.bin)) throw new JaulaNoDisponibleError();
  const archivos = archivosDelProyecto(db, peticion.ownerUserId, peticion.projectId);
  const cmd = recetaDeRun(peticion.solicitud, archivos);
  const archivo =
    peticion.solicitud.tipo === "script" && peticion.solicitud.archivo !== undefined
      ? normalizePath(peticion.solicitud.archivo)
      : undefined;
  const entorno = peticion.entorno === undefined ? {} : envParaRun(db, peticion.projectId, peticion.entorno, envKey);

  const inicio = new Date().toISOString();
  const run = createRun(db, {
    projectId: peticion.projectId,
    ownerUserId: peticion.ownerUserId,
    tipo: peticion.solicitud.tipo,
    ...(archivo === undefined ? {} : { archivo }),
    now: inicio
  });

  let trabajo: TrabajoPreparado | undefined;
  try {
    trabajo = await prepararWorkdir(archivos, { raiz: jaula.raiz, prefijo: run.id });
    // El comprobador es código del servidor, no del proyecto: se escribe en la copia y solo para
    // esta ejecución. Nadie lo puede sustituir guardando un archivo con ese nombre.
    if (peticion.solicitud.tipo === "comprobar") trabajo.escribir(RUTA_COMPROBADOR, fuenteDelComprobador());
    const dentro = await ejecutarEnJaula(
      { workdir: trabajo.dir, cmd, env: entorno },
      jaula.limites,
      { bin: jaula.bin }
    );
    const estado = dentro.agotado ? "cancelada" : dentro.codigo === 0 ? "terminada" : "fallida";
    const log = cuaderno(cmd, dentro.salida, dentro.truncado);
    const cerrada = finishRun(db, peticion.ownerUserId, run.id, {
      estado,
      codigo: dentro.codigo,
      senal: dentro.senal,
      ms: dentro.ms,
      log,
      truncado: dentro.truncado,
      now: new Date().toISOString()
    });
    if (!cerrada) throw new NotFoundError("No existe esa ejecución.");
    addProjectHistory(db, peticion.projectId, `Ejecución ${peticion.solicitud.tipo} ${estado} (${dentro.ms} ms)`);
    purgarRuns(db, peticion.projectId);
    return { run: cerrada, log };
  } catch (cause) {
    // La fila abierta bloquea el proyecto hasta que se cierre: aquí se cierra con el motivo.
    const motivo = cause instanceof Error ? cause.message : String(cause);
    finishRun(db, peticion.ownerUserId, run.id, {
      estado: "fallida",
      codigo: null,
      senal: null,
      ms: Date.now() - Date.parse(inicio),
      log: cuaderno(cmd, "", false, motivo),
      truncado: false,
      now: new Date().toISOString()
    });
    throw cause;
  } finally {
    trabajo?.limpiar();
  }
}
