import { describe, expect, it } from "vitest";
import { RUTA_COMPROBADOR, recetaDeRun, TIPOS_DE_RUN } from "./recetas.ts";

const ARCHIVOS = [{ path: "index.html" }, { path: "scripts/site.js" }, { path: "notas.txt" }];

describe("recetaDeRun", () => {
  it("un script del proyecto corre con node dentro de la jaula", () => {
    expect(recetaDeRun({ tipo: "script", archivo: "scripts/site.js" }, ARCHIVOS)).toEqual([
      "node",
      "scripts/site.js"
    ]);
  });

  it("solo se ejecutan ficheros que existen en el proyecto", () => {
    expect(() => recetaDeRun({ tipo: "script", archivo: "otra.js" }, ARCHIVOS)).toThrow(/existe/i);
  });

  it("un fichero que no es javascript no se ejecuta", () => {
    expect(() => recetaDeRun({ tipo: "script", archivo: "notas.txt" }, ARCHIVOS)).toThrow(/javascript|\.js/i);
    expect(() => recetaDeRun({ tipo: "script", archivo: "index.html" }, ARCHIVOS)).toThrow(/javascript|\.js/i);
  });

  it("sin archivo no hay receta de script", () => {
    expect(() => recetaDeRun({ tipo: "script" }, ARCHIVOS)).toThrow(/archivo/i);
  });

  it("las rutas que salen del proyecto se rechazan antes de mirar el contenido", () => {
    expect(() => recetaDeRun({ tipo: "script", archivo: "../../etc/passwd" }, ARCHIVOS)).toThrow(/ruta/i);
    expect(() => recetaDeRun({ tipo: "script", archivo: "/etc/passwd" }, ARCHIVOS)).toThrow(/ruta/i);
  });

  it("la comprobación corre el comprobador del servidor, inyectado en la copia", () => {
    expect(recetaDeRun({ tipo: "comprobar" }, ARCHIVOS)).toEqual(["node", RUTA_COMPROBADOR]);
    expect(RUTA_COMPROBADOR.startsWith(".webforge/")).toBe(true);
  });

  it("los tipos aceptados son los declarados, nada más", () => {
    expect(TIPOS_DE_RUN).toEqual(["script", "comprobar"]);
    expect(() => recetaDeRun({ tipo: "instalar", archivo: "scripts/site.js" }, ARCHIVOS)).toThrow(/tipo/i);
  });
});
