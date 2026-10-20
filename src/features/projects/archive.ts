import type { ApiClient } from "../../lib/api";
import type { Project } from "./types";

/** El servidor rechaza lo que supere este tamaño; avisar antes ahorra una subida condenada. */
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

/** Entrega el contenido al navegador como descarga y limpia la URL temporal. */
function saveToDisk(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = filename;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

/** Baja el ZIP que el servidor arma con los archivos guardados de este proyecto. */
export async function exportProjectZip(
  api: ApiClient,
  project: Pick<Project, "id" | "name">
): Promise<string> {
  const archivo = await api.download(
    `/api/projects/${encodeURIComponent(project.id)}/export`,
    `${project.name}.zip`
  );
  saveToDisk(archivo.bytes, archivo.filename);
  return archivo.filename;
}

/** Sube un ZIP exportado por WebForge y devuelve el proyecto recién creado. */
export async function importProjectZip(api: ApiClient, archivo: File): Promise<Project> {
  if (!/\.zip$/i.test(archivo.name)) {
    throw new Error("El archivo elegido no tiene extensión .zip.");
  }
  if (archivo.size > MAX_IMPORT_BYTES) {
    throw new Error("El ZIP supera los 8 MB que acepta el servidor.");
  }
  const { project } = await api.upload<{ project: Project }>(
    "/api/projects/import",
    archivo,
    "application/zip"
  );
  return project;
}
