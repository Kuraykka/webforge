import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let fuente: string | undefined;

/**
 * El comprobador viaja como texto dentro de la copia del proyecto: la jaula no ve el código del
 * servidor, solo Node y lo que hay en `/proyecto`. Se lee una vez y se reutiliza.
 * La ruta se saca del módulo en curso porque `new URL('./x', import.meta.url)` lo reescribe Vite.
 */
export function fuenteDelComprobador(): string {
  if (fuente === undefined) fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "comprobar.mjs"), "utf8");
  return fuente;
}
