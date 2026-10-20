import type { SearchResults, SearchStore } from "./search";

export const SEARCH_FIXTURE: SearchResults = {
  term: "tienda",
  projects: [{ id: "p1", name: "Mi tienda", folder: "Venta", updatedAt: "2026-03-01T10:00:00.000Z" }],
  files: [{ projectId: "p1", projectName: "Mi tienda", path: "index.html", line: 2, snippet: "mi tienda online" }]
};

/** Falso `SearchStore`: solo se reemplaza lo que interesa a cada prueba. */
export function fakeSearch(overrides: Partial<SearchStore> = {}): SearchStore {
  const store: SearchStore = {
    find: async (term) => ({
      term,
      projects: term === "" ? [] : SEARCH_FIXTURE.projects,
      files: term === "" ? [] : SEARCH_FIXTURE.files
    })
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}
