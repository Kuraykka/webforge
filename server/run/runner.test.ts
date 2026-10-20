import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutarEnJaula, jaulaDisponible, type ResultadoDeJaula } from "./runner.ts";
import type { LimitesDeJaula } from "./jail.ts";

const LIMITES: LimitesDeJaula = {
  cpuSegundos: 20,
  ficheroBloques: 8192,
  tmpfsBytes: 4 * 1024 * 1024,
  procesos: 256,
  memoriaHeapMB: 512,
  descriptores: 256,
  tiempoRealMs: 20_000,
  salidaBytes: 64 * 1024,
  red: false
};

let workdir = "";
beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "wf-jaula-"));
});
afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function enJaula(
  codigo: string,
  extra: Partial<LimitesDeJaula> = {},
  env: Record<string, string> = {}
): Promise<ResultadoDeJaula> {
  return ejecutarEnJaula({ workdir, cmd: ["node", "-e", codigo], env }, { ...LIMITES, ...extra });
}

const disponible = jaulaDisponible();

describe("ejecutarEnJaula con las opciones declaradas", () => {
  it("un ejecutable de jaula que no existe no ejecuta nada", async () => {
    await expect(
      ejecutarEnJaula({ workdir, cmd: ["node", "-e", "console.log('si')"], env: {} }, LIMITES, {
        bin: join(workdir, "bwrap-que-no-existe")
      })
    ).rejects.toThrow(/aislamiento/i);
  });

  it("la salida llega mientras se produce, trozo a trozo", async () => {
    const trozos: string[] = [];
    const r = await ejecutarEnJaula(
      { workdir, cmd: ["node", "-e", "console.log('uno');console.log('dos')"], env: {} },
      LIMITES,
      { onSalida: (trozo) => trozos.push(trozo) }
    );
    expect(r.salida).toBe("uno\ndos\n");
    expect(trozos.join("")).toBe("uno\ndos\n");
  });
});

describe.runIf(disponible)("ejecutarEnJaula con bwrap real", () => {
  it("corre node dentro de la jaula y recoge su salida", async () => {
    const r = await enJaula("console.log('hola', process.version)");
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("hola v");
  });

  it("el entorno del servidor no entra: solo lo declarado", async () => {
    process.env.WEBFORGE_SECRETO_DE_PRUEBA = "no-debe-salir";
    const r = await enJaula(
      "console.log(process.env.LLAVE ?? 'vacia', process.env.HOME, process.env.WEBFORGE_SECRETO_DE_PRUEBA ?? 'nada')",
      {},
      { LLAVE: "visible" }
    );
    delete process.env.WEBFORGE_SECRETO_DE_PRUEBA;
    expect(r.salida).toContain("visible");
    expect(r.salida).toContain("/tmp");
    expect(r.salida).toContain("nada");
    expect(r.salida).not.toContain("no-debe-salir");
  });

  it("la red está cortada", async () => {
    const r = await enJaula(
      "fetch('http://1.1.1.1').then(()=>console.log('RED_OK'),(e)=>console.log('RED_', e.cause?.code ?? e.code ?? e.message))"
    );
    expect(r.salida).toContain("RED_");
    expect(r.salida).not.toContain("RED_OK");
  });

  it("el sistema del host es de solo lectura y la copia del proyecto escribe", async () => {
    const r = await enJaula(
      [
        "const fs=require('node:fs');",
        "try { fs.writeFileSync('/etc/intento','x'); console.log('ESCRIBIO_ETC'); }",
        "catch (e) { console.log('ETC_', e.code); }",
        "fs.writeFileSync('/proyecto/dentro.txt','si');",
        "console.log('ESCRIBIO_PROYECTO');"
      ].join("")
    );
    expect(r.salida).toContain("ETC_");
    expect(r.salida).toContain("ESCRIBIO_PROYECTO");
    expect(readFileSync(join(workdir, "dentro.txt"), "utf8")).toBe("si");
  });

  it("los directorios privados del host no se ven", async () => {
    const r = await enJaula(
      [
        "const fs=require('node:fs');",
        "for (const p of ['/home', '/root', '/var/run/docker.sock']) {",
        "  console.log(p, fs.existsSync(p) ? 'VISIBLE' : 'OCULTO');",
        "}"
      ].join("")
    );
    expect(r.salida).toContain("/home OCULTO");
    expect(r.salida).toContain("/root OCULTO");
    expect(r.salida).toContain("docker.sock OCULTO");
  });

  it("el tope de cpu mata el bucle infinito", async () => {
    const r = await enJaula("while(true){}", { cpuSegundos: 1 });
    expect(r.codigo).not.toBe(0);
  });

  it("el reloj real corta un proceso largo", async () => {
    const inicio = Date.now();
    const r = await enJaula("setTimeout(()=>{}, 30000)", { tiempoRealMs: 1_200 });
    expect(Date.now() - inicio).toBeLessThan(8_000);
    expect(r.agotado).toBe(true);
    expect(r.codigo).not.toBe(0);
  });

  it("la salida se trunca en el tope declarado", async () => {
    const r = await enJaula("console.log('x'.repeat(300000))", { salidaBytes: 1024 });
    expect(r.truncado).toBe(true);
    expect(r.salida.length).toBeLessThanOrEqual(1024);
  });

  it("/tmp es tmpfs y se agota con su tope", async () => {
    const r = await enJaula(
      [
        "const fs=require('node:fs');",
        "try { fs.writeFileSync('/tmp/gordo', Buffer.alloc(9*1024*1024)); console.log('CABIO'); }",
        "catch (e) { console.log('TMP_', e.code); }"
      ].join("")
    );
    expect(r.salida).toContain("TMP_");
    expect(r.salida).not.toContain("CABIO");
  });

  it("un fichero mayor que RLIMIT_FSIZE se corta", async () => {
    const r = await enJaula(
      [
        "const fs=require('node:fs');",
        "try { fs.writeFileSync('/proyecto/gordo', Buffer.alloc(9*1024*1024)); console.log('CABIO'); }",
        "catch (e) { console.log('FSIZE_', e.code); }"
      ].join(""),
      { ficheroBloques: 4096 }
    );
    expect(r.salida).toContain("FSIZE_");
  });
});

describe("jaulaDisponible", () => {
  it("coincide con lo que responde el propio bwrap", () => {
    const real = spawnSync("bwrap", ["--version"], { encoding: "utf8" }).status === 0;
    expect(disponible).toBe(real);
  });
});

describe.runIf(!disponible)("sin jaula no se finge aislamiento", () => {
  it("ejecutarEnJaula falla en vez de correr en el proceso del servidor", async () => {
    await expect(ejecutarEnJaula({ workdir, cmd: ["true"], env: {} }, LIMITES)).rejects.toThrow(/aislamiento/i);
  });
});
