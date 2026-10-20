/**
 * La forma del documento que genera el servidor (`server/docs/api.ts`). Aquí solo se lee:
 * el detalle de cada ruta lo escribe el propio servidor, no una copia mantenida a mano.
 */
export interface Esquema {
  type?: string;
  format?: string;
  description?: string;
  items?: Esquema;
  properties?: Record<string, Esquema>;
  additionalProperties?: Esquema | boolean;
  required?: string[];
}

export interface ParametroDoc {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Esquema;
}

export interface OperacionDoc {
  summary: string;
  description: string;
  tags: string[];
  "x-acceso": string;
  "x-sin-documentar"?: boolean;
  parameters?: ParametroDoc[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Esquema }> };
  responses: Record<string, { description: string }>;
}

export interface DocumentoApi {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, OperacionDoc>>;
}

export interface RutaDocumentada {
  clave: string;
  ruta: string;
  metodo: string;
  operacion: OperacionDoc;
}

export function rutasDelDocumento(doc: DocumentoApi): RutaDocumentada[] {
  const salida: RutaDocumentada[] = [];
  for (const [ruta, operaciones] of Object.entries(doc.paths)) {
    for (const [metodo, operacion] of Object.entries(operaciones)) {
      salida.push({ clave: `${metodo.toUpperCase()} ${ruta}`, ruta, metodo, operacion });
    }
  }
  return salida;
}

export interface CampoDoc {
  nombre: string;
  tipo: string;
  descripcion: string;
  requerido: boolean;
}

function tipoDel(esquema: Esquema | undefined): string {
  if (esquema === undefined) return "valor";
  if (esquema.format === "binary") return "binario";
  if (esquema.type === "array") return `lista de ${tipoDel(esquema.items)}`;
  if (esquema.type === "object" && esquema.additionalProperties !== undefined) return "mapa";
  const base = esquema.type ?? "valor";
  return base === "string" ? "texto" : base === "integer" ? "entero" : base === "boolean" ? "booleano" : base;
}

/** Los campos del cuerpo, leídos del JSON Schema que declara el documento. */
export function camposDelCuerpo(operacion: OperacionDoc): { contenido: string; campos: CampoDoc[] } | null {
  const content = operacion.requestBody?.content;
  if (!content) return null;
  const [contenido, medio] = Object.entries(content)[0] ?? [];
  const schema = medio?.schema;
  if (contenido === undefined || schema === undefined) return null;
  const obligados = new Set(schema.required ?? []);
  const campos = Object.entries(schema.properties ?? {}).map(([nombre, valor]) => ({
    nombre,
    tipo: tipoDel(valor),
    descripcion: valor.description ?? "",
    requerido: obligados.has(nombre)
  }));
  // Un cuerpo binario no trae propiedades: se dice lo que es, no lo que contiene.
  return { contenido, campos };
}
