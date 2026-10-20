import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectFormDialog } from "./ProjectFormDialog";
import type { NewProjectInput } from "./types";

function renderDialog(onSubmit: (input: NewProjectInput) => Promise<void>) {
  const onClose = vi.fn();
  render(
    <ProjectFormDialog open project={null} folderSuggestions={[]} onClose={onClose} onSubmit={onSubmit} />
  );
  return { onClose };
}

async function enviar() {
  fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Tienda" } });
  fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ProjectFormDialog", () => {
  it("cierra el diálogo cuando el servidor acepta el proyecto", async () => {
    const recibos: NewProjectInput[] = [];
    const { onClose } = renderDialog(async (input) => {
      recibos.push(input);
    });
    await enviar();
    expect(recibos[0]?.name).toBe("Tienda");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const rechazo = () =>
    renderDialog(async () => {
      throw new Error("Has alcanzado el límite de proyectos por cuenta (1).");
    });

  it("un rechazo del servidor deja el formulario abierto para reintentar", async () => {
    const { onClose } = rechazo();
    await enviar();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Nombre *") as HTMLInputElement).value).toBe("Tienda");
    expect((screen.getByRole("button", { name: "Crear proyecto" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("un rechazo del servidor no escapa como promesa sin atender", async () => {
    const sinAtender: string[] = [];
    const vigilar = (event: Event) => sinAtender.push(String((event as PromiseRejectionEvent).reason));
    window.addEventListener("unhandledrejection", vigilar);
    rechazo();
    await enviar();
    window.removeEventListener("unhandledrejection", vigilar);
    expect(sinAtender).toEqual([]);
  });
});
