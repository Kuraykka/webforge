import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageFileStore, type FileStore } from "../files/storage";
import { MemoryStorage, override } from "../../test/store-support";
import { LocalStorageProjectStore, type ProjectStore } from "./storage";
import {
  importFromBrowser,
  readImportMarker,
  writeImportMarker,
  type ImportReport,
  type StorePair
} from "./importLocal";
import type { NewProjectInput, Project, ProjectStatus, StackId } from "./types";

function browserStores(storage: Storage): StorePair {
  return { projects: new LocalStorageProjectStore(storage), files: new LocalStorageFileStore(storage) };
}

const INPUT: NewProjectInput = {
  name: "Tienda",
  description: "Catálogo",
  folder: "Clientes",
  tags: ["venta"],
  stack: "static"
};

async function seedLocal(
  source: StorePair,
  input: NewProjectInput,
  files: Record<string, string>,
  status?: ProjectStatus
): Promise<Project> {
  const project = await source.projects.create(input);
  for (const [path, content] of Object.entries(files)) {
    await source.files.write(project.id, path, content);
  }
  if (status && status !== "borrador") await source.projects.update(project.id, { status });
  return project;
}

describe("importFromBrowser", () => {
  let source: StorePair;
  let target: StorePair;

  beforeEach(() => {
    source = browserStores(new MemoryStorage());
    target = browserStores(new MemoryStorage());
  });

  it("lleva el proyecto y sus archivos a la cuenta", async () => {
    const local = await seedLocal(source, INPUT, { "index.html": "<h1>Tienda local</h1>", "styles.css": "body{color:red}" });

    const report = await importFromBrowser(source, target);

    expect(report.projects).toBe(1);
    expect(report.files).toBe(2);
    expect(report.failed).toEqual([]);

    const imported = await target.projects.list();
    expect(imported).toHaveLength(1);
    const copy = imported[0]!;
    expect(copy.name).toBe("Tienda");
    expect(copy.description).toBe("Catálogo");
    expect(copy.folder).toBe("Clientes");
    expect(copy.tags).toEqual(["venta"]);
    expect(copy.stack).toBe("static");

    const contentOf = async (path: string) => (await target.files.read(copy.id, path)).content;
    expect(await contentOf("index.html")).toBe("<h1>Tienda local</h1>");
    expect(await contentOf("styles.css")).toBe("body{color:red}");

    // El proyecto de origen sigue intacto: importar no borra lo que había en el navegador.
    expect(await source.files.read(local.id, "index.html").then((f) => f.content)).toBe("<h1>Tienda local</h1>");
  });

  it("conserva el estado que tenía el proyecto", async () => {
    await seedLocal(source, INPUT, { "index.html": "<p>x</p>" }, "listo");
    const report = await importFromBrowser(source, target);

    expect(report.projects).toBe(1);
    const [copy] = await target.projects.list();
    expect(copy?.status).toBe("listo");
  });

  it("respeta la carpeta y las etiquetas de cada proyecto", async () => {
    await seedLocal(source, INPUT, { "index.html": "<p>1</p>" });
    await seedLocal(source, { ...INPUT, name: "Blog", folder: "Personal", tags: [], stack: "react" }, {
      "src/App.tsx": "export const App = () => null;"
    });

    await importFromBrowser(source, target);

    const copies = await target.projects.list();
    const blog = copies.find((p) => p.name === "Blog");
    expect(blog?.folder).toBe("Personal");
    expect(blog?.tags).toEqual([]);
    expect((await target.files.read(blog!.id, "src/App.tsx")).content).toContain("export const App");
  });

  it("no duplica un proyecto que ya está en la cuenta", async () => {
    await seedLocal(source, INPUT, { "index.html": "<p>1</p>" });
    await target.projects.create(INPUT);

    const report = await importFromBrowser(source, target);

    expect(report.projects).toBe(0);
    expect(report.skipped).toEqual(["Tienda"]);
    expect(await target.projects.list()).toHaveLength(1);
  });

  it("un proyecto que falla no frena a los demás", async () => {
    await seedLocal(source, INPUT, { "index.html": "<p>1</p>" });
    await seedLocal(source, { ...INPUT, name: "Roto" }, { "index.html": "<p>2</p>" });

    const rejected = override<FileStore>(target.files, {
      write: async (projectId, path, content) => {
        // El id ya es del destino: aquí se busca por nombre, que es lo que se conserva al importar.
        const roto = (await target.projects.list()).find((project) => project.name === "Roto");
        if (roto?.id === projectId) throw new Error("El archivo supera el límite de 512 KB por archivo.");
        return target.files.write(projectId, path, content);
      }
    });

    const report = await importFromBrowser(source, { projects: target.projects, files: rejected });

    expect(report.projects).toBe(1);
    expect(report.failed).toEqual([{ name: "Roto", reason: "El archivo supera el límite de 512 KB por archivo." }]);
    expect((await target.projects.list()).map((p) => p.name).sort()).toEqual(["Roto", "Tienda"]);
    const tienda = (await target.projects.list()).find((p) => p.name === "Tienda")!;
    expect((await target.files.read(tienda.id, "index.html")).content).toBe("<p>1</p>");
  });

  it("sin datos locales no importa nada", async () => {
    const report: ImportReport = await importFromBrowser(source, target);
    expect(report).toEqual({ projects: 0, files: 0, skipped: [], failed: [] });
  });

  it("un stack de TypeScript conserva sus rutas anidadas", async () => {
    await seedLocal(source, { ...INPUT, stack: "typescript" as StackId }, {
      "src/main.ts": "const a = 1;",
      "tsconfig.json": "{}"
    });
    const report = await importFromBrowser(source, target);
    const [copy] = await target.projects.list();
    const paths = (await target.files.list(copy!.id)).map((file) => file.path);
    expect(report.files).toBe(2);
    expect(paths).toEqual(["src/main.ts", "tsconfig.json"]);
  });

  it("quita del destino los archivos de plantilla que el proyecto no tenía", async () => {
    // El alta en el servidor siembra la plantilla: si aquí no existía, sobra.
    const seeding = override<ProjectStore>(target.projects, {
      create: async (input) => {
        const project = await target.projects.create(input);
        await target.files.ensureSeeded(project.id, input.stack, input.name);
        return project;
      }
    });
    await seedLocal(source, INPUT, { "index.html": "<p>solo esto</p>", "styles.css": "a{}" });

    const report = await importFromBrowser(source, { projects: seeding, files: target.files });

    const [copy] = await target.projects.list();
    expect(report.files).toBe(2);
    expect((await target.files.list(copy!.id)).map((file) => file.path)).toEqual(["index.html", "styles.css"]);
  });
});

describe("marcador de importación", () => {
  it("guarda el recuento y vuelve a leerse", () => {
    const storage = new MemoryStorage();
    expect(readImportMarker(storage)).toBeNull();

    writeImportMarker({ doneAt: "2026-04-01T09:00:00.000Z", projects: 3, files: 12, skipped: ["Viejo"], failed: [] }, storage);
    expect(readImportMarker(storage)).toEqual({
      doneAt: "2026-04-01T09:00:00.000Z",
      projects: 3,
      files: 12,
      skipped: ["Viejo"],
      failed: []
    });
  });

  it("un marcador corrupto se ignora", () => {
    const storage = new MemoryStorage();
    storage.setItem("webforge.import.v1", "esto no es json");
    expect(readImportMarker(storage)).toBeNull();
  });

  it("un marcador escrito a mano con números falsos se descarta", () => {
    const storage = new MemoryStorage();
    storage.setItem("webforge.import.v1", JSON.stringify({ doneAt: 2026, projects: "muchos", files: null }));
    expect(readImportMarker(storage)).toBeNull();
  });
});
