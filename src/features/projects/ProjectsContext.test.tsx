import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createApiClient, type FetchLike } from "../../lib/api";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { HttpFileStore } from "../files/httpStorage";
import { HttpProjectStore } from "./httpStorage";
import { ProjectsProvider, useProjects } from "./ProjectsContext";
import type { Project } from "./types";

const PROJECT: Project = {
  id: "p1",
  name: "Mi tienda",
  description: "",
  folder: "Sin carpeta",
  tags: [],
  stack: "static",
  status: "borrador",
  createdAt: "2026-03-01T10:00:00.000Z",
  updatedAt: "2026-03-01T10:00:00.000Z"
};

let visto: string[] = [];

function Probe() {
  const { projects, remove } = useProjects();
  return (
    <div>
      <span data-testid="n">{projects.length}</span>
      <button type="button" onClick={() => void remove(PROJECT.id)}>
        borrar
      </button>
    </div>
  );
}

function renderConStores(fetchImpl: FetchLike) {
  const api = createApiClient(fetchImpl);
  return render(
    <StoresProvider stores={localStores({ projects: new HttpProjectStore(api), files: new HttpFileStore(api) })}>
      <ProjectsProvider>
        <Probe />
      </ProjectsProvider>
    </StoresProvider>
  );
}

describe("ProjectsProvider con stores inyectados", () => {
  it("lista y borra por la API, sin tocar el almacenamiento del navegador", async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      visto.push(`${init.method} ${url}`);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ projects: [PROJECT] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    renderConStores(fetchImpl);
    await waitFor(() => expect(visto).toContain("GET /api/projects"));
    expect(window.localStorage.length).toBe(0);

    const button = document.querySelector("button");
    if (!button) throw new Error("Falta el botón de borrar.");
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(visto).toContain("DELETE /api/projects/p1"));
    // El servidor borra los archivos en cascada: no hay que escribir en la colección aparte.
    expect(visto.filter((line) => line.startsWith("DELETE"))).toEqual(["DELETE /api/projects/p1"]);
  });
});

function Estado() {
  const { loading, projects, reload, error } = useProjects();
  return (
    <div>
      <span>{loading ? "cargando" : `${projects.length} proyectos`}</span>
      <p>{error ?? ""}</p>
      <button type="button" onClick={() => void reload()}>
        recargar
      </button>
    </div>
  );
}

describe("loading del ProjectsProvider", () => {
  function lenta(umbral: number) {
    let resolver: (() => void) | undefined;
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls > umbral) await new Promise<void>((resolve) => (resolver = resolve));
      return new Response(JSON.stringify({ projects: [PROJECT] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    return { fetchImpl, soltar: () => resolver?.() };
  }

  function renderEstado(fetchImpl: FetchLike) {
    const api = createApiClient(fetchImpl);
    return render(
      <StoresProvider stores={localStores({ projects: new HttpProjectStore(api), files: new HttpFileStore(api) })}>
        <ProjectsProvider>
          <Estado />
        </ProjectsProvider>
      </StoresProvider>
    );
  }

  const texto = () => document.querySelector("span")?.textContent ?? "(sin span)";

  it("la primera carga muestra el spinner de página", async () => {
    const { fetchImpl, soltar } = lenta(0);
    renderEstado(fetchImpl);
    expect(texto()).toBe("cargando");
    soltar();
    await waitFor(() => expect(texto()).toBe("1 proyectos"));
  });

  it("recargar con datos en pantalla no desmonta lo que se está viendo", async () => {
    // El banner de importación vive en el panel y llama a reload al terminar:
    // si el spinner de página vuelve a montarse, su resumen desaparece.
    const { fetchImpl, soltar } = lenta(1);
    renderEstado(fetchImpl);
    await waitFor(() => expect(texto()).toBe("1 proyectos"));

    const boton = document.querySelector("button");
    if (!boton) throw new Error("Falta el botón de recargar.");
    await act(async () => {
      boton.click();
    });
    expect(texto()).toBe("1 proyectos");
    soltar();
    await waitFor(() => expect(texto()).toBe("1 proyectos"));
  });
});
