import { LocalStorageFileStore } from "../features/files/storage";
import { fakeAnalytics, fakeEnv, fakeRuns, fakeSeo, fakeVersions } from "../features/projects/test-support";
import { fakeSearch } from "../features/search/test-support";
import { fakeComponents } from "../features/builder/test-support";
import { LocalStorageProjectStore } from "../features/projects/storage";
import type { AppStores } from "../lib/stores";

/** Almacén de prueba: mismo contrato que `window.localStorage`, sin depender de jsdom. */
export class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

/**
 * Sustituye solo los métodos que interesan de un store. Estos almacenes guardan sus
 * métodos en el prototipo, así que expandir el objeto perdería el resto de la interfaz.
 */
export function override<T extends object>(store: T, patch: Partial<T>): T {
  return new Proxy(store, {
    get: (target, key, receiver) =>
      key in patch ? (patch as Record<PropertyKey, unknown>)[key] : Reflect.get(target, key, receiver)
  });
}

/**
 * Los almacenes locales de prueba: las pantallas que no hablan con el servidor los usan tal cual.
 * Se parchea lo que interesa (`localStores({ versions })`) para no recordar campos al crecer `AppStores`.
 */
export function localStores(patch: Partial<AppStores> = {}): AppStores {
  return {
    projects: new LocalStorageProjectStore(),
    files: new LocalStorageFileStore(),
    versions: fakeVersions(),
    env: fakeEnv(),
    seo: fakeSeo(),
    analytics: fakeAnalytics(),
    search: fakeSearch(),
    components: fakeComponents(),
    runs: fakeRuns(),
    ...patch
  };
}
