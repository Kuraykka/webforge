import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSafePath, normalizePath } from "../../shared/paths.ts";
import { ValidationError } from "../errors.ts";

/**
 * La copia del proyecto dentro de la jaula. No se monta el original: se copia, porque el código del
 * usuario puede escribir, y lo que escriba tiene que quedarse en un sitio privado y temporoal que
 * se borra al terminar. El tope de disco se comprueba antes de crear nada, así una petición grande
 * no deja rastro.
 */
export const MAX_DISCO_JAULA_BYTES = 8 * 1024 * 1024;

export interface ArchivoDeProyecto {
  path: string;
  content: string;
}

export interface TrabajoPreparado {
  dir: string;
  /** Añade un archivo del servidor a la copia; el proyecto original no se toca. */
  escribir: (ruta: string, content: string) => void;
  limpiar: () => void;
}

export interface OpcionesDePreparacion {
  /** Directorio donde se crean las copias (raiz de trabajo del servidor). */
  raiz: string;
  prefijo?: string;
}

function grabar(dir: string, ruta: string, content: string): void {
  const absoluto = join(dir, ruta);
  // join ya no deja salirse: cualquier «..» lo rechazó isSafePath antes de llegar aquí.
  mkdirSync(dirname(absoluto), { recursive: true, mode: 0o700 });
  writeFileSync(absoluto, content, { encoding: "utf8", mode: 0o600 });
}

export async function prepararWorkdir(
  archivos: readonly ArchivoDeProyecto[],
  opciones: OpcionesDePreparacion
): Promise<TrabajoPreparado> {
  const destino = new Map<string, string>();
  let bytes = 0;
  for (const archivo of archivos) {
    if (!isSafePath(archivo.path)) throw new ValidationError(`Ruta de archivo no válida: «${archivo.path}».`);
    const normal = normalizePath(archivo.path);
    destino.set(normal, archivo.content);
    bytes += Buffer.byteLength(archivo.content, "utf8");
  }
  if (bytes > MAX_DISCO_JAULA_BYTES) {
    throw new ValidationError(
      `El proyecto ocupa ${bytes} bytes y la jaula admite hasta ${MAX_DISCO_JAULA_BYTES} de espacio de trabajo.`
    );
  }

  mkdirSync(opciones.raiz, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(opciones.raiz, `${opciones.prefijo ?? "run-"}-`));
  for (const [ruta, content] of destino) grabar(dir, ruta, content);
  return {
    dir,
    escribir: (ruta, content) => {
      if (!isSafePath(ruta)) throw new ValidationError(`Ruta de archivo no válida: «${ruta}».`);
      grabar(dir, normalizePath(ruta), content);
    },
    limpiar: () => rmSync(dir, { recursive: true, force: true })
  };
}
