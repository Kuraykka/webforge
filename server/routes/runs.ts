import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireAuth, requireUser, type AppDependencies } from "../app.ts";
import { fields, requireText, takeText } from "../http/body.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { getProject } from "../repositories/projects.ts";
import { getRun, listRuns, listRunsDeCuenta, runLog } from "../repositories/runs.ts";
import { TIPOS_DE_RUN } from "../run/recetas.ts";
import { jaulaDisponible } from "../run/runner.ts";
import { ejecutarSolicitud } from "../run/servicio.ts";

function textParam(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new ValidationError(`Falta el identificador ${label}.`);
  return value;
}

export function registerRunRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const { db, config } = deps;

  function scoped(request: FastifyRequest) {
    const owner = requireUser(request).id;
    const projectId = textParam((request.params as { id?: unknown }).id, "del proyecto");
    if (!getProject(db, owner, projectId)) throw new NotFoundError("No existe ese proyecto.");
    return { owner, projectId };
  }

  app.get("/api/runs", { preHandler: requireAuth }, async (request) => {
    const owner = requireUser(request).id;
    return { runs: listRunsDeCuenta(db, owner) };
  });

  /**
   * El estado real del aislamiento, para que la interfaz pueda decir lo que puede hacer en vez de
   * prometer un terminal. Lo que se copia en `config.jaula.raiz` es un dato del host y no sale.
   */
  app.get("/api/runs/estado", { preHandler: requireAuth }, async () => {
    const { limites } = config.jaula;
    return {
      jaula: {
        disponible: jaulaDisponible(config.jaula.bin),
        binario: config.jaula.bin,
        red: limites.red,
        tipos: [...TIPOS_DE_RUN],
        limites: {
          cpuSegundos: limites.cpuSegundos,
          ficheroBytes: limites.ficheroBloques * 512,
          tmpfsBytes: limites.tmpfsBytes,
          memoriaHeapMB: limites.memoriaHeapMB,
          procesos: limites.procesos,
          descriptores: limites.descriptores,
          tiempoRealMs: limites.tiempoRealMs,
          salidaBytes: limites.salidaBytes
        }
      }
    };
  });

  app.get("/api/projects/:id/runs", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    return { runs: listRuns(db, owner, projectId) };
  });

  app.get("/api/projects/:id/runs/:runId", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const runId = textParam((request.params as { runId?: unknown }).runId, "de la ejecución");
    const run = getRun(db, owner, runId);
    if (!run || run.projectId !== projectId) throw new NotFoundError("No existe esa ejecución.");
    return { run, log: runLog(db, owner, runId) ?? "" };
  });

  /**
   * Lanza la receta y espera: la respuesta trae el resultado cerrado, no un id que haya que
   * ir consultando. El proceso corre en la jaula y su salida se guarda comprimida.
   */
  app.post("/api/projects/:id/runs", { preHandler: requireAuth }, async (request) => {
    const { owner, projectId } = scoped(request);
    const body = fields(request.body);
    const tipo = requireText(body, "tipo");
    const archivo = takeText(body, "archivo");
    const entorno = takeText(body, "entorno");
    return await ejecutarSolicitud({ db, jaula: config.jaula, envKey: config.envKey }, {
      ownerUserId: owner,
      projectId,
      solicitud: { tipo, ...(archivo === undefined ? {} : { archivo }) },
      ...(entorno === undefined ? {} : { entorno })
    });
  });
}
