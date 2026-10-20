/**
 * Biblioteca de bloques de la cuenta. Lo que se guarda es HTML tal cual: el constructor no tiene
 * un modelo paralelo, así que un bloque reutilizado se inserta en el archivo como cualquier otro.
 * Las clases de estilo (`wf-eN`) que usa ese HTML viajan con sus reglas, leídas de la hoja del
 * proyecto donde se creó: sin ellas el bloque reutilizado llegaría sin pintar nada.
 */
import type { ApiClient } from "../../lib/api";
import { BuilderEditError, parseHtml } from "./htmlSource";
import {
  esClaseDeEstilo,
  escribirEstilo,
  estiloDe,
  parseCss,
  siguienteClaseDeEstilo,
  type ReglaDeEstilo
} from "./cssSource";
import type { BuilderComponent, InsertSlot } from "./components";

export type { ReglaDeEstilo };

export interface SavedComponent {
  id: string;
  name: string;
  html: string;
  reglas: ReglaDeEstilo[];
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewComponent {
  name: string;
  html: string;
  reglas?: ReglaDeEstilo[];
}

export interface ComponentStore {
  list(): Promise<SavedComponent[]>;
  create(input: NewComponent): Promise<SavedComponent>;
  update(id: string, patch: Partial<NewComponent>): Promise<SavedComponent>;
  remove(id: string): Promise<void>;
}

interface ListPayload {
  components: SavedComponent[];
}

interface ComponentPayload {
  component: SavedComponent;
}

const url = (id?: string) => `/api/components${id ? `/${encodeURIComponent(id)}` : ""}`;

export class HttpComponentStore implements ComponentStore {
  constructor(private readonly api: ApiClient) {}

  async list(): Promise<SavedComponent[]> {
    return (await this.api.get<ListPayload>(url())).components;
  }

  async create(input: NewComponent): Promise<SavedComponent> {
    return (await this.api.post<ComponentPayload>(url(), input)).component;
  }

  async update(id: string, patch: Partial<NewComponent>): Promise<SavedComponent> {
    return (await this.api.put<ComponentPayload>(url(id), patch)).component;
  }

  async remove(id: string): Promise<void> {
    await this.api.remove(url(id));
  }
}

/**
 * Las marcas del constructor son índices entre hermanos: arrastrarlas dentro de un bloque
 * guardado pondría al bloque a señalar una ruta que no existe en el documento de destino.
 */
const MARCAS = /\s+data-wf-[A-Za-z0-9_-]+=(?:"[^"]*"|'[^']*')/g;

/** Un bloque guardado es un botón más de la paleta; siempre va donde apunta la selección. */
export function bloquesDeBiblioteca(items: SavedComponent[]): BuilderComponent[] {
  return items.map((item) => ({
    id: item.id,
    label: item.name,
    group: "biblioteca" satisfies BuilderComponent["group"],
    slot: "inside-end" satisfies InsertSlot,
    html: item.html.replace(MARCAS, ""),
    reglas: item.reglas
  }));
}

/** `.wf-e3` es la clase de estilo `wf-e3`; cualquier otro selector no es del constructor. */
function claseDeSelector(selector: string): string | null {
  const clase = /^\.([A-Za-z0-9_-]+)$/.exec(selector)?.[1];
  return clase !== undefined && esClaseDeEstilo(clase) ? clase : null;
}

function clasesDeEstiloEn(html: string): Set<string> {
  const vistas = new Set<string>();
  for (const element of parseHtml(html).byPath.values()) {
    const valor = element.attrs.find((attr) => attr.name === "class")?.value ?? "";
    for (const clase of valor.split(/\s+/).filter(Boolean)) {
      if (esClaseDeEstilo(clase)) vistas.add(clase);
    }
  }
  return vistas;
}

/**
 * Las reglas que escriben las clases del recorte, en el orden en que están en la hoja. Se dejan
 * fuera las compuestas (`.tarjeta .wf-e1`): esas son de la página, no del bloque.
 */
export function reglasDelBloque(html: string, css: string): ReglaDeEstilo[] {
  const usadas = clasesDeEstiloEn(html);
  if (usadas.size === 0) return [];
  const salida: ReglaDeEstilo[] = [];
  for (const rule of parseCss(css).rules) {
    const clase = claseDeSelector(rule.selector);
    if (clase === null || !usadas.has(clase)) continue;
    const cambios = estiloDe(css, rule.selector);
    if (Object.keys(cambios).length > 0) salida.push({ selector: rule.selector, cambios });
  }
  return salida;
}

/**
 * Vuelca las reglas del bloque en la hoja de estilo del proyecto destino. Solo se aceptan clases
 * del constructor: reutilizar un bloque no puede reescribir la regla de `body` de otra persona.
 */
export function aplicaReglasDelBloque(css: string, reglas: ReglaDeEstilo[]): string {
  let salida = css;
  for (const regla of reglas) {
    if (claseDeSelector(regla.selector) === null) {
      throw new BuilderEditError(`«${regla.selector}» no es una clase de estilo del constructor (wf-eN).`);
    }
    salida = escribirEstilo(salida, regla.selector, regla.cambios);
  }
  return salida;
}

export interface BloqueDeBiblioteca {
  html: string;
  reglas: ReglaDeEstilo[];
}

/** Reescribe los valores de `class` del recorte, dejando el resto del texto tal como estaba. */
function cambiaClases(fragmento: string, mapa: Map<string, string>): string {
  const ops: { from: number; to: number; text: string }[] = [];
  for (const element of parseHtml(fragmento).byPath.values()) {
    const attr = element.attrs.find((item) => item.name === "class");
    if (!attr) continue;
    const texto = attr.value.replace(/\S+/g, (clase) => mapa.get(clase) ?? clase);
    if (texto !== attr.value) ops.push({ from: attr.valueStart, to: attr.valueEnd, text: texto });
  }
  let salida = fragmento;
  for (const op of ops.sort((a, b) => b.from - a.from)) {
    salida = `${salida.slice(0, op.from)}${op.text}${salida.slice(op.to)}`;
  }
  return salida;
}

/**
 * `wf-e3` significa «el elemento que el constructor estiló en su proyecto», y en el destino puede
 * estar cogido por otro. Los nombres ocupados se renuevan a la vez en el HTML y en las reglas, así
 * que insertar un bloque nunca reestiliza a un elemento ajeno.
 */
export function preparaBloque(bloque: BloqueDeBiblioteca, destino: { html: string; css: string }): BloqueDeBiblioteca {
  const delBloque = clasesDeEstiloEn(bloque.html);
  for (const regla of bloque.reglas) {
    const clase = claseDeSelector(regla.selector);
    if (clase !== null) delBloque.add(clase);
  }
  const ocupadas = clasesDeEstiloEn(destino.html);
  for (const rule of parseCss(destino.css).rules) {
    const clase = claseDeSelector(rule.selector);
    if (clase !== null) ocupadas.add(clase);
  }

  const mapa = new Map<string, string>();
  const libres = new Set<string>();
  for (const clase of delBloque) {
    if (ocupadas.has(clase)) continue;
    mapa.set(clase, clase);
    libres.add(clase);
  }
  for (const clase of delBloque) {
    if (!ocupadas.has(clase)) continue;
    const nueva = siguienteClaseDeEstilo([...ocupadas, ...libres]);
    libres.add(nueva);
    mapa.set(clase, nueva);
  }
  if ([...delBloque].every((clase) => mapa.get(clase) === clase)) return bloque;
  return {
    html: cambiaClases(bloque.html, mapa),
    reglas: bloque.reglas.map((regla) => {
      const clase = claseDeSelector(regla.selector);
      const nueva = clase === null ? undefined : mapa.get(clase);
      return nueva === undefined || nueva === clase ? regla : { selector: `.${nueva}`, cambios: regla.cambios };
    })
  };
}
