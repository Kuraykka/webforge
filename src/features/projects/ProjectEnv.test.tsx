import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../lib/api";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { ENV_FIXTURE, ENV_SECRET, fakeEnv } from "./test-support";
import type { EnvEnvironment, EnvStore } from "./env";
import { ProjectEnv } from "./ProjectEnv";

const OTRA = { ...ENV_FIXTURE, id: "e2", key: "API_URL", bytes: 17 };

function renderEnv(env: EnvStore, onChanged?: () => void) {
  render(
    <StoresProvider stores={localStores({ env })}>
      <ToastProvider>
        <ProjectEnv projectId="p1" onChanged={onChanged ?? (() => undefined)} />
      </ToastProvider>
    </StoresProvider>
  );
}

async function lista() {
  return screen.findByRole("list", { name: "Variables de entorno" });
}

describe("ProjectEnv", () => {
  it("enumera las claves sin escribir jamás su contenido", async () => {
    renderEnv(fakeEnv({ list: async () => [ENV_FIXTURE, OTRA] }));
    const contenedor = await lista();
    const items = await waitFor(() => within(contenedor).getAllByRole("listitem"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("API_KEY");
    expect(items[1]?.textContent).toContain("API_URL");
    expect(document.body.textContent).not.toContain("sk-privada-123");
  });

  it("empieza en desarrollo y cambia de entorno al pulsar", async () => {
    const vistos: EnvEnvironment[] = [];
    const list = vi.fn<EnvStore["list"]>(async (_p, environment) => {
      vistos.push(environment);
      return [];
    });
    renderEnv(fakeEnv({ list }));
    await screen.findByText(/Todavía no hay variables/);
    fireEvent.click(screen.getByRole("button", { name: "Producción" }));
    await waitFor(() => expect(vistos).toEqual(["desarrollo", "produccion"]));
    expect(screen.getByRole("button", { name: "Producción" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("guarda la variable y vuelve a pedir la lista", async () => {
    const list = vi
      .fn<EnvStore["list"]>()
      .mockResolvedValueOnce([ENV_FIXTURE])
      .mockResolvedValueOnce([ENV_FIXTURE, OTRA]);
    const save = vi.fn<EnvStore["save"]>(async () => ENV_FIXTURE);
    const onChanged = vi.fn();
    renderEnv(fakeEnv({ list, save }), onChanged);
    await within(await lista()).findByText("API_KEY");
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la variable" }), { target: { value: "api_url" } });
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "http://localhost" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar variable" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("p1", "desarrollo", "api_url", "http://localhost"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Variable guardada.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Valor").value).toBe("");
  });

  it("un nombre imposible se frena aquí, sin molestar al servidor", async () => {
    const save = vi.fn<EnvStore["save"]>();
    renderEnv(fakeEnv({ save }));
    await within(await lista()).findByText("API_KEY");
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la variable" }), { target: { value: "9 clave" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar variable" }));
    expect((await screen.findByRole("alert")).textContent).toContain("empezar por una letra");
    expect(save).not.toHaveBeenCalled();
  });

  it("el valor solo aparece cuando se pide y vuelve a ocultarse", async () => {
    const reveal = vi.fn<EnvStore["reveal"]>(async () => ENV_SECRET);
    renderEnv(fakeEnv({ reveal }));
    await within(await lista()).findByText("API_KEY");
    expect(document.body.textContent).not.toContain("sk-privada-123");
    fireEvent.click(screen.getByRole("button", { name: "Ver valor de API_KEY" }));
    expect(await screen.findByText("sk-privada-123")).toBeTruthy();
    await waitFor(() => expect(reveal).toHaveBeenCalledWith("p1", "e1"));
    fireEvent.click(screen.getByRole("button", { name: "Ocultar valor de API_KEY" }));
    await waitFor(() => expect(document.body.textContent).not.toContain("sk-privada-123"));
  });

  it("cambiar de entorno esconde lo que se estaba mirando", async () => {
    renderEnv(fakeEnv({ list: async (_p, environment) => (environment === "desarrollo" ? [ENV_FIXTURE] : []), reveal: async () => ENV_SECRET }));
    await within(await lista()).findByText("API_KEY");
    fireEvent.click(screen.getByRole("button", { name: "Ver valor de API_KEY" }));
    await screen.findByText("sk-privada-123");
    fireEvent.click(screen.getByRole("button", { name: "Producción" }));
    await screen.findByText(/Todavía no hay variables/);
    expect(document.body.textContent).not.toContain("sk-privada-123");
  });

  it("borrar pide confirmación antes de enviar nada", async () => {
    const remove = vi.fn<EnvStore["remove"]>();
    const list = vi.fn<EnvStore["list"]>().mockResolvedValueOnce([ENV_FIXTURE]).mockResolvedValueOnce([]);
    renderEnv(fakeEnv({ list, remove }));
    fireEvent.click(within(await lista()).getByRole("button", { name: "Borrar API_KEY" }));
    const dialog = await screen.findByRole("dialog");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("p1", "e1"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Variable borrada.")).toBeTruthy();
  });

  it("el mensaje del servidor se lee tal cual", async () => {
    const save = vi.fn<EnvStore["save"]>(async () => {
      throw new ApiError(409, "Cada entorno admite hasta 40 variables.");
    });
    renderEnv(fakeEnv({ save }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la variable" }), { target: { value: "NUEVA" } });
    fireEvent.change(screen.getByLabelText("Valor"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar variable" }));
    expect((await screen.findByRole("alert")).textContent).toContain("admite hasta 40");
  });

  it("una lista que no carga se explica en su hueco", async () => {
    const list = vi.fn<EnvStore["list"]>(async () => {
      throw new ApiError(0, "No se pudo conectar con el servidor.");
    });
    renderEnv(fakeEnv({ list }));
    expect(await screen.findByText(/No se pudieron leer las variables/)).toBeTruthy();
  });

  it("avisa de que el almacén aún no cifra en reposo", async () => {
    renderEnv(fakeEnv());
    await lista();
    expect(screen.getByText(/sin cifrar/i)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Valor").type).toBe("password");
  });
});
