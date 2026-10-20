import type { ComponentStore, SavedComponent } from "./library";

export const BLOQUE_FIXTURE: SavedComponent = {
  id: "c1",
  name: "Tarjeta propia",
  html: '<article class="card"><h3>Tarjeta propia</h3></article>',
  reglas: [{ selector: ".wf-e1", cambios: { color: "#b30000" } }],
  bytes: 51,
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-02T10:00:00.000Z"
};

/**
 * Falso `ComponentStore` con memoria propia: la biblioteca la crea el usuario durante la prueba,
 * así que hace falta que lo guardado siga estando al leer la lista, como haría el servidor.
 */
export function fakeComponents(overrides: Partial<ComponentStore> = {}): ComponentStore {
  const fondo: SavedComponent[] = [];
  const ahora = new Date("2026-03-03T10:00:00.000Z").toISOString();
  const store: ComponentStore = {
    list: async () => [...fondo].sort((a, b) => a.name.localeCompare(b.name, "es")),
    create: async ({ name, html, reglas }) => {
      const item: SavedComponent = {
        id: `c${String(fondo.length + 1)}`,
        name: name.replace(/\s+/g, " ").trim(),
        html,
        reglas: reglas ?? [],
        bytes: html.length,
        createdAt: ahora,
        updatedAt: ahora
      };
      fondo.push(item);
      return item;
    },
    update: async (id, patch) => {
      const actual = fondo.find((item) => item.id === id);
      if (!actual) throw new Error("No existe ese bloque.");
      const next: SavedComponent = {
        ...actual,
        name: patch.name?.trim() ?? actual.name,
        html: patch.html ?? actual.html,
        reglas: patch.reglas ?? actual.reglas,
        bytes: (patch.html ?? actual.html).length,
        updatedAt: new Date("2026-03-04T10:00:00.000Z").toISOString()
      };
      fondo[fondo.indexOf(actual)] = next;
      return next;
    },
    remove: async (id) => {
      const index = fondo.findIndex((item) => item.id === id);
      if (index === -1) throw new Error("No existe ese bloque.");
      fondo.splice(index, 1);
    }
  };
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in overrides ? (overrides as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}
