import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProjectStore } from "./storage";
import { ProjectNotFoundError } from "../../lib/storage";
import type { NewProjectInput, Project } from "./types";

const input: NewProjectInput = {
  name: "  Mi web  ",
  description: " descripción ",
  folder: "  ",
  tags: [" landing ", "", "tienda"],
  stack: "static"
};

describe("LocalStorageProjectStore", () => {
  let store: LocalStorageProjectStore;

  beforeEach(() => {
    window.localStorage.clear();
    store = new LocalStorageProjectStore(window.localStorage);
  });

  it("normaliza la entrada al crear", async () => {
    const project = await store.create(input);
    expect(project.name).toBe("Mi web");
    expect(project.description).toBe("descripción");
    expect(project.folder).toBe("Sin carpeta");
    expect(project.tags).toEqual(["landing", "tienda"]);
    expect(project.status).toBe("borrador");
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it("lista por actualización más reciente primero", async () => {
    const a = await store.create(input);
    const b = await store.create({ ...input, name: "Otro" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.rename(a.id, "Reordenado");
    const list = await store.list();
    expect(list.map((project) => project.id)).toEqual([a.id, b.id]);
  });

  it("rename y update registran entradas de historia", async () => {
    const project = await store.create(input);
    await store.rename(project.id, "Nuevo nombre");
    await store.update(project.id, { status: "listo" }, "Estado listo");
    const history = await store.history(project.id);
    expect(history.map((entry) => entry.action)).toEqual([
      "Estado listo",
      'Renombrado a "Nuevo nombre"',
      "Proyecto creado"
    ]);
    expect(history.every((entry) => entry.projectId === project.id)).toBe(true);
  });

  it("update sin nota no escribe historia", async () => {
    const project = await store.create(input);
    const before = (await store.history(project.id)).length;
    await store.update(project.id, { description: "sin nota" });
    expect((await store.history(project.id)).length).toBe(before);
  });

  it("protege id y createdAt aunque el patch intente cambiarlos", async () => {
    const project = await store.create(input);
    const hostile = {
      id: "intruso",
      createdAt: "1999-01-01T00:00:00.000Z"
    } as unknown as Partial<Omit<Project, "id" | "createdAt">>;
    const updated = await store.update(project.id, hostile);
    expect(updated.id).toBe(project.id);
    expect(updated.createdAt).toBe(project.createdAt);
  });

  it("duplicar crea una copia con historia propia", async () => {
    const project = await store.create(input);
    const copy = await store.duplicate(project.id);
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toBe(`${project.name} (copia)`);
    expect(copy.tags).toEqual(project.tags);
    expect((await store.history(copy.id))[0]?.action).toContain("copia de");
  });

  it("remove borra el proyecto y su historia", async () => {
    const project = await store.create(input);
    await store.remove(project.id);
    expect(await store.get(project.id)).toBeUndefined();
    expect(await store.history(project.id)).toEqual([]);
  });

  it("los métodos que requieren existencia fallan si el proyecto ya no existe", async () => {
    await expect(store.rename("ausente", "nombre")).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.duplicate("ausente")).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.update("ausente", { name: "x" })).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.remove("ausente")).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(store.get("ausente")).resolves.toBeUndefined();
  });

  it("limita la historia a las últimas entradas", async () => {
    const project = await store.create(input);
    for (let index = 0; index < 55; index++) {
      await store.update(project.id, { description: `cambio ${index}` }, `cambio ${index}`);
    }
    const history = await store.history(project.id);
    expect(history).toHaveLength(50);
    expect(history[0]?.action).toBe("cambio 54");
  });

  it("descarta registros corruptos y conserva los válidos", async () => {
    const project = await store.create(input);
    const raw = JSON.parse(window.localStorage.getItem("webforge.projects.v1") ?? "[]");
    raw.push({ id: 42, name: "sin id alfanumérico" }, null, { name: "x" });
    window.localStorage.setItem("webforge.projects.v1", JSON.stringify(raw));
    expect(await store.list()).toHaveLength(1);

    window.localStorage.setItem("webforge.projects.v1", "no-es-json");
    expect(await store.list()).toEqual([]);
    expect(await store.get(project.id)).toBeUndefined();
  });

  it("rescata proyectos antiguos sin stack ni estado", async () => {
    window.localStorage.setItem(
      "webforge.projects.v1",
      JSON.stringify([{ id: "viejo", name: "Antiguo", status: "inventado", stack: "angular" }])
    );
    const project = await store.get("viejo");
    expect(project?.status).toBe("borrador");
    expect(project?.stack).toBe("static");
    expect(project?.tags).toEqual([]);
    expect(project?.folder).toBe("Sin carpeta");
  });
});
