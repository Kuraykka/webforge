import { extname, isSafePath, normalizePath } from "../../shared/paths.ts";
import { ValidationError } from "../errors.ts";

/**
 * Lo único que puede correr dentro de la jaula. El cliente no manda un comando: manda un tipo y,
 * como mucho, un archivo del proyecto. Si aquí no hay receta, no hay ejecución.
 */
export const TIPOS_DE_RUN = ["script", "comprobar"] as const;
export type TipoDeRun = (typeof TIPOS_DE_RUN)[number];

export interface SolicitudDeRun {
  tipo: string;
  archivo?: string;
}

/** Comprobador del servidor, inyectado en la copia: lo escribe `servicio.ts`, no el usuario. */
export const RUTA_COMPROBADOR = ".webforge/comprobar.mjs";

const EXTENSIONES_JS = ["js", "mjs", "cjs"];

export function recetaDeRun(solicitud: SolicitudDeRun, archivos: readonly { path: string }[]): string[] {
  if (!(TIPOS_DE_RUN as readonly string[]).includes(solicitud.tipo)) {
    throw new ValidationError(`No se conoce el tipo de ejecución «${solicitud.tipo}».`);
  }
  if (solicitud.tipo === "comprobar") return ["node", RUTA_COMPROBADOR];

  const pedido = solicitud.archivo;
  if (pedido === undefined || pedido.trim() === "") {
    throw new ValidationError("Indica el archivo del proyecto que quieres ejecutar.");
  }
  if (!isSafePath(pedido)) throw new ValidationError(`Ruta de archivo no válida: «${pedido}».`);
  const ruta = normalizePath(pedido);
  if (!EXTENSIONES_JS.includes(extname(ruta))) {
    throw new ValidationError("Solo se ejecutan archivos JavaScript (.js, .mjs, .cjs).");
  }
  if (!archivos.some((archivo) => normalizePath(archivo.path) === ruta)) {
    throw new ValidationError(`El archivo «${ruta}» no existe en el proyecto.`);
  }
  return ["node", ruta];
}
