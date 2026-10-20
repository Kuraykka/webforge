import { spawn, spawnSync } from "node:child_process";
import { DomainError } from "../errors.ts";
import { argvDeJaula, JAULA, type LimitesDeJaula, type PeticionDeJaula } from "./jail.ts";

/** No hay jaula: el código del proyecto no se ejecuta en el proceso del servidor. */
export class JaulaNoDisponibleError extends DomainError {
  constructor() {
    super(
      "Este servidor no tiene aislamiento disponible (falta «bwrap»). El código de un proyecto solo " +
        "se ejecuta dentro de la jaula, así que la ejecución se detiene aquí.",
      503
    );
    this.name = "JaulaNoDisponibleError";
  }
}

const jaulaComprobada = new Map<string, boolean>();

/** Se comprueba una sola vez por ejecutable: `bwrap --version` es barato y el host no cambia. */
export function jaulaDisponible(bin: string = JAULA): boolean {
  const cached = jaulaComprobada.get(bin);
  if (cached !== undefined) return cached;
  const disponible = spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0;
  jaulaComprobada.set(bin, disponible);
  return disponible;
}

export interface OpcionesDeEjecucion {
  /** Ejecutable de la jaula declarado en la configuración. */
  bin?: string;
  /** Llega mientras se produce, para quien quiera mostrar la salida en vivo. */
  onSalida?: (trozo: string) => void;
}

export interface ResultadoDeJaula {
  codigo: number | null;
  senal: string | null;
  salida: string;
  /** Se descartó salida por pasar del tope declarado. */
  truncado: boolean;
  /** El reloj real mató la jaula antes de que terminara. */
  agotado: boolean;
  ms: number;
}

/**
 * Ejecuta un comando dentro de la jaula y devuelve su salida acotada. La jaula es un proceso hijo:
 * al matarlo se apaga también su namespace de procesos, porque `bwrap` es el pid 1 de dentro.
 */
export async function ejecutarEnJaula(
  peticion: PeticionDeJaula,
  limites: LimitesDeJaula,
  opciones: OpcionesDeEjecucion = {}
): Promise<ResultadoDeJaula> {
  const bin = opciones.bin ?? JAULA;
  if (!jaulaDisponible(bin)) throw new JaulaNoDisponibleError();
  const inicio = Date.now();
  const trozos: string[] = [];
  let bytes = 0;
  let truncado = false;
  let agotado = false;

  return await new Promise<ResultadoDeJaula>((resolver, rechazar) => {
    const hijo = spawn(bin, argvDeJaula(peticion, limites), { stdio: ["ignore", "pipe", "pipe"] });
    const reloj = setTimeout(() => {
      agotado = true;
      hijo.kill("SIGKILL");
    }, limites.tiempoRealMs);

    const acumular = (pedazo: Buffer): void => {
      if (truncado) return;
      const texto = pedazo.toString("utf8");
      if (bytes + texto.length > limites.salidaBytes) {
        const libre = limites.salidaBytes - bytes;
        if (libre > 0) {
          trozos.push(texto.slice(0, libre));
          opciones.onSalida?.(texto.slice(0, libre));
        }
        truncado = true;
        return;
      }
      bytes += texto.length;
      trozos.push(texto);
      opciones.onSalida?.(texto);
    };
    hijo.stdout.on("data", acumular);
    hijo.stderr.on("data", acumular);
    hijo.on("error", (cause) => {
      clearTimeout(reloj);
      rechazar(cause instanceof Error && "code" in cause && cause.code === "ENOENT" ? new JaulaNoDisponibleError() : cause);
    });
    hijo.on("close", (codigo, senal) => {
      clearTimeout(reloj);
      resolver({
        codigo,
        senal,
        salida: trozos.join(""),
        truncado,
        agotado,
        ms: Date.now() - inicio
      });
    });
  });
}
