import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_RUNTIME } from "./previewRuntime";

interface Posted {
  wf?: boolean;
  type?: string;
  reason?: string;
  path?: string;
  slot?: string;
}

/**
 * El guión de la vista previa se evalúa una sola vez sobre el documento del test:
 * registra sus listeners en `document` y hablamos con él mediante `postMessage`,
 * que en jsdom es el propio `window` (no hay iframe real de por medio).
 */
let posted: Posted[] = [];

function formMarkup(): string {
  return `<form id="f"><input id="n" name="n" value="Ana" /><button type="submit">Enviar</button></form>`;
}

function submit(): Event {
  const form = document.getElementById("f") as HTMLFormElement;
  const event = new Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  vi.spyOn(window, "postMessage").mockImplementation((message: Posted) => {
    posted.push(message);
  });
  window.eval(PREVIEW_RUNTIME);
});

describe("runtime de la vista previa", () => {
  it("intercepta los envíos que la página no gestiona y no navega", () => {
    document.body.innerHTML = formMarkup();
    posted = [];
    const event = submit();
    expect(event.defaultPrevented).toBe(true);
    expect(posted.some((m) => m.type === "wf:blocked" && /formularios/.test(m.reason ?? ""))).toBe(true);
  });

  it("deja actuar al script de la página cuando él mismo cancela el envío", () => {
    document.body.innerHTML = formMarkup();
    const form = document.getElementById("f") as HTMLFormElement;
    form.addEventListener("submit", (event) => event.preventDefault());
    posted = [];
    const event = submit();
    expect(event.defaultPrevented).toBe(true);
    expect(posted.some((m) => m.type === "wf:blocked")).toBe(false);
  });

  it("neutraliza form.submit(), que no dispara el evento submit", () => {
    document.body.innerHTML = formMarkup();
    const form = document.getElementById("f") as HTMLFormElement;
    posted = [];
    form.submit();
    expect(posted.some((m) => m.type === "wf:blocked" && /formularios/.test(m.reason ?? ""))).toBe(true);
  });

  // method="dialog" no navega: cierra el diálogo. Bloquearlo rompería los modales de la página.
  it("deja cerrar un diálogo con method=dialog en vez de bloquear el envío", () => {
    document.body.innerHTML = `<dialog id="d"><form id="fd" method="dialog"><button type="submit">Cerrar</button></form></dialog>`;
    posted = [];
    const event = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("fd")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(posted.some((m) => m.type === "wf:blocked")).toBe(false);
  });

  it("form.submit() sobre un diálogo lo cierra por el mismo camino", () => {
    document.body.innerHTML = `<dialog id="d"><form id="fd" method="dialog"><button type="submit">Cerrar</button></form></dialog>`;
    const caja = document.getElementById("d") as HTMLDialogElement;
    const cerrar = vi.fn();
    caja.close = cerrar;
    posted = [];
    (document.getElementById("fd") as HTMLFormElement).submit();
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(posted.some((m) => m.type === "wf:blocked")).toBe(false);
  });
});

/**
 * jsdom no maquetan: el rectángulo de cada elemento lo pone la prueba. El servicio de destino se
 * pide con un mensaje `{x, y}` en coordenadas del viewport del iframe, que es lo que envía el
 * escudo de arrastre de la plataforma.
 */
const RECORRIDO = `<main data-wf-path="0.0.0"><h1 data-wf-path="0.0.0.0">Hola</h1></main>`;

function caja(selector: string, arriba: number, alto: number) {
  const elemento = document.querySelector(selector) as HTMLElement;
  vi.spyOn(elemento, "getBoundingClientRect").mockReturnValue({
    top: arriba,
    left: 0,
    width: 320,
    height: alto,
    bottom: arriba + alto,
    right: 320,
    x: 0,
    y: arriba,
    toJSON: () => ({})
  } as DOMRect);
  return elemento;
}

function pedirDestino(x: number, y: number) {
  window.dispatchEvent(new MessageEvent("message", { data: { wf: true, type: "wf:hit", x, y } }));
}

const respuesta = () => posted.filter((m) => m.type === "wf:hit").at(-1);

describe("servicio de destino del arrastre", () => {
  let titulo: HTMLElement;
  let contenedor: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = RECORRIDO;
    contenedor = caja("main", 90, 240);
    titulo = caja("h1", 100, 200);
    Object.assign(window, { __wfBuilder: true });
    posted = [];
  });

  it("la franja de arriba responde «antes» y marca el borde superior", () => {
    pedirDestino(160, 110);
    expect(respuesta()).toMatchObject({ path: "0.0.0.0", slot: "before" });
    expect(titulo.classList.contains("wf-antes")).toBe(true);
  });

  it("la franja de abajo cambia la marca al borde inferior", () => {
    pedirDestino(160, 110);
    pedirDestino(160, 290);
    expect(respuesta()).toMatchObject({ path: "0.0.0.0", slot: "after" });
    expect(titulo.classList.contains("wf-antes")).toBe(false);
    expect(titulo.classList.contains("wf-despues")).toBe(true);
  });

  it("en el centro el destino sube al contenedor que admite bloques", () => {
    pedirDestino(160, 190);
    expect(respuesta()).toMatchObject({ path: "0.0.0", slot: "inside-end" });
    expect(contenedor.classList.contains("wf-dentro")).toBe(true);
    expect(titulo.classList.length).toBe(0);
  });

  it("cada petición deja una sola marca en el documento", () => {
    pedirDestino(160, 110);
    pedirDestino(160, 190);
    expect(document.querySelectorAll(".wf-antes, .wf-despues, .wf-dentro")).toHaveLength(1);
  });

  it("el aviso de soltar fuera limpia las marcas", () => {
    pedirDestino(160, 110);
    window.dispatchEvent(new MessageEvent("message", { data: { wf: true, type: "wf:desmarcar" } }));
    expect(document.querySelectorAll(".wf-antes, .wf-despues, .wf-dentro")).toHaveLength(0);
  });

  it("sin un elemento con ruta bajo el punto no hay destino", () => {
    pedirDestino(160, 800);
    expect(respuesta()).toMatchObject({ path: null });
  });

  it("fuera del constructor el servicio no responde ni marca", () => {
    Object.assign(window, { __wfBuilder: false });
    pedirDestino(160, 110);
    expect(posted).toEqual([]);
    expect(titulo.classList.length).toBe(0);
  });
});
