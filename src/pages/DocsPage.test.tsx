import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiProvider } from "../lib/ApiContext";
import { createApiClient, type FetchLike } from "../lib/api";
import { StoresProvider } from "../lib/stores";
import { localStores } from "../test/store-support";
import type { DocumentoApi } from "../features/docs/documentacion";
import { DocsPage } from "./DocsPage";

const DOCUMENTO: DocumentoApi = {
  openapi: "3.1.0",
  info: {
    title: "API de WebForge",
    version: "1",
    description: "Todo error se responde como `{ error: texto }`."
  },
  paths: {
    "/api/health": {
      get: { summary: "Estado del proceso", description: "Dice si la API responde.", tags: ["general"], "x-acceso": "pública", responses: { "200": { description: "Objeto `status`." } } }
    },
    "/api/projects": {
      get: { summary: "Listar los proyectos", description: "Los proyectos de la cuenta.", tags: ["proyectos"], "x-acceso": "dueño", responses: { "200": { description: "`projects`." } } },
      post: {
        summary: "Crear un proyecto",
        description: "Puede nacer con archivos.",
        tags: ["proyectos"],
        "x-acceso": "dueño",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", description: "nombre visible" },
                  files: { type: "object", additionalProperties: { type: "string" }, description: "ruta → contenido" }
                },
                required: ["name"]
              }
            }
          }
        },
        responses: { "201": { description: "`project` creado." } }
      }
    },
    "/api/projects/{id}": {
      delete: {
        summary: "Eliminar un proyecto",
        description: "Se lleva sus archivos.",
        tags: ["proyectos"],
        "x-acceso": "dueño",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "identificador del proyecto" }],
        responses: { "204": { description: "Respuesta vacía." } }
      }
    }
  }
};

function harness(doc: unknown = DOCUMENTO, estado = 200, error = "No responde el servidor.") {
  const fetchImpl: FetchLike = async () =>
    new Response(estado === 200 ? JSON.stringify(doc) : JSON.stringify({ error }), {
      status: estado,
      headers: { "content-type": "application/json" }
    });
  render(
    <ApiProvider api={createApiClient(fetchImpl)}>
      <StoresProvider stores={localStores()}>
        <MemoryRouter initialEntries={["/documentacion"]}>
          <DocsPage />
        </MemoryRouter>
      </StoresProvider>
    </ApiProvider>
  );
}

describe("DocsPage", () => {
  it("enumera las rutas del documento con su método", async () => {
    harness();
    const lista = await screen.findByRole("list", { name: "Rutas de la API" });
    expect(lista.textContent).toContain("GET /api/projects");
    expect(lista.textContent).toContain("DELETE /api/projects/{id}");
    expect(screen.getByRole("heading", { name: "API de WebForge" }).textContent).toContain("WebForge");
  });

  it("dice qué necesita cada ruta: parámetros, cuerpo y qué devuelve", async () => {
    harness();
    await screen.findByRole("list", { name: "Rutas de la API" });
    const borrar = screen.getByText("DELETE /api/projects/{id}").closest("li");
    expect(borrar?.textContent).toContain("id");
    expect(borrar?.textContent).toContain("Respuesta vacía");
    const crear = screen.getByText("POST /api/projects").closest("li");
    expect(crear?.textContent).toContain("name");
    expect(crear?.textContent).toContain("nombre visible");
    expect(crear?.textContent).toContain("obligatorio");
  });

  it("filtra por lo que se escribe", async () => {
    harness();
    await screen.findByRole("list", { name: "Rutas de la API" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Filtrar rutas" }), { target: { value: "health" } });
    const lista = screen.getByRole("list", { name: "Rutas de la API" });
    expect(lista.textContent).toContain("GET /api/health");
    expect(screen.queryByText("POST /api/projects")).toBeNull();
  });

  it("avisa cuando queda alguna ruta sin documentar", async () => {
    const roto = structuredClone(DOCUMENTO) as typeof DOCUMENTO;
    roto.paths["/api/nuevo"] = {
      get: {
        summary: "",
        description: "",
        tags: ["general"],
        "x-acceso": "sin documentar",
        "x-sin-documentar": true,
        responses: { "200": { description: "La documentación de esta ruta falta." } }
      }
    };
    harness(roto);
    await screen.findByRole("list", { name: "Rutas de la API" });
    expect(screen.getByText("sin documentar")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Rutas de la API" }).textContent).toContain("GET /api/nuevo");
  });

  it("un fallo del servidor se muestra con su mensaje", async () => {
    harness(undefined, 500, "El servidor está caído.");
    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent).toContain("El servidor está caído.");
  });
});
