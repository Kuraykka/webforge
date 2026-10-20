import type { FormEvent, ReactNode } from "react";
import { Hammer } from "lucide-react";

/** Marco de las pantallas de acceso: se enseñan antes de tener sesión, sin AppShell. */
export function AuthScreen({
  title,
  description,
  error,
  onSubmit,
  children,
  footer
}: {
  title: string;
  description: string;
  error?: string | null;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <Hammer className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight text-ink">WebForge</span>
        </div>
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {onSubmit ? (
          <form className="mt-4 space-y-3" aria-label={title} onSubmit={onSubmit}>
            {children}
          </form>
        ) : (
          <div className="mt-4 space-y-3">{children}</div>
        )}
        {footer ? <div className="mt-4 text-sm text-ink-muted">{footer}</div> : null}
      </div>
    </main>
  );
}

export const PASSWORD_HINT = "Mínimo 12 caracteres, con letras y números.";
