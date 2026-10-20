import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Hammer,
  LayoutDashboard,
  Palette,
  Settings,
  Shield,
  Wrench,
  X,
  Zap
} from "lucide-react";
import { ThemeToggle } from "../features/theme/ThemeToggle";
import { useSession } from "../features/auth/SessionContext";

export const NAV_ITEMS = [
  { to: "/", label: "Panel", icon: LayoutDashboard, end: true },
  { to: "/projects", label: "Proyectos", icon: Wrench, end: false },
  { to: "/templates", label: "Plantillas", icon: Palette, end: false },
  { to: "/builds", label: "Construcción", icon: Hammer, end: false },
  { to: "/documentacion", label: "Documentación", icon: BookOpen, end: false },
  { to: "/settings", label: "Ajustes", icon: Settings, end: false },
  // Ocultar el enlace es comodidad, no autorización: /api/admin comprueba el rol en cada petición.
  { to: "/admin", label: "Administración", icon: Shield, end: false, adminOnly: true }
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const { esAdmin } = useSession();
  const items = NAV_ITEMS.filter((item) => !("adminOnly" in item) || esAdmin);
  const content = (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center gap-2 border-b border-border ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink">
          <Zap className="h-4 w-4" aria-hidden />
        </span>
        {!collapsed ? (
          <span className="text-sm font-bold tracking-tight text-ink">WebForge</span>
        ) : null}
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Cerrar menú"
          className="ml-auto rounded-md p-1.5 text-ink-muted hover:bg-surface-muted lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Navegación principal">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onCloseMobile}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink"
              }`
            }
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed ? <span className="min-w-0 truncate">{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>

      <div className={`border-t border-border p-2 ${collapsed ? "flex justify-center" : ""}`}>
        <div className={collapsed ? "hidden lg:flex items-center justify-between px-1" : "flex items-center justify-between px-1"}>
          <span className="text-xs text-ink-faint">Apariencia</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Escritorio */}
      <aside
        className={`hidden shrink-0 border-r border-border bg-surface-raised lg:block ${
          collapsed ? "w-16" : "w-60"
        } transition-[width]`}
        aria-label="Barra lateral"
      >
        {content}
      </aside>

      {/* Móvil / tablet: drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onCloseMobile} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface-raised shadow-xl">
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
