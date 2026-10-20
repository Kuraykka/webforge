import { existsSync } from "node:fs";

/**
 * Jaula para ejecutar código de proyectos ajenos. La premisa: el proceso de la aplicación nunca
 * ejecuta el código del usuario, sino un `bwrap` que le quita la red, el sistema de ficheros del
 * host y las capacidades del namespace, y le deja escribir solo dentro de una copia del proyecto.
 * Los topes de cpu, tamaño de fichero y volcado los pone `ulimit` dentro de la jaula; el reloj
 * real y el tope de salida los pone quien llama (`runner.ts`), porque `bwrap` no los conoce.
 */

/** Carpetas del host que se montan de solo lectura. `/` nunca: daría la raiz entera. */
export const RAICES_POR_DEFECTO = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;

/** Nombre de la copia del proyecto dentro de la jaula. */
export const DESTINO_POR_DEFECTO = "/proyecto";

export interface LimitesDeJaula {
  /** Segundos de cpu por proceso (RLIMIT_CPU): a la segunda señal SIGKILL. */
  cpuSegundos: number;
  /** Bloques de 512 bytes por fichero escrito (RLIMIT_FSIZE). */
  ficheroBloques: number;
  /** Bytes del tmpfs que hace de `/tmp`. */
  tmpfsBytes: number;
  /** Procesos e hilos del usuario de la jaula (RLIMIT_NPROC): un fork bomb no se come el host. */
  procesos: number;
  /** Tope del montón de V8 dentro de la jaula (--max-old-space-size). */
  memoriaHeapMB: number;
  /** Descriptores abiertos por proceso (RLIMIT_NOFILE). */
  descriptores: number;
  /** Milisegundos de reloj real antes de matar la jaula entera. */
  tiempoRealMs: number;
  /** Bytes máximo de stdout+stderr que se retiene. */
  salidaBytes: number;
  /** `true` abre la red del host: solo para una petición explícita y confirmada. */
  red: boolean;
}

export interface PeticionDeJaula {
  /** Directorio del host con la copia del proyecto. */
  workdir: string;
  /** Comando e interprete, como lista: nunca se interpola en una shell. */
  cmd: readonly string[];
  /** Variables que se introducen; el resto del entorno del servidor queda fuera. */
  env: Readonly<Record<string, string>>;
  /** Donde se monta `workdir` dentro de la jaula. */
  destino?: string;
}

const ENTORNO_BASE: readonly (readonly [string, string])[] = [
  ["PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
  ["HOME", "/tmp"],
  ["TMPDIR", "/tmp"],
  ["LANG", "C.UTF-8"]
];

export function argvDeJaula(
  peticion: PeticionDeJaula,
  limites: LimitesDeJaula,
  raices: readonly string[] = RAICES_POR_DEFECTO
): string[] {
  const destino = peticion.destino ?? DESTINO_POR_DEFECTO;
  const argv = ["--unshare-all", "--unshare-pid", "--die-with-parent", "--cap-drop", "ALL"];
  if (!limites.red) argv.push("--unshare-net");
  else argv.push("--share-net");
  for (const raiz of raices) {
    if (esCarpetaNecesaria(raiz)) argv.push("--ro-bind", raiz, raiz);
  }
  argv.push("--dev", "/dev", "--proc", "/proc");
  argv.push("--size", String(limites.tmpfsBytes), "--tmpfs", "/tmp");
  argv.push("--bind", peticion.workdir, destino, "--chdir", destino);
  argv.push("--clearenv");
  for (const [clave, valor] of ENTORNO_BASE) argv.push("--setenv", clave, valor);
  for (const [clave, valor] of Object.entries(peticion.env)) argv.push("--setenv", clave, valor);
  // El `-c` lleva solo los `ulimit` y un `exec "$@"`; el comando viaja como argumentos aparte.
  // RLIMIT_AS rompería Node (V8 reserva enormes rangos virtuales): el montón se limita en V8.
  const envoltorio =
    `ulimit -t ${limites.cpuSegundos}; ulimit -f ${limites.ficheroBloques}; ulimit -c 0; ` +
    `ulimit -u ${limites.procesos}; ulimit -n ${limites.descriptores}; ` +
    `export NODE_OPTIONS="--max-old-space-size=${limites.memoriaHeapMB}"; exec "$@"`;
  argv.push("--", "/bin/bash", "-c", envoltorio, "bash", ...peticion.cmd);
  return argv;
}

/** `/etc` puede faltar en un host con `/etc` dentro de `/usr`; montar lo que no existe reventaría. */
function esCarpetaNecesaria(raiz: string): boolean {
  return raiz !== "/" && existsSync(raiz);
}

/** `bwrap` es la única jaula: sin ella no se ejecuta nada, tampoco «como hasta ahora». */
export const JAULA = "bwrap";
