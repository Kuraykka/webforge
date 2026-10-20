import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui/Toast";
import { ApiError } from "../../lib/api";
import { StoresProvider } from "../../lib/stores";
import { localStores } from "../../test/store-support";
import { RUN_FIXTURE, fakeRuns } from "../projects/test-support";
import type { RunLanzada, RunStore, SolicitudDeRun } from "../projects/runs";
import { RunsPanel } from "./RunsPanel";

function renderPanel(runs: RunStore, props: Partial<React.ComponentProps<typeof RunsPanel>> = {}) {
  render(
    <StoresProvider stores={localStores({ runs })}>
      <ToastProvider>
        <RunsPanel projectId="p1" archivos={["index.js", "otra.js", "index.html"]} archivoActual="index.js" {...props} />
      </ToastProvider>
    </StoresProvider>
  );
}

async function lista() {
  return screen.findByRole("list", { name: "Ejecuciones del proyecto" });
}

describe("RunsPanel", () => {
  it("enumera las ejecuciones con su estado", async () => {
    renderPanel(fakeRuns());
    const contenedor = await lista();
    const items = await waitFor(() => within(contenedor).getAllByRole("listitem"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("index.js");
    expect(items[0]?.textContent).toContain("Terminada");
    expect(items[1]?.textContent).toContain("Fallida");
  });

  it("avisa cuando todavía no hay nada ejecutado", async () => {
    renderPanel(fakeRuns({ list: async () => [] }));
    await screen.findByText(/Todavía no hay ejecuciones/);
    await lista();
  });

  it("lanza el archivo abierto y vuelve a pedir la lista", async () => {
    const pedidas: SolicitudDeRun[] = [];
    const list = vi
      .fn<RunStore["list"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...RUN_FIXTURE, id: "r-nueva" }]);
    const launch = vi.fn<RunStore["launch"]>(async (_p, solicitud) => {
      pedidas.push(solicitud);
      return { run: { ...RUN_FIXTURE, id: "r-nueva", salidaBytes: 6 }, log: "$ node index.js\nhola" };
    });
    renderPanel(fakeRuns({ list, launch }));
    await screen.findByText(/Todavía no hay ejecuciones/);
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(pedidas).toEqual([{ tipo: "script", archivo: "index.js" }]));
    expect(launch.mock.calls[0]?.[0]).toBe("p1");
    await within(await lista()).findByText("index.js");
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("log", { name: "Registro de la ejecución" }).textContent).toContain("hola");
  });

  it("el comprobador no manda archivo porque no ejecuta nada del proyecto", async () => {
    const launch = vi.fn<RunStore["launch"]>(async (_p, solicitud) => ({
      run: { ...RUN_FIXTURE, tipo: solicitud.tipo, archivo: null },
      log: "$ node .webforge/comprobar.mjs\nsin fallos"
    }));
    renderPanel(fakeRuns({ launch }));
    fireEvent.click(await screen.findByRole("button", { name: "Comprobar el proyecto" }));
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("p1", { tipo: "comprobar" }));
  });

  it("el entorno elegido viaja en la petición y sin él no se manda", async () => {
    const launch = vi.fn<RunStore["launch"]>(async (_p, solicitud) => ({
      run: { ...RUN_FIXTURE, archivo: solicitud.archivo ?? null },
      log: ""
    }));
    renderPanel(fakeRuns({ launch }));
    fireEvent.click(await screen.findByRole("button", { name: "Producción" }));
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("p1", { tipo: "script", archivo: "index.js", entorno: "produccion" }));

    fireEvent.click(screen.getByRole("button", { name: "Sin variables" }));
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(launch).toHaveBeenLastCalledWith("p1", { tipo: "script", archivo: "index.js" }));
  });

  it("se elige otro archivo del proyecto desde el selector", async () => {
    const launch = vi.fn<RunStore["launch"]>(async (_p, solicitud) => ({
      run: { ...RUN_FIXTURE, archivo: solicitud.archivo ?? null },
      log: ""
    }));
    renderPanel(fakeRuns({ launch }));
    fireEvent.change(await screen.findByRole("combobox", { name: "Archivo a ejecutar" }), { target: { value: "otra.js" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("p1", { tipo: "script", archivo: "otra.js" }));
  });

  it("un HTML abierto no se cuela como destino de ejecución", async () => {
    const launch = vi.fn<RunStore["launch"]>(async (_p, solicitud) => ({
      run: { ...RUN_FIXTURE, archivo: solicitud.archivo ?? null },
      log: ""
    }));
    renderPanel(fakeRuns({ launch }), { archivoActual: "index.html" });
    const destino = (await screen.findByRole("combobox", { name: "Archivo a ejecutar" })) as HTMLSelectElement;
    expect(destino.value).toBe("index.js");
    fireEvent.click(screen.getByRole("button", { name: /^Ejecutar/ }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("p1", { tipo: "script", archivo: "index.js" }));
  });

  it("mientras corre no se puede volver a lanzar", async () => {
    const caja: { cerrar?: () => void } = {};
    const launch = vi.fn<RunStore["launch"]>(
      () =>
        new Promise<RunLanzada>((resolver) => {
          caja.cerrar = () => resolver({ run: RUN_FIXTURE, log: "" });
        })
    );
    renderPanel(fakeRuns({ launch }));
    fireEvent.click(await screen.findByRole("button", { name: /^Ejecutar/ }));
    const boton = await screen.findByRole("button", { name: /Ejecutando/ });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/espera/i)).toBeTruthy();
    caja.cerrar?.();
    await waitFor(() => expect((screen.getByRole("button", { name: /^Ejecutar/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("un servidor sin aislamiento lo dice con su aviso, sin fingir un resultado", async () => {
    const launch = vi.fn<RunStore["launch"]>(async () => {
      throw new ApiError(503, "Este servidor no tiene aislamiento disponible (falta «bwrap»).");
    });
    renderPanel(fakeRuns({ launch }));
    fireEvent.click(await screen.findByRole("button", { name: /^Ejecutar/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("aislamiento");
    await waitFor(() => expect((screen.getByRole("button", { name: /^Ejecutar/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("pide el registro al servidor al abrir una ejecución", async () => {
    const log = vi.fn<RunStore["log"]>(async () => "$ node index.js\npetardo el script");
    renderPanel(fakeRuns({ log }));
    const contenedor = await lista();
    const item = within(contenedor).getAllByRole("listitem")[1];
    if (!item) throw new Error("sin segundo elemento");
    fireEvent.click(within(item).getByRole("button", { name: /Registro/ }));
    await waitFor(() => expect(log).toHaveBeenCalledWith("p1", "r2"));
    expect(screen.getByRole("log", { name: "Registro de la ejecución" }).textContent).toContain("petardo el script");
  });

  it("sin archivos ejecutables el botón explica lo que falta", async () => {
    renderPanel(fakeRuns(), { archivos: ["index.html"] });
    const boton = await screen.findByRole("button", { name: /^Ejecutar/ });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no tiene ningún archivo/i).textContent).toContain(".js");
  });

  it("dice lo que la jaula no puede hacer, en vez de prometer dependencias", async () => {
    renderPanel(fakeRuns());
    await lista();
    const aviso = screen.getByText(/sin red/i);
    expect(aviso.textContent).toContain("dependencias");
  });

  it("advierte de lo que aún no se guardó, porque se ejecuta lo del servidor", async () => {
    renderPanel(fakeRuns(), { sinGuardar: true });
    expect((await screen.findByText(/sin guardar/i)).textContent).toContain("servidor");
  });
});
