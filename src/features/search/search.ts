import type { ApiClient } from "../../lib/api";

export interface SearchProject {
  id: string;
  name: string;
  folder: string;
  updatedAt: string;
}

export interface SearchFile {
  projectId: string;
  projectName: string;
  path: string;
  line: number;
  snippet: string;
}

export interface SearchResults {
  term: string;
  projects: SearchProject[];
  files: SearchFile[];
}

/** Con esto no se viaja: el servidor tampoco buscaría y la barra no debe parpadear. */
export const MIN_QUERY_CHARS = 2;
/** Mismo tope que impone el servidor: cortar aquí evita un viaje que va a fallar. */
export const MAX_QUERY_CHARS = 120;

export interface SearchStore {
  find(term: string): Promise<SearchResults>;
}

const VACIO = (term: string): SearchResults => ({ term, projects: [], files: [] });

export class HttpSearchStore implements SearchStore {
  constructor(private readonly api: ApiClient) {}

  async find(term: string): Promise<SearchResults> {
    const q = term.trim();
    if (q.length < MIN_QUERY_CHARS) return VACIO(q);
    const results = await this.api.get<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`);
    return { term: results.term, projects: results.projects ?? [], files: results.files ?? [] };
  }
}
