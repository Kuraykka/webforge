export class StorageUnavailableError extends Error {
  constructor() {
    super("El almacenamiento local no está disponible en este navegador.");
    this.name = "StorageUnavailableError";
  }
}

export class QuotaExceededError extends Error {
  constructor() {
    super("No hay espacio suficiente en el almacenamiento local.");
    this.name = "QuotaExceededError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`El proyecto ${id} ya no existe.`);
    this.name = "ProjectNotFoundError";
  }
}

export function assertStorage(storage: Storage): void {
  try {
    storage.setItem("webforge.probe", "1");
    storage.removeItem("webforge.probe");
  } catch {
    throw new StorageUnavailableError();
  }
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export function writeJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    if (isQuotaError(error)) throw new QuotaExceededError();
    throw error;
  }
}

export function readJson<T>(storage: Storage, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
