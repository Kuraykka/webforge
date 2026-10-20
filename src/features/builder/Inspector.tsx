import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Copy, Layers, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Input, Label, Textarea } from "../../components/ui/Field";
import { elementText, outerHtml, parseHtml, type InsertPosition } from "./htmlSource";
import { BUILDER_COMPONENTS, COMPONENT_GROUPS, type BuilderComponent } from "./components";
import { reglasDelBloque, type ReglaDeEstilo } from "./library";
import { EstiloSection, TemaSection } from "./StyleSections";
import type { BuilderAction } from "./sourceEdits";
import { claseDeEstilo, type StyleCommand } from "./styleEdits";

interface InspectorProps {
  /** Fuente HTML actual del archivo abierto: única fuente de verdad. */
  source: string;
  path: string | null;
  onAction: (action: BuilderAction) => void;
  notice: string | null;
  /** Hoja de estilos que carga el documento, o `null` si el proyecto no tiene ninguna. */
  hoja: string | null;
  /** Fuente actual de esa hoja, para enseñar los estilos ya escritos. */
  css: string;
  onStyle: (command: StyleCommand) => void;
  /** Aviso de que un bloque de la paleta empieza o termina su arrastre hacia la vista previa. */
  onPaletteDrag?: (id: string | null) => void;
  /** Bloques que la cuenta guardó, ya convertidos en entradas de la paleta. */
  bloques: BuilderComponent[];
  /** Inserta un bloque de la paleta: el espacio de trabajo decide si sus reglas viajan con él. */
  onInserta: (component: BuilderComponent, path: string, slot: InsertPosition) => void;
  /** Guarda el HTML del elemento seleccionado, con las reglas de sus clases de estilo. */
  onGuardaBloque: (nombre: string, html: string, reglas: ReglaDeEstilo[]) => void;
  /** Quita un bloque de la biblioteca de la cuenta. */
  onQuitaBloque: (id: string) => void;
}

const SLOT_LABELS: Record<InsertPosition, string> = {
  before: "Antes",
  after: "Después",
  "inside-end": "Dentro"
};

export const ARRASTRE_MIME = "application/x-webforge-component";

export function Inspector({
  source,
  path,
  onAction,
  notice,
  hoja,
  css,
  onStyle,
  onPaletteDrag,
  bloques,
  onInserta,
  onGuardaBloque,
  onQuitaBloque
}: InspectorProps) {
  const [className, setClassName] = useState("");
  const [attrName, setAttrName] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [text, setTextDraft] = useState<string | null>(null);
  const [slot, setSlot] = useState<InsertPosition>("inside-end");
  const [avisoPaleta, setAvisoPaleta] = useState<string | null>(null);
  const [nombreBloque, setNombreBloque] = useState("");

  const element = useMemo(() => {
    if (!path) return null;
    return parseHtml(source).byPath.get(path) ?? null;
  }, [path, source]);

  const currentText = useMemo(() => (element ? elementText(source, element) : ""), [element, source]);

  useEffect(() => {
    setTextDraft(null);
  }, [path]);

  const hasElementChildren = element?.children.some((child) => child.kind === "element") ?? false;
  const attributes = element?.attrs ?? [];
  const classes = (attributes.find((attr) => attr.name === "class")?.value ?? "").split(/\s+/).filter(Boolean);
  const clase = claseDeEstilo(classes);

  /** Propiedades de arrastre de un botón de la paleta, iguales para el catálogo y para la biblioteca. */
  const arrastre = (component: BuilderComponent) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      // Viaja en un tipo propio: si lo hiciera como «text/plain», soltar el arrastre
      // sobre CodeMirror escribiría el identificador en mitad del HTML.
      event.dataTransfer.setData(ARRASTRE_MIME, component.id);
      event.dataTransfer.effectAllowed = "copy";
      onPaletteDrag?.(component.id);
    },
    onDragEnd: () => onPaletteDrag?.(null)
  });

  const insert = (component: BuilderComponent) => {
    if (!path) {
      setAvisoPaleta("Arrastra el bloque hasta el hueco de la vista previa o, para colocarlo con un clic, selecciona antes un elemento.");
      return;
    }
    setAvisoPaleta(null);
    // El bloque del catálogo trae su hueco pensado (un separador va después, una rejilla dentro);
    // uno guardado por la cuenta no declara nada, así que va donde el selector diga.
    const elegido = component.group === "biblioteca" ? slot : component.slot;
    setSlot(elegido);
    onInserta(component, path, elegido);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Componentes</h2>
        <p className="mt-1 text-[11px] text-ink-muted">
          {!path
            ? "Arrastra un bloque hasta el hueco de la vista previa; para colocarlo con un clic, selecciona antes un elemento."
            : `Se insertará ${SLOT_LABELS[slot].toLowerCase()} de <${element?.tag ?? "elemento"}>. También puedes arrastrar un bloque hasta el hueco.`}
        </p>
        <div className="mt-2 flex gap-1">
          {(Object.keys(SLOT_LABELS) as InsertPosition[]).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={slot === option ? "primary" : "secondary"}
              disabled={!path}
              onClick={() => setSlot(option)}
            >
              {SLOT_LABELS[option]}
            </Button>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          {COMPONENT_GROUPS.map((group) => (
            <div key={group}>
              <h3 className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                <Layers className="h-3 w-3" aria-hidden /> {group}
              </h3>
              <div className="flex flex-wrap gap-1">
                {BUILDER_COMPONENTS.filter((component) => component.group === group).map((component) => (
                  <Button
                    key={component.id}
                    size="sm"
                    variant={path ? "secondary" : "ghost"}
                    onClick={() => insert(component)}
                    {...arrastre(component)}
                  >
                    {component.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <div role="group" aria-label="Tu biblioteca">
            <h3 className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              <Layers className="h-3 w-3" aria-hidden /> Tu biblioteca
            </h3>
            {bloques.length ? (
              <div className="flex flex-wrap gap-1">
                {bloques.map((component) => (
                  <span key={component.id} className="flex items-center gap-0.5">
                    <Button
                      size="sm"
                      variant={path ? "secondary" : "ghost"}
                      title={component.html.slice(0, 120)}
                      onClick={() => insert(component)}
                      {...arrastre(component)}
                    >
                      {component.label}
                    </Button>
                    <button
                      type="button"
                      onClick={() => onQuitaBloque(component.id)}
                      aria-label={`Quitar el bloque ${component.label}`}
                      className="rounded-md p-1 text-ink-faint hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-ink-faint">Aún no has guardado bloques.</p>
            )}
            {element ? (
              <form
                className="mt-2 flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const nombre = nombreBloque.trim();
                  if (!nombre) return;
                  const recorte = outerHtml(source, element);
                  onGuardaBloque(nombre, recorte, reglasDelBloque(recorte, css));
                  setNombreBloque("");
                }}
              >
                <Label htmlFor="bloque-nombre" className="sr-only">
                  Nombre del bloque
                </Label>
                <Input
                  id="bloque-nombre"
                  value={nombreBloque}
                  onChange={(event) => setNombreBloque(event.target.value)}
                  placeholder={`nombre de <${element.tag}>`}
                  className="h-8 min-w-0 flex-1"
                />
                <Button type="submit" size="sm" variant="secondary" disabled={!nombreBloque.trim()}>
                  Guardar bloque
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-[11px] text-ink-faint">
                Selecciona un elemento en la vista previa para guardarlo como bloque.
              </p>
            )}
          </div>

          {avisoPaleta ? <p className="mt-2 rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning">{avisoPaleta}</p> : null}
        </div>
      </section>

      {notice ? <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">{notice}</p> : null}

      {!element ? (
        <p className="text-xs text-ink-muted">
          Ningún elemento seleccionado. Haz clic en la vista previa (o pulsa un elemento al escribir código) para
          editarlo.
        </p>
      ) : (
        <>
          <section className="border-t border-border pt-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Elemento · <code className="text-ink">&lt;{element.tag}&gt;</code>
            </h2>
            <p className="mt-1 break-all text-[11px] text-ink-faint">ruta {path}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => onAction({ type: "duplicate", path: element.path })}>
                <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicar
              </Button>
              <Button size="sm" variant="danger" onClick={() => onAction({ type: "remove", path: element.path })}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Eliminar
              </Button>
            </div>
          </section>

          <section className="border-t border-border pt-3">
            <Label htmlFor="texto-elemento">Texto</Label>
            {hasElementChildren ? (
              <p className="text-xs text-ink-muted">
                Contiene elementos hijos: edita su texto desde el editor de código.
              </p>
            ) : (
              <>
                <Textarea
                  id="texto-elemento"
                  rows={3}
                  value={text ?? currentText}
                  onChange={(event) => setTextDraft(event.target.value)}
                  placeholder="(sin texto)"
                />
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={(text ?? currentText) === currentText}
                  onClick={() => {
                    onAction({ type: "text", path: element.path, text: (text ?? currentText).trim() });
                    setTextDraft(null);
                  }}
                >
                  Aplicar texto
                </Button>
              </>
            )}
          </section>

          <section className="border-t border-border pt-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Clases</h2>
            {classes.length ? (
              <ul className="flex flex-wrap gap-1">
                {classes.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => onAction({ type: "class-toggle", path: element.path, className: item, add: false })}
                      className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-[11px] text-ink hover:border-danger hover:text-danger"
                      aria-label={`Quitar la clase ${item}`}
                    >
                      .{item} ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-ink-faint">Sin clases.</p>
            )}
            <form
              className="mt-2 flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (!className.trim()) return;
                onAction({ type: "class-toggle", path: element.path, className, add: true });
                setClassName("");
              }}
            >
              <Input
                value={className}
                onChange={(event) => setClassName(event.target.value)}
                placeholder="nueva-clase"
                aria-label="Nueva clase"
                className="h-8 flex-1"
              />
              <Button type="submit" size="sm" variant="secondary">
                Añadir
              </Button>
            </form>
          </section>

          <section className="border-t border-border pt-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Atributos</h2>
            <ul className="space-y-1">
              {attributes.map((attr) => (
                <li key={attr.name} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate font-medium text-ink">{attr.name}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted" title={attr.value}>
                    {attr.value || "(sin valor)"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAction({ type: "remove-attribute", path: element.path, name: attr.name })}
                    className="text-ink-faint hover:text-danger"
                    aria-label={`Quitar el atributo ${attr.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
              {attributes.length === 0 ? <li className="text-[11px] text-ink-faint">Sin atributos.</li> : null}
            </ul>
            <form
              className="mt-2 space-y-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (!attrName.trim()) return;
                onAction({ type: "attribute", path: element.path, name: attrName, value: attrValue });
                setAttrName("");
                setAttrValue("");
              }}
            >
              <div className="flex gap-1">
                <Input
                  value={attrName}
                  onChange={(event) => setAttrName(event.target.value)}
                  placeholder="nombre"
                  aria-label="Nombre del atributo"
                  className="h-8"
                />
                <Input
                  value={attrValue}
                  onChange={(event) => setAttrValue(event.target.value)}
                  placeholder="valor"
                  aria-label="Valor del atributo"
                  className="h-8"
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="w-full">
                Guardar atributo
              </Button>
            </form>
          </section>
        </>
      )}

      {hoja ? (
        <>
          {element ? (
            <EstiloSection
              key={element.path}
              css={css}
              clase={clase}
              onApply={(cambios) => onStyle({ tipo: "elemento", path: element.path, cambios })}
            />
          ) : null}
          <TemaSection css={css} onApply={(selector, cambios) => onStyle({ tipo: "tema", selector, cambios })} />
        </>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-ink-muted">
          El documento no enlaza ninguna hoja de estilos. Crea <code>styles.css</code> para editar colores, márgenes o
          variables del tema.
        </p>
      )}
    </div>
  );
}
