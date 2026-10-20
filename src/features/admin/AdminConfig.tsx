import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { formatBytes } from "../../lib/format";
import { useAdminApi, type AdminRun } from "./AdminContext";
import type { AdminSettings } from "./api";

function cambiosDe(base: AdminSettings, draft: AdminSettings): Partial<AdminSettings> {
  const patch: Partial<AdminSettings> = {};
  if (draft.allowRegistration !== base.allowRegistration) patch.allowRegistration = draft.allowRegistration;
  if (draft.maxProjectsPerUser !== base.maxProjectsPerUser) patch.maxProjectsPerUser = draft.maxProjectsPerUser;
  if (draft.maxBytesPerProject !== base.maxBytesPerProject) patch.maxBytesPerProject = draft.maxBytesPerProject;
  return patch;
}

interface Props {
  settings: AdminSettings;
  busy: boolean;
  run: AdminRun;
}

export function AdminConfig({ settings, busy, run }: Props) {
  const api = useAdminApi();
  const [draft, setDraft] = useState(settings);
  // Valores del servidor que ya se han admitido en el formulario.
  const [conocidos, setConocidos] = useState(settings);

  // La configuración del servidor manda, pero solo cuando cambia: cada lectura llega como un
  // objeto nuevo, y reaccionar a la identidad borraría lo que se está escribiendo en un refresco.
  useEffect(() => {
    if (Object.keys(cambiosDe(conocidos, settings)).length === 0) return;
    setConocidos(settings);
    setDraft(settings);
  }, [conocidos, settings]);

  const cambios = cambiosDe(conocidos, draft);
  const limpio = Object.keys(cambios).length === 0;

  const numeroDe = (value: string): number | null => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  const guardar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (limpio) return;
    void run(() => api.updateSettings(cambios), "Configuración guardada.");
  };

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">Configuración general</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Afecta a todas las cuentas: quién puede registrarse y cuánto puede ocupar cada una.
      </p>

      <form onSubmit={guardar} className="mt-3 space-y-4">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            checked={draft.allowRegistration}
            onChange={(event) => setDraft({ ...draft, allowRegistration: event.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium text-ink">Permitir auto-registro</span>
            <span className="block text-xs text-ink-muted">
              Cerrado: solo la administración puede crear cuentas desde este panel.
            </span>
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="max-proyectos">Proyectos por cuenta</Label>
            <Input
              id="max-proyectos"
              type="number"
              min={1}
              step={1}
              value={draft.maxProjectsPerUser}
              onChange={(event) => {
                const value = numeroDe(event.target.value);
                if (value !== null) setDraft({ ...draft, maxProjectsPerUser: value });
              }}
            />
          </div>
          <div>
            <Label htmlFor="max-bytes">Bytes por proyecto</Label>
            <Input
              id="max-bytes"
              type="number"
              min={1024}
              step={1024}
              value={draft.maxBytesPerProject}
              onChange={(event) => {
                const value = numeroDe(event.target.value);
                if (value !== null) setDraft({ ...draft, maxBytesPerProject: value });
              }}
            />
            <p className="mt-1 text-xs text-ink-faint">
              Equivale a {formatBytes(draft.maxBytesPerProject)} por proyecto, incluida la administración.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={limpio || busy}>
            Guardar cambios
          </Button>
          {!limpio ? <span className="text-xs text-ink-faint">Se enviará solo lo modificado.</span> : null}
        </div>
      </form>
    </Card>
  );
}
