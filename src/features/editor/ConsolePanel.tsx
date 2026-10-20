import { AlertTriangle, ChevronDown, ChevronUp, Eraser, Terminal } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PreviewLog } from "./PreviewFrame";

export interface ConsoleEntry extends PreviewLog {
  id: number;
  at: string;
}

interface ConsolePanelProps {
  entries: ConsoleEntry[];
  onClear: () => void;
  open: boolean;
  onToggle: () => void;
}

const LEVEL_CLASS: Record<PreviewLog["level"], string> = {
  log: "text-ink",
  info: "text-accent",
  warn: "text-warning",
  error: "text-danger"
};

export function ConsolePanel({ entries, onClear, open, onToggle }: ConsolePanelProps) {
  const errors = entries.filter((entry) => entry.level === "error").length;

  return (
    <section
      aria-label="Consola"
      className="flex min-h-0 shrink-0 flex-col border-t border-border bg-surface"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
          <Terminal className="h-3.5 w-3.5" aria-hidden />
          Consola
          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-faint">{entries.length}</span>
          {errors > 0 ? (
            <span className="flex items-center gap-1 text-[10px] text-danger">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              {errors}
            </span>
          ) : null}
        </button>
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={onClear} disabled={entries.length === 0} aria-label="Limpiar la consola">
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            Limpiar
          </Button>
        </div>
      </div>

      {open ? (
        <div className="max-h-40 min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-2" role="log" aria-live="polite">
          {entries.length === 0 ? (
            <p className="py-2 text-xs text-ink-faint">
              Sin mensajes. Los `console.log`, avisos y errores de la vista previa aparecen aquí.
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.id} className="flex gap-2 font-mono text-[11px] leading-relaxed">
                  <span className="shrink-0 text-ink-faint">{entry.at}</span>
                  <span className={`shrink-0 uppercase ${LEVEL_CLASS[entry.level]}`}>{entry.level}</span>
                  <span className={`min-w-0 flex-1 break-words ${LEVEL_CLASS[entry.level]}`}>
                    {entry.message}
                    {entry.line > 0 ? <span className="text-ink-faint"> · {entry.origin}:{entry.line}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
