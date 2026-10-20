/** Errores de dominio: su mensaje es seguro para el cliente. Lo demás se registra, no se responde. */
export class DomainError extends Error {
  readonly status: number;
  /** Campos extra que el cliente necesita leer junto al mensaje, como `verificationRequired`. */
  readonly campos: Record<string, unknown>;

  constructor(message: string, status = 400, campos: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.campos = campos;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Credenciales insuficientes.") {
    super(message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "No tienes permiso para esta acción.", campos?: Record<string, unknown>) {
    super(message, 403, campos ?? {});
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "No existe el recurso.") {
    super(message, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class RateLimitedError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = "Demasiados intentos.") {
    super(message, 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
