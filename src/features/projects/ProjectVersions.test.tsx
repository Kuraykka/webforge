import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../lib/api";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { fakeVersions, VERSION_FIXTURE } from "./test-support";
import type { VersionStore } from "./versions";
import { ProjectVersions } from "./ProjectVersions";

const SEGUNDA = { ...VERSION_FIXTURE, id: "v2", label: "Cabecera nueva", files: 5, bytes: 2048 };

function renderVersions(versions: VersionStore, onChanged?: () => void) {
  render(
    <StoresProvider stores={localStores({ versions })}>
      <ToastProvider>
        <ProjectVersions projectId="p1" onChanged={onChanged ?? (() => undefined)} />
      </ToastProvider>
    </StoresProvider>
  );
}

async function lista() {
  return screen.findByRole("list", { name: "Versiones guardadas" });
}

describe("ProjectVersions", () => {
  it("enumera cada versión con su tamaño", async () => {
    renderVersions(fakeVersions({ list: async () => [SEGUNDA, VERSION_FIXTURE] }));
    const contenedor = await lista();
    const items = await waitFor(() => within(contenedor).getAllByRole("listitem"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Cabecera nueva");
    expect(items[0]?.textContent).toContain("5 archivos");
    expect(items[0]?.textContent).toContain("2 KB");
    expect(items[1]?.textContent).toContain("Antes del cambio");
  });

  it("dice que todavía no hay versiones", async () => {
    renderVersions(fakeVersions({ list: async () => [] }));
    expect(await screen.findByText(/Todavía no hay versiones/)).toBeTruthy();
  });

  it("guarda una versión con la etiqueta escrita y refresca la lista", async () => {
    const list = vi.fn<VersionStore["list"]>().mockResolvedValueOnce([VERSION_FIXTURE]).mockResolvedValueOnce([VERSION_FIXTURE]);
    const save = vi.fn<VersionStore["save"]>(async (_id, label) => ({ ...VERSION_FIXTURE, id: "v3", label }));
    renderVersions(fakeVersions({ list, save }));
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.change(screen.getByRole("textbox", { name: "Etiqueta" }), { target: { value: "Hito 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar versión" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("p1", "Hito 1"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Versión guardada.")).toBeTruthy();
  });

  it("dejar la etiqueta vacía pregunta al servidor por la corriente", async () => {
    const save = vi.fn<VersionStore["save"]>(async () => VERSION_FIXTURE);
    renderVersions(fakeVersions({ save }));
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.click(screen.getByRole("button", { name: "Guardar versión" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("p1", ""));
  });

  it("recuperar pide confirmación antes de tocar los archivos", async () => {
    const restore = vi.fn<VersionStore["restore"]>(async () => ({
      restored: VERSION_FIXTURE,
      safety: { ...VERSION_FIXTURE, id: "v0", label: "Antes de recuperar «Antes del cambio»" }
    }));
    const onChanged = vi.fn();
    renderVersions(fakeVersions({ restore }), onChanged);
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.click(within(await lista()).getByRole("button", { name: "Recuperar «Antes del cambio»" }));
    const dialog = await screen.findByRole("dialog");
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Recuperar" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("p1", "v1"));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Se ha creado una copia de seguridad/)).toBeTruthy();
  });

  it("cancelar el recupero no llama al servidor", async () => {
    const restore = vi.fn<VersionStore["restore"]>();
    renderVersions(fakeVersions({ restore }));
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.click(within(await lista()).getByRole("button", { name: "Recuperar «Antes del cambio»" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(restore).not.toHaveBeenCalled();
  });

  it("borra una versión tras confirmarla", async () => {
    const remove = vi.fn<VersionStore["remove"]>();
    const list = vi.fn<VersionStore["list"]>().mockResolvedValueOnce([VERSION_FIXTURE]).mockResolvedValueOnce([]);
    renderVersions(fakeVersions({ list, remove }));
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.click(within(await lista()).getByRole("button", { name: "Borrar «Antes del cambio»" }));
    const dialog = await screen.findByRole("dialog");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("p1", "v1"));
    expect(await screen.findByText(/Todavía no hay versiones/)).toBeTruthy();
  });

  it("muestra el mensaje del servidor cuando algo falla", async () => {
    const save = vi.fn<VersionStore["save"]>(async () => {
      throw new ApiError(400, "La etiqueta de la versión no puede superar 120 caracteres.");
    });
    renderVersions(fakeVersions({ save }));
    await within(await lista()).findByText("Antes del cambio");
    fireEvent.click(screen.getByRole("button", { name: "Guardar versión" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no puede superar 120");
  });

  it("una lista que no carga se explica en su hueco", async () => {
    const list = vi.fn<VersionStore["list"]>(async () => {
      throw new ApiError(500, "No se pudo conectar con el servidor.");
    });
    renderVersions(fakeVersions({ list }));
    expect(await screen.findByText(/No se pudieron leer las versiones/)).toBeTruthy();
  });
});
