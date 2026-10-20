export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "webforge";

/** Error de la API: el mensaje siempre viene del servidor y es seguro para mostrar. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  /** Cuerpo de la respuesta: además de `error` puede traer campos que la pantalla debe leer. */
  readonly payload: unknown;

  constructor(
    status: number,
    message: string,
    retryAfterSeconds: number | null = null,
    payload: unknown = undefined
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.payload = payload;
  }
}

/** Campo extra del cuerpo de error, con el tipo justo para leerlo desde una pantalla. */
export function errorFlag(error: unknown, name: string): boolean {
  return (error as { payload?: Record<string, unknown> } | null)?.payload?.[name] === true;
}

export interface RequestInfo {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers: Record<string, string>;
  /** Un ZIP entra crudo: `File`/`Blob` convive con el JSON de siempre. */
  body?: string | Blob;
  credentials: "same-origin" | "include";
}

export type FetchLike = (path: string, init: RequestInfo) => Promise<Response>;

export interface DownloadedFile {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  /** Algunas borradas piden una confirmación escrita; el cuerpo es opcional. */
  remove(path: string, body?: unknown): Promise<void>;
  download(path: string, fallbackName: string): Promise<DownloadedFile>;
  upload<T>(path: string, body: Blob, contentType: string): Promise<T>;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  0: "No se pudo conectar con el servidor.",
  400: "La petición no tiene el formato esperado.",
  401: "Inicia sesión para continuar.",
  403: "No tienes permiso para esta acción.",
  404: "No existe el recurso.",
  409: "Ya existe ese recurso.",
  429: "Demasiados intentos. Espera antes de reintentar.",
  500: "Error interno del servidor."
};

export function isApiError(error: unknown, status?: number): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  return status === undefined || error.status === status;
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

function errorMessage(response: Response, payload: unknown): string {
  const error = (payload as { error?: unknown } | undefined)?.error;
  if (typeof error === "string" && error.trim() !== "") return error;
  return FALLBACK_MESSAGES[response.status] ?? "Ha fallado la petición.";
}

const browserFetch: FetchLike = (path, init) => fetch(path, init);

/** `attachment; filename="tienda.zip"` → `tienda.zip`, sin dejar que una cabecera mueva rutas. */
function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const raw = /filename="?([^";]+)"?/i.exec(header)?.[1]?.trim();
  if (!raw) return null;
  const limpio = (raw.replace(/\\/g, "/").split("/").pop() ?? "").replace(/"/g, "");
  return limpio === "" ? null : limpio;
}

export function createApiClient(fetchImpl: FetchLike = browserFetch): ApiClient {
  async function send(init: RequestInfo, path: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(path, init);
    } catch {
      throw new ApiError(0, FALLBACK_MESSAGES[0]!);
    }
    if (!response.ok) {
      const payload = await readPayload(response);
      throw new ApiError(response.status, errorMessage(response, payload), retryAfter(response), payload);
    }
    return response;
  }

  async function call<T>(method: RequestInfo["method"], path: string, body?: unknown): Promise<T> {
    const withBody = body !== undefined;
    const init: RequestInfo = {
      method,
      headers: {
        [CSRF_HEADER]: CSRF_VALUE,
        ...(withBody ? { "content-type": "application/json" } : {})
      },
      credentials: "same-origin",
      ...(withBody ? { body: JSON.stringify(body) } : {})
    };

    const response = await send(init, path);
    if (response.status === 204) return undefined as T;
    return (await readPayload(response)) as T;
  }

  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, body: unknown = {}) => call<T>("POST", path, body),
    put: <T>(path: string, body: unknown = {}) => call<T>("PUT", path, body),
    patch: <T>(path: string, body: unknown = {}) => call<T>("PATCH", path, body),
    remove: (path: string, body?: unknown) => call<void>("DELETE", path, body),

    /** Bajar un archivo: el cuerpo es binario, así que no pasa por `readPayload`. */
    async download(path: string, fallbackName: string): Promise<DownloadedFile> {
      const response = await send(
        { method: "GET", headers: { [CSRF_HEADER]: CSRF_VALUE }, credentials: "same-origin" },
        path
      );
      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        filename: dispositionName(response.headers.get("content-disposition")) ?? fallbackName
      };
    },

    /** Subir un fichero elegido por el usuario: viaja crudo, con el tipo que declare la interfaz. */
    async upload<T>(path: string, body: Blob, contentType: string): Promise<T> {
      const response = await send(
        {
          method: "POST",
          headers: { [CSRF_HEADER]: CSRF_VALUE, "content-type": contentType },
          credentials: "same-origin",
          body
        },
        path
      );
      return (await readPayload(response)) as T;
    }
  };
}
