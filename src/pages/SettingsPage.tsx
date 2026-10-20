import { useState } from "react";
import { Moon, Sun, Trash2 } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/Modal";
import { useToast } from "../components/ui/Toast";
import { useTheme } from "../features/theme/ThemeProvider";
import { useProjects } from "../features/projects/ProjectsContext";
import { AccountPanel } from "../features/auth/AccountPanel";
import { AccountUsage } from "../features/auth/AccountUsage";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { projects, remove } = useProjects();
  const { notify } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteAll = async () => {
    try {
      for (const project of projects) await remove(project.id);
      notify("success", "Todos tus proyectos han sido eliminados.");
    } catch (e) {
      notify("error", e instanceof Error ? e.message : "No se pudo completar la limpieza.");
    } finally {
      setConfirmOpen(false);
    }
  };

  const optionClass = (active: boolean) =>
    `flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium ${
      active ? "border-accent bg-accent/10 text-accent" : "border-border bg-surface text-ink hover:bg-surface-muted"
    }`;

  return (
    <div>
      <PageHeader title="Ajustes" description="Tu cuenta, la apariencia y los datos guardados en la plataforma." />

      <div className="space-y-4">
        <AccountPanel />

        <AccountUsage revision={projects.length} />

        <Card>
          <h2 className="text-sm font-semibold text-ink">Apariencia</h2>
          <p className="mt-1 text-sm text-ink-muted">
            El cambio es instantáneo y se guarda en este dispositivo.
          </p>
          <div className="mt-3 flex gap-3" role="radiogroup" aria-label="Tema de la interfaz">
            <button
              type="button"
              role="radio"
              aria-checked={theme === "light"}
              onClick={() => setTheme("light")}
              className={optionClass(theme === "light")}
            >
              <Sun className="h-5 w-5" aria-hidden /> Claro
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === "dark"}
              onClick={() => setTheme("dark")}
              className={optionClass(theme === "dark")}
            >
              <Moon className="h-5 w-5" aria-hidden /> Oscuro
            </button>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">Datos de la cuenta</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {projects.length} {projects.length === 1 ? "proyecto guardado" : "proyectos guardados"} en la base de
            datos del servidor. Eliminarlos quita también sus archivos e historiales.
          </p>
          <div className="mt-3">
            <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)} disabled={projects.length === 0}>
              <Trash2 className="h-4 w-4" aria-hidden /> Eliminar todos los proyectos
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">Estado de la plataforma</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
            <li>· Fases 1 a 10 completadas: arquitectura y navegación, tema claro/oscuro, cuentas con verificación de
              correo obligatoria, usuario además del correo, 2FA TOTP, sesiones y roles, administración con IPs y
              actividad, proyectos y archivos en la base de datos, editor, constructor visual, plantillas, ejecuciones
              aisladas, SEO por proyecto y analítica GA4 con consentimiento.</li>
            <li>· Para entrar hay que confirmar el correo con un enlace de tres minutos; tres contraseñas fallidas
              cierran la cuenta 24 horas y la administración puede levantarlo desde su panel.</li>
            <li>· El correo sale por SMTP si se configura; si no, los enlaces se quedan en la bandeja del servidor,
              donde administración puede verlos y reintentar el envío.</li>
            <li>· No se simula lo que no existe: hosting y despliegues necesitan un proveedor real, instalar
              dependencias requiere red en la jaula y el correo externo necesita configurar SMTP.</li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">Proyecto y licencia</h2>
          <p className="mt-2 text-sm text-ink-muted">
            WebForge fue creado por Kuraykka y se publica con licencia MIT: puedes usarlo, modificarlo y
            distribuirlo, incluso comercialmente, conservando el aviso de copyright y la licencia.
          </p>
          <p className="mt-2 text-sm">
            <a
              className="text-accent hover:underline"
              href="https://github.com/Kuraykka/webforge"
              target="_blank"
              rel="noreferrer"
            >
              Repositorio en GitHub
            </a>
            <span className="text-ink-faint"> · </span>
            <a
              className="text-accent hover:underline"
              href="https://github.com/Kuraykka/webforge/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              Licencia MIT
            </a>
          </p>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Eliminar todos los proyectos"
        message={`Se eliminarán ${projects.length} ${projects.length === 1 ? "proyecto" : "proyectos"} con sus archivos e historiales. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar todo"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void deleteAll()}
      />
    </div>
  );
}
