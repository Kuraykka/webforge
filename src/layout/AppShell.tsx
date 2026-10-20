import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui/Card";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const COLLAPSE_KEY = "webforge.sidebar.collapsed";
/** Editor y vista previa necesitan todo el alto y el ancho disponibles. */
const IMMERSIVE = /^\/projects\/[^/]+\/(editor|preview)$/;

export function AppShell() {
  const location = useLocation();
  const immersive = IMMERSIVE.test(location.pathname);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* preferencia no persistible */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle("overflow-hidden", mobileOpen);
    return () => document.body.classList.remove("overflow-hidden");
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <main
          className={
            immersive
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex-1 overflow-y-auto px-4 py-5 sm:px-6"
          }
        >
          <div className={immersive ? "flex min-h-0 flex-1 flex-col" : "mx-auto w-full max-w-6xl"}>
            {/* Las pantallas pesadas llegan en su propio módulo: mientras tanto hay que decir algo.
                El `Spinner` ya es la región que avisa; el texto solo se ve. */}
            <Suspense
              fallback={
                <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
                  <Spinner /> Llegando la pantalla…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
