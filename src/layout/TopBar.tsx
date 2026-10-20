import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileCode2,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun
} from "lucide-react";
import { useSession } from "../features/auth/SessionContext";
import { useTheme } from "../features/theme/ThemeProvider";
import { SessionBadge } from "../features/auth/SessionBadge";
import { ThemeToggle } from "../features/theme/ThemeToggle";
import { useStores } from "../lib/stores";
import { relativeTime } from "../lib/format";
import { MAX_QUERY_CHARS, MIN_QUERY_CHARS, type SearchResults } from "../features/search/search";

interface TopBarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenMobile: () => void;
}

/** Sin esto se dispararía una petición por tecla. */
const DEBOUNCE_MS = 250;

interface Opcion {
  key: string;
  label: string;
  detail?: string;
  snippet?: string;
  icon: typeof Search;
  run(): void;
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : "La búsqueda no está disponible.";
}

/**
 * Barra superior: buscador global de proyectos y archivos —con el servidor como autoridad—
 * y acciones rápidas. `Ctrl+K` la abre y las flechas mueven la opción activa.
 */
export function TopBar({ collapsed, onToggleCollapse, onOpenMobile }: TopBarProps) {
  const { search: store } = useStores();
  const { esAdmin, salir } = useSession();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activo, setActivo] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = query.trim();
  const busca = term.length >= MIN_QUERY_CHARS;

  // Un término de un carácter no merece ni una llamada: el servidor tampoco miraría.
  useEffect(() => {
    if (!busca) {
      setResults(null);
      setBuscando(false);
      setError(null);
      return;
    }
    if (term.length > MAX_QUERY_CHARS) {
      setResults(null);
      setBuscando(false);
      setError(`La búsqueda no puede superar ${MAX_QUERY_CHARS} caracteres.`);
      return;
    }
    setBuscando(true);
    setError(null);
    let vivo = true;
    const temporizador = window.setTimeout(() => {
      store
        .find(term)
        .then((lista) => {
          if (!vivo) return;
          setResults(lista);
          setBuscando(false);
        })
        .catch((error: unknown) => {
          if (!vivo) return;
          setError(mensaje(error));
          setBuscando(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      vivo = false;
      window.clearTimeout(temporizador);
    };
  }, [store, term, busca]);

  useEffect(() => setActivo(-1), [term, results]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const ir = useCallback(
    (ruta: string) => {
      setOpen(false);
      setQuery("");
      setResults(null);
      navigate(ruta);
    },
    [navigate]
  );

  const acciones = useMemo<Opcion[]>(() => {
    const lista: Opcion[] = [
      {
        key: "nuevo",
        label: "Nuevo proyecto",
        detail: "Crear · /projects",
        icon: Plus,
        run: () => ir("/projects?nuevo=1")
      },
      { key: "proyectos", label: "Ir a proyectos", detail: "/projects", icon: FolderOpen, run: () => ir("/projects") },
      { key: "panel", label: "Ir al panel", detail: "/", icon: LayoutDashboard, run: () => ir("/") },
      { key: "ajustes", label: "Abrir ajustes", detail: "/settings", icon: Settings, run: () => ir("/settings") }
    ];
    if (esAdmin) {
      lista.push({ key: "admin", label: "Panel de administración", detail: "/admin", icon: ShieldCheck, run: () => ir("/admin") });
    }
    lista.push(
      {
        key: "tema",
        label: theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro",
        icon: theme === "dark" ? Sun : Moon,
        run: () => {
          toggleTheme();
          setOpen(false);
        }
      },
      {
        key: "salir",
        label: "Cerrar sesión",
        icon: LogOut,
        run: () => {
          setOpen(false);
          setQuery("");
          void salir();
        }
      }
    );
    const filtro = term.toLowerCase();
    return filtro ? lista.filter((a) => a.label.toLowerCase().includes(filtro)) : lista;
  }, [esAdmin, ir, salir, term, theme, toggleTheme]);

  const proyectos = useMemo<Opcion[]>(
    () =>
      (results?.projects ?? []).map((p) => ({
        key: `proyecto-${p.id}`,
        label: p.name,
        detail: `${p.folder} · ${relativeTime(p.updatedAt)}`,
        icon: FolderOpen,
        run: () => ir(`/projects/${encodeURIComponent(p.id)}`)
      })),
    [ir, results]
  );

  const archivos = useMemo<Opcion[]>(
    () =>
      (results?.files ?? []).map((f) => ({
        key: `archivo-${f.projectId}-${f.path}`,
        label: f.path,
        detail: `${f.projectName} · línea ${f.line}`,
        snippet: f.snippet,
        icon: FileCode2,
        run: () => ir(`/projects/${encodeURIComponent(f.projectId)}/editor?file=${encodeURIComponent(f.path)}`)
      })),
    [ir, results]
  );

  const opciones = [...acciones, ...proyectos, ...archivos];
  const secciones = [
    { titulo: "Acciones rápidas", items: acciones },
    { titulo: "Proyectos", items: proyectos },
    { titulo: "Archivos", items: archivos }
  ].filter((seccion) => seccion.items.length > 0);
  const sinNada = !buscando && !error && opciones.length === 0;

  const teclas = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (opciones.length > 0) {
        const paso = event.key === "ArrowDown" ? 1 : -1;
        setActivo((actual) => (actual + paso + opciones.length) % opciones.length);
      }
      return;
    }
    if (event.key === "Enter") {
      const elegida = opciones[activo] ?? opciones[0];
      if (elegida) {
        event.preventDefault();
        elegida.run();
      }
    }
  };

  const cabecera = (texto: string) => (
    <li role="presentation" className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-ink-faint">
      {texto}
    </li>
  );

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={onOpenMobile}
        aria-label="Abrir menú"
        className="rounded-md p-2 text-ink-muted hover:bg-surface-muted lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
        className="hidden rounded-md p-2 text-ink-muted hover:bg-surface-muted lg:block"
      >
        {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
      </button>

      <div ref={boxRef} className="relative ml-auto w-full max-w-md lg:ml-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={activo >= 0 ? `wf-search-${opciones[activo]?.key}` : undefined}
          aria-label="Buscar proyectos y archivos"
          placeholder="Busca proyectos, archivos o acciones (Ctrl+K)"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={teclas}
          className="h-9 w-full rounded-lg border border-border bg-surface-raised pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint"
        />
        {open ? (
          <div className="absolute inset-x-0 top-11 z-30 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface-raised py-1 shadow-lg">
            <ul id="global-search-results" role="listbox" aria-label="Resultados de la búsqueda">
              {secciones.map((seccion) => (
                <Fragment key={seccion.titulo}>
                  {cabecera(seccion.titulo)}
                  {seccion.items.map((opcion) => {
                    const indice = opciones.indexOf(opcion);
                    return (
                      <li key={opcion.key}>
                        <span
                          id={`wf-search-${opcion.key}`}
                          role="option"
                          aria-selected={indice === activo}
                          className={`block ${indice === activo ? "bg-surface-muted" : ""}`}
                        >
                          <button
                            type="button"
                            onClick={opcion.run}
                            onMouseEnter={() => setActivo(indice)}
                            className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                          >
                            <opcion.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-ink">{opcion.label}</span>
                              {opcion.detail ? (
                                <span className="block truncate text-xs text-ink-faint">{opcion.detail}</span>
                              ) : null}
                            </span>
                          </button>
                          {opcion.snippet ? (
                            <span className="block truncate px-3 pb-1.5 pl-9 font-mono text-xs text-ink-muted">
                              {opcion.snippet}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </Fragment>
              ))}
              {sinNada ? (
                <li role="presentation" className="px-3 py-2 text-sm text-ink-muted">Sin coincidencias para «{term}».</li>
              ) : null}
            </ul>
            {buscando ? <p className="border-t border-border px-3 py-2 text-sm text-ink-muted">Buscando…</p> : null}
            {error ? (
              <p role="alert" className="border-t border-border px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <SessionBadge />
        <div className="lg:hidden">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
