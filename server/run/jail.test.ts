import { describe, expect, it } from "vitest";
import { argvDeJaula, RAICES_POR_DEFECTO, type LimitesDeJaula, type PeticionDeJaula } from "./jail.ts";

const LIMITES: LimitesDeJaula = {
  cpuSegundos: 20,
  ficheroBloques: 8192,
  tmpfsBytes: 8 * 1024 * 1024,
  procesos: 256,
  memoriaHeapMB: 512,
  descriptores: 256,
  tiempoRealMs: 30_000,
  salidaBytes: 64 * 1024,
  red: false
};

const RAICES = ["/usr", "/bin", "/lib", "/lib64"];

const peticion = (extra: Partial<PeticionDeJaula> = {}): PeticionDeJaula => ({
  workdir: "/tmp/wf-run/abc",
  cmd: ["node", "index.js"],
  env: { WEBFORGE_COMPROBACION: "sintaxis" },
  ...extra
});

describe("argvDeJaula", () => {
  it("monta el sistema de solo lectura y el proyecto escribible", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    for (const raiz of RAICES) expect(argv).toEqual(expect.arrayContaining(["--ro-bind", raiz, raiz]));
    expect(argv).toEqual(expect.arrayContaining(["--bind", "/tmp/wf-run/abc", "/proyecto"]));
    expect(argv).toEqual(expect.arrayContaining(["--chdir", "/proyecto"]));
  });

  it("ninguna montaje da acceso al raiz del host", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    const montajes = argv.filter((_, i) => argv[i - 1] === "--bind" || argv[i - 1] === "--ro-bind");
    expect(montajes).not.toContain("/");
    expect(argv).not.toContain("--dev-bind");
  });

  it("/tmp es un tmpfs con tope de bytes", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    const i = argv.indexOf("--tmpfs");
    expect(argv.slice(i - 2, i + 2)).toEqual(["--size", String(LIMITES.tmpfsBytes), "--tmpfs", "/tmp"]);
  });

  it("corta la red salvo que la petición la pida", () => {
    expect(argvDeJaula(peticion(), LIMITES, RAICES)).not.toContain("--share-net");
    expect(argvDeJaula(peticion(), { ...LIMITES, red: true }, RAICES)).toContain("--share-net");
  });

  it("aísla procesos, usuario y cgroup y muere con el padre", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    expect(argv).toEqual(expect.arrayContaining(["--unshare-all", "--unshare-pid", "--die-with-parent"]));
  });

  it("renuncia a las capacidades del namespace", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    expect(argv).toEqual(expect.arrayContaining(["--cap-drop", "ALL"]));
  });

  it("limpia el entorno y solo introduce lo declarado", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    expect(argv).toContain("--clearenv");
    const pares: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "--setenv") pares.push(`${argv[i + 1]}=${argv[i + 2]}`);
    }
    const nombradas = pares.filter((p) => p.startsWith("WEBFORGE_"));
    expect(nombradas).toEqual(["WEBFORGE_COMPROBACION=sintaxis"]);
    expect(pares.some((p) => /^(PATH|HOME|TMPDIR)=/.test(p))).toBe(true);
    expect(pares.some((p) => /SECRET|TOKEN|PASSWORD|KEY/i.test(p))).toBe(false);
  });

  it("los límites de cpu, tamaño de fichero y volcado viajan como ulimit", () => {
    const argv = argvDeJaula(peticion(), LIMITES, RAICES);
    const cola = argv.slice(argv.indexOf("--"));
    expect(cola.slice(0, 3)).toEqual(["--", "/bin/bash", "-c"]);
    expect(cola[3]).toContain(`ulimit -t ${LIMITES.cpuSegundos}`);
    expect(cola[3]).toContain(`ulimit -f ${LIMITES.ficheroBloques}`);
    expect(cola[3]).toContain("ulimit -c 0");
    expect(cola[3]).toContain(`ulimit -u ${LIMITES.procesos}`);
    expect(cola[3]).toContain(`--max-old-space-size=${LIMITES.memoriaHeapMB}`);
    expect(cola[3]).toContain(`ulimit -n ${LIMITES.descriptores}`);
    expect(cola[3]).toContain('exec "$@"');
  });

  it("el comando del proyecto va como argumentos, no interpolado en la shell", () => {
    const argv = argvDeJaula(peticion({ cmd: ["node", "-e", "console.log(';rm -rf /;')"] }), LIMITES, RAICES);
    const cola = argv.slice(argv.indexOf("--"));
    expect(cola).toEqual([
      "--",
      "/bin/bash",
      "-c",
      cola[3],
      "bash",
      "node",
      "-e",
      "console.log(';rm -rf /;')"
    ]);
  });

  it("acepta una ruta de montaje distinta para el proyecto", () => {
    const argv = argvDeJaula(peticion({ destino: "/app" }), LIMITES, RAICES);
    expect(argv).toEqual(expect.arrayContaining(["--bind", "/tmp/wf-run/abc", "/app", "--chdir", "/app"]));
  });

  it("las raices por defecto son carpetas del sistema, nunca el proyecto", () => {
    expect(RAICES_POR_DEFECTO).toContain("/usr");
    expect(RAICES_POR_DEFECTO).not.toContain("/");
    expect(RAICES_POR_DEFECTO.every((r) => r.startsWith("/"))).toBe(true);
  });
});
