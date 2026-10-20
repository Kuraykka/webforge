import { LogOut } from "lucide-react";
import { useSession } from "./SessionContext";

/** El correo solo llega cuando el servidor confirma la cookie, así que nunca se pinta antes de tiempo. */
export function SessionBadge() {
  const { user, salir } = useSession();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold uppercase text-ink-muted"
      >
        {user.email.slice(0, 1)}
      </span>
      <span className="hidden max-w-[18ch] truncate text-sm text-ink-muted md:inline" title={user.email}>
        {user.email}
      </span>
      <button
        type="button"
        onClick={() => void salir()}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        Salir
      </button>
    </div>
  );
}
