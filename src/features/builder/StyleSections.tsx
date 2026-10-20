/**
 * Paneles de estilo del constructor. Solo reúnen valores: quien decide qué archivo se escribe es
 * `styleEdits`, así que el HTML acaba con una clase propia (`wf-e1`) y el CSS en la hoja del proyecto.
 */
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { estiloDe } from "./cssSource";
import type { CambiosDeEstilo } from "./styleEdits";

interface Campo {
  css: string;
  label: string;
  pista: string;
}

export const CAMPOS_ESTILO: Campo[] = [
  { css: "color", label: "Color de texto", pista: "#b91c1c" },
  { css: "background-color", label: "Fondo", pista: "#f8fafc" },
  { css: "font-size", label: "Tamaño de letra", pista: "1.25rem" },
  { css: "line-height", label: "Interlineado", pista: "1.5" },
  { css: "padding", label: "Margen interior", pista: "1rem" },
  { css: "margin", label: "Margen exterior", pista: "0 auto" },
  { css: "border", label: "Borde", pista: "1px solid #cbd5e1" },
  { css: "border-radius", label: "Redondeo", pista: "0.5rem" },
  { css: "box-shadow", label: "Sombra", pista: "0 8px 24px rgb(15 23 42 / .08)" },
  { css: "gap", label: "Espaciado", pista: "1rem" }
];

export const CAMPOS_TEMA: Campo[] = [
  { css: "--accent", label: "Acento", pista: "#2563eb" },
  { css: "--ink", label: "Texto base", pista: "#0f172a" },
  { css: "--surface", label: "Fondo de página", pista: "#ffffff" },
  { css: "--line", label: "Líneas", pista: "#e2e8f0" },
  { css: "--radio", label: "Redondeo general", pista: "0.75rem" }
];

const TEMA_CLARO = ":root";
const TEMA_OSCURO = '[data-theme="oscuro"]';

function valoresDe(css: string, selector: string, campos: Campo[]): Record<string, string> {
  if (!selector) return {};
  const regla = estiloDe(css, selector);
  const out: Record<string, string> = {};
  for (const campo of campos) {
    const valor = regla[campo.css];
    if (valor) out[campo.css] = valor;
  }
  return out;
}

/** Solo van rellenos: un campo en blanco significa «no toco esta propiedad». */
function cambiosDe(valores: Record<string, string>, campos: Campo[]): CambiosDeEstilo {
  const cambios: CambiosDeEstilo = {};
  for (const campo of campos) {
    const valor = (valores[campo.css] ?? "").trim();
    if (valor) cambios[campo.css] = valor;
  }
  return cambios;
}

function borrar(campos: Campo[]): CambiosDeEstilo {
  const cambios: CambiosDeEstilo = {};
  for (const campo of campos) cambios[campo.css] = null;
  return cambios;
}

interface FormularioProps {
  id: string;
  campos: Campo[];
  valores: Record<string, string>;
  onValor: (propiedad: string, valor: string) => void;
  onAplicar: (cambios: CambiosDeEstilo) => void;
  textoAplicar: string;
  /** Solo el elemento puede quedarse sin regla: borrar una variable del tema rompería la hoja entera. */
  textoQuitar?: string;
}

function Formulario({
  id,
  campos,
  valores,
  onValor,
  onAplicar,
  textoAplicar,
  textoQuitar
}: FormularioProps) {
  const hayValores = Object.keys(cambiosDe(valores, campos)).length > 0;
  return (
    <div className="mt-2 space-y-2">
      {campos.map((campo) => (
        <div key={campo.css}>
          <Label htmlFor={`wf-${id}-${campo.css}`}>{campo.label}</Label>
          <div className="flex gap-1">
            <Input
              id={`wf-${id}-${campo.css}`}
              value={valores[campo.css] ?? ""}
              placeholder={campo.pista}
              onChange={(event) => onValor(campo.css, event.target.value)}
              className="h-8 flex-1"
            />
            {valores[campo.css] ? (
              <Button size="sm" variant="ghost" onClick={() => onValor(campo.css, "")} aria-label={`Vaciar ${campo.label}`}>
                ×
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={!hayValores} onClick={() => onAplicar(cambiosDe(valores, campos))}>
          {textoAplicar}
        </Button>
        {textoQuitar ? (
          <Button size="sm" variant="secondary" onClick={() => onAplicar(borrar(campos))}>
            {textoQuitar}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface SeccionElementoProps {
  css: string;
  /** Clase `wf-eN` del elemento, o `null` si todavía no tiene estilo propio. */
  clase: string | null;
  onApply: (cambios: CambiosDeEstilo) => void;
}

export function EstiloSection({ css, clase, onApply }: SeccionElementoProps) {
  const [valores, setValores] = useState(() => valoresDe(css, clase ? `.${clase}` : "", CAMPOS_ESTILO));
  return (
    <section className="border-t border-border pt-3" role="group" aria-label="Estilos del elemento">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Estilos{clase ? <code className="ml-1 text-ink">.{clase}</code> : null}
      </h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Se escriben en la hoja del proyecto bajo una clase propia: el resto de elementos no se entera.
      </p>
      <Formulario
        id="elemento"
        campos={CAMPOS_ESTILO}
        valores={valores}
        onValor={(propiedad, valor) => setValores((current) => ({ ...current, [propiedad]: valor }))}
        onAplicar={onApply}
        textoAplicar="Aplicar estilos"
        textoQuitar="Quitar estilos"
      />
    </section>
  );
}

export function TemaSection({ css, onApply }: { css: string; onApply: (selector: string, cambios: CambiosDeEstilo) => void }) {
  const [selector, setSelector] = useState(TEMA_CLARO);
  const [valores, setValores] = useState<Record<string, string>>(() => valoresDe(css, TEMA_CLARO, CAMPOS_TEMA));

  const cambiaTema = (next: string) => {
    setSelector(next);
    setValores(valoresDe(css, next, CAMPOS_TEMA));
  };

  return (
    <section className="border-t border-border pt-3" role="group" aria-label="Variables del tema">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Variables del tema</h2>
      <p className="mt-1 text-[11px] text-ink-muted">
        Colores y redondeos comunes de todo el proyecto. No hace falta seleccionar ningún elemento.
      </p>
      <div className="mt-2 flex gap-1" role="group" aria-label="Tema editado">
        {[{ id: TEMA_CLARO, label: "Claro" }, { id: TEMA_OSCURO, label: "Oscuro" }].map((opcion) => (
          <Button
            key={opcion.id}
            size="sm"
            variant={selector === opcion.id ? "primary" : "secondary"}
            aria-pressed={selector === opcion.id}
            onClick={() => cambiaTema(opcion.id)}
          >
            {opcion.label}
          </Button>
        ))}
      </div>
      <Formulario
        id={`tema-${selector === TEMA_CLARO ? "claro" : "oscuro"}`}
        campos={CAMPOS_TEMA}
        valores={valores}
        onValor={(propiedad, valor) => setValores((current) => ({ ...current, [propiedad]: valor }))}
        onAplicar={(cambios) => onApply(selector, cambios)}
        textoAplicar="Aplicar tema"
      />
    </section>
  );
}
