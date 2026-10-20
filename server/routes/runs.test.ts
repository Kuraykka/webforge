import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jaulaDisponible } from "../run/runner.ts";
import {
  closeApp,
  cuentaVerificada,
  get,
  makeApp,
  mutate,
  post,
  type TestApp,
} from "../testing.ts";

interface RunPublicada {
  id: string;
  projectId: string;
  tipo: string;
  archivo: string | null;
  estado: string;
  codigo: number | null;
  senal: string | null;
  ms: number | null;
  salidaBytes: number;
  truncado: boolean;
  creadaEn: string;
  terminadaEn: string | null;
}

let target: TestApp;
let app: FastifyInstance;

beforeEach(() => {
  target = makeApp();
  app = target.app;
});

afterEach(async () => {
  await closeApp(target);
});

function data<T>(res: { payload: string }): T {
  return JSON.parse(res.payload) as T;
}

async function cuenta(destino: TestApp = target, email = "ana@dominio.dev"): Promise<string> {
  return cuentaVerificada(destino, email);
}

async function proyecto(destino: FastifyInstance, cookie: string, files: Record<string, string>): Promise<string> {
  const res = await post(destino, "/api/projects", { name: "Mi tienda", stack: "static", files }, cookie);
  return data<{ project: { id: string } }>(res).project.id;
}

const base = (id: string) => `/api/projects/${id}/runs`;
const conJaula = jaulaDisponible();

describe("permisos del recurso de ejecuciones", () => {
  it("sin sesión no se lista ni se lanza", async () => {
    expect((await get(app, base("cualquiera"))).statusCode).toBe(401);
    expect((await post(app, base("cualquiera"), { tipo: "comprobar" })).statusCode).toBe(401);
  });

  it("un proyecto que no existe responde 404 en las tres rutas", async () => {
    const cookie = await cuenta();
    expect((await get(app, base("no-existe"), cookie)).statusCode).toBe(404);
    expect((await post(app, base("no-existe"), { tipo: "comprobar" }, cookie)).statusCode).toBe(404);
    expect((await get(app, `${base("no-existe")}/alguna`, cookie)).statusCode).toBe(404);
  });

  it("lo de otra cuenta no existe", async () => {
    const dono = await cuenta(target, "dona@dominio.dev");
    const ajeno = await cuenta(target, "ajena@dominio.dev");
    const id = await proyecto(app, dono, { "index.html": "<p>hola</p>" });
    expect((await get(app, base(id), ajeno)).statusCode).toBe(404);
    expect((await post(app, base(id), { tipo: "comprobar" }, ajeno)).statusCode).toBe(404);
  });
});

describe("validación de la solicitud", () => {
  it("un tipo que no tiene receta se rechaza antes de ejecutar nada", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "index.html": "<p>hola</p>" });
    const res = await post(app, base(id), { tipo: "instalar-dependencias" }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/tipo/i);
    expect((await get(app, base(id), cookie)).payload).toContain('"runs":[]');
  });

  it("ejecutar un archivo que no está en el proyecto se rechaza", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "index.html": "<p>hola</p>" });
    const res = await post(app, base(id), { tipo: "script", archivo: "falta.js" }, cookie);
    expect(res.statusCode).toBe(400);
    expect(data<{ error: string }>(res).error).toMatch(/no existe/i);
    expect((await get(app, base(id), cookie)).payload).toContain('"runs":[]');
  });

  it("una ruta de archivo que sale del proyecto se rechaza", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "index.html": "<p>hola</p>" });
    const res = await post(app, base(id), { tipo: "script", archivo: "../../etc/passwd" }, cookie);
    expect(res.statusCode).toBe(400);
    expect((await get(app, base(id), cookie)).payload).toContain('"runs":[]');
  });
});

describe("estado del aislamiento", () => {
  interface Estado {
    jaula: {
      disponible: boolean;
      binario: string;
      red: boolean;
      tipos: string[];
      limites: Record<string, number>;
    };
  }

  it("sin sesión no se enseña ni la configuración del servidor", async () => {
    expect((await get(app, "/api/runs/estado")).statusCode).toBe(401);
  });

  it("dice el ejecutable, los topes y que la red está cortada, sin destapar rutas del host", async () => {
    const cookie = await cuenta();
    const res = await get(app, "/api/runs/estado", cookie);
    expect(res.statusCode).toBe(200);
    const { jaula } = data<Estado>(res);
    expect(jaula.binario).toBe("bwrap");
    expect(jaula.red).toBe(false);
    expect(jaula.tipos).toEqual(["script", "comprobar"]);
    expect(jaula.limites.tiempoRealMs).toBeGreaterThan(0);
    expect(jaula.limites.tmpfsBytes).toBeGreaterThan(0);
    // La raiz donde se copian los proyectos es un dato del host, no del usuario.
    expect(res.payload).not.toContain("webforge-runs");
  });

  it("un servidor sin jaula lo dice en vez de prometer ejecuciones", async () => {
    const otro = makeApp({ WEBFORGE_JAULA_BIN: "/no/existe/bwrap" });
    try {
      const cookie = await cuenta(otro, "sin@dominio.dev");
      const res = await get(otro.app, "/api/runs/estado", cookie);
      expect(res.statusCode).toBe(200);
      expect(data<Estado>(res).jaula.disponible).toBe(false);
    } finally {
      await closeApp(otro);
    }
  });
});

describe("las ejecuciones de toda la cuenta", () => {
  it("sin sesión no se listan", async () => {
    expect((await get(app, "/api/runs")).statusCode).toBe(401);
  });

  it("la cuenta ve lo de todos sus proyectos, de la más nueva a la más antigua y sin registros", async () => {
    const cookie = await cuenta();
    const uno = await proyecto(app, cookie, { "a.js": "console.log(1)" });
    const dos = await proyecto(app, cookie, { "b.js": "console.log(2)" });
    await post(app, base(uno), { tipo: "script", archivo: "a.js" }, cookie);
    await post(app, base(dos), { tipo: "script", archivo: "b.js" }, cookie);

    const res = await get(app, "/api/runs", cookie);
    expect(res.statusCode).toBe(200);
    const cuerpo = data<{ runs: { projectId: string; nombreProyecto: string; archivo: string | null }[] }>(res);
    expect(cuerpo.runs).toHaveLength(2);
    expect(cuerpo.runs.map((run) => run.archivo)).toEqual(["b.js", "a.js"]);
    expect(cuerpo.runs.every((run) => [uno, dos].includes(run.projectId))).toBe(true);
    expect(cuerpo.runs[0]?.nombreProyecto).toBe("Mi tienda");
    expect(res.payload).not.toContain("console.log");
  });
});

describe.runIf(conJaula)("ejecutar dentro de la jaula", () => {
  it("un script del proyecto corre y su log se guarda", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "saludo.js": "console.log('hola desde la jaula')" });
    const res = await post(app, base(id), { tipo: "script", archivo: "saludo.js" }, cookie);
    expect(res.statusCode).toBe(200);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    expect(cuerpo.run.estado).toBe("terminada");
    expect(cuerpo.run.codigo).toBe(0);
    expect(cuerpo.run.terminadaEn).not.toBeNull();
    expect(cuerpo.log).toContain("hola desde la jaula");
  });

  it("un error del script queda registrado como ejecución fallida", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "rota.js": "throw new Error('petardo el script')" });
    const res = await post(app, base(id), { tipo: "script", archivo: "rota.js" }, cookie);
    expect(res.statusCode).toBe(200);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    expect(cuerpo.run.estado).toBe("fallida");
    expect(cuerpo.run.codigo).not.toBe(0);
    expect(cuerpo.log).toContain("petardo el script");
  });

  it("el comprobador revisa el proyecto dentro de la jaula y señala lo que falla", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "index.html": '<!doctype html>\n<html lang="es"><head><title>Tienda</title></head><body><img src="foto.png"></body></html>\n'
    });
    const res = await post(app, base(id), { tipo: "comprobar" }, cookie);
    expect(res.statusCode).toBe(200);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    expect(cuerpo.run.tipo).toBe("comprobar");
    expect(cuerpo.run.archivo).toBeNull();
    expect(cuerpo.run.estado).toBe("fallida");
    expect(cuerpo.log).toContain("index.html");
    expect(cuerpo.log).toMatch(/alt/);
  });

  it("un proyecto sano pasa la comprobación", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "index.html":
        '<!doctype html>\n<html lang="es"><head><title>Tienda</title><link rel="stylesheet" href="styles.css"></head><body><img src="foto.png" alt="Producto"></body></html>\n',
      "styles.css": "body { color: #111 }",
      "datos.json": '{"precio": 12}',
      "foto.png": ""
    });
    const res = await post(app, base(id), { tipo: "comprobar" }, cookie);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    expect(cuerpo.run.estado).toBe("terminada");
    expect(cuerpo.log).toContain("0 errores");
  });

  it("el secreto del servidor no llega al proceso ni al log", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "espia.js": "console.log('SECRETO=' + (process.env.WEBFORGE_SESSION_SECRET ?? 'nada'))"
    });
    const res = await post(app, base(id), { tipo: "script", archivo: "espia.js" }, cookie);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    expect(cuerpo.log).toContain("SECRETO=nada");
    expect(cuerpo.log).not.toContain("clave-de-prueba");
  });

  it("las variables declaradas entran en la jaula y el registro no guarda su valor", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "vars.js": "console.log('URL=' + (process.env.API_URL ?? 'nada'), 'SECRETO=' + (process.env.TOKEN ?? 'nada'))"
    });
    const guardada = await mutate(
      app,
      "PUT",
      `/api/projects/${id}/env`,
      { environment: "desarrollo", key: "API_URL", value: "https://example.test" },
      cookie
    );
    expect(guardada.statusCode).toBe(200);

    const res = await post(app, base(id), { tipo: "script", archivo: "vars.js", entorno: "desarrollo" }, cookie);
    const cuerpo = data<{ run: RunPublicada; log: string }>(res);
    // Lo impreso por el script del dueño es su log; lo que la plataforma no hace es copiar el valor
    // a ningún campo propio ni enseñarlo en la lista de variables sin revelarlo.
    expect(cuerpo.log).toContain("URL=https://example.test");
    expect(cuerpo.log).toContain("SECRETO=nada");
    expect(JSON.stringify(cuerpo.run)).not.toContain("https://example.test");
    expect(data<{ variables: { value?: string }[] }>(
      await get(app, `/api/projects/${id}/env?environment=desarrollo`, cookie)
    ).variables[0]?.value).toBeUndefined();

    const leido = await get(app, `${base(id)}/${cuerpo.run.id}`, cookie);
    expect(data<{ log: string }>(leido).log).toContain("URL=https://example.test");
  });

  it("sin entorno pedido no se inyecta ninguna variable del proyecto", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "silencio.js": "console.log('URL=' + (process.env.API_URL ?? 'nada'))"
    });
    await mutate(app, "PUT", `/api/projects/${id}/env`, { environment: "desarrollo", key: "API_URL", value: "visible" }, cookie);
    const res = await post(app, base(id), { tipo: "script", archivo: "silencio.js" }, cookie);
    expect(data<{ log: string }>(res).log).toContain("URL=nada");
  });

  it("la red del proceso está cortada", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, {
      "red.js": "fetch('http://1.1.1.1').then(() => console.log('RED_OK'), (e) => console.log('RED_', e.cause?.code ?? e.code))"
    });
    const res = await post(app, base(id), { tipo: "script", archivo: "red.js" }, cookie);
    const cuerpo = data<{ log: string }>(res);
    expect(cuerpo.log).toContain("RED_");
    expect(cuerpo.log).not.toContain("RED_OK");
  });

  it("lo que escribe el script no vuelve al proyecto", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "escribe.js": "require('node:fs').writeFileSync('/proyecto/extra.txt', 'x')" });
    const res = await post(app, base(id), { tipo: "script", archivo: "escribe.js" }, cookie);
    expect(data<{ run: RunPublicada }>(res).run.estado).toBe("terminada");
    const archivos = await get(app, `/api/projects/${id}/files`, cookie);
    expect(archivos.payload).not.toContain("extra.txt");
  });

  it("un proceso que no termina se corta por reloj y queda cancelado", async () => {
    const otro = makeApp({ WEBFORGE_RUN_TIEMPO_MS: "1200" });
    try {
      const session = await cuentaVerificada(otro, "lenta@dominio.dev");
      const id = await proyecto(otro.app, session, { "eterna.js": "setTimeout(() => {}, 60000)" });
      // El workdir de esta prueba vive en /tmp: la configuración de test usa una raiz del propio tmpdir.
      const res = await mutate(otro.app, "POST", base(id), { tipo: "script", archivo: "eterna.js" }, session);
      expect(res.statusCode).toBe(200);
      const cuerpo = data<{ run: RunPublicada }>(res);
      expect(cuerpo.run.estado).toBe("cancelada");
    } finally {
      await closeApp(otro);
    }
  }, 30_000);

  it("la lista va de la más nueva a la más antigua y sin logs", async () => {
    const cookie = await cuenta();
    const id = await proyecto(app, cookie, { "corta.js": "console.log('una')" });
    await post(app, base(id), { tipo: "script", archivo: "corta.js" }, cookie);
    await post(app, base(id), { tipo: "script", archivo: "corta.js" }, cookie);
    const res = await get(app, base(id), cookie);
    const cuerpo = data<{ runs: RunPublicada[] }>(res);
    expect(cuerpo.runs).toHaveLength(2);
    expect(cuerpo.runs[0]?.terminadaEn).not.toBeNull();
    expect(res.payload).not.toContain("una");
  });

  it("una ejecución de otra cuenta no se puede leer", async () => {
    const dono = await cuenta(target, "dona@dominio.dev");
    const ajena = await cuenta(target, "ajena@dominio.dev");
    const id = await proyecto(app, dono, { "corta.js": "console.log('privado')" });
    const creado = data<{ run: RunPublicada }>(await post(app, base(id), { tipo: "script", archivo: "corta.js" }, dono));
    expect((await get(app, `${base(id)}/${creado.run.id}`, ajena)).statusCode).toBe(404);
    const propioAjeno = await proyecto(app, ajena, { "corta.js": "console.log('otro')" });
    expect((await get(app, `${base(propioAjeno)}/${creado.run.id}`, ajena)).statusCode).toBe(404);
  });
});

describe("sin aislamiento no se finge ninguna ejecución", () => {
  it("el servidor contesta 503 cuando el ejecutable de la jaula falta", async () => {
    const otro = makeApp({ WEBFORGE_JAULA_BIN: "/no/existe/bwrap" });
    try {
      const cookie = await cuenta(otro, "sin@dominio.dev");
      const id = await proyecto(otro.app, cookie, { "a.js": "console.log(1)" });
      const r = await post(otro.app, base(id), { tipo: "script", archivo: "a.js" }, cookie);
      expect(r.statusCode).toBe(503);
      expect(data<{ error: string }>(r).error).toMatch(/aislamiento/i);
      // Tampoco queda una fila abierta que bloquee el proyecto ni un historial de intentos.
      expect((await get(otro.app, base(id), cookie)).payload).toContain('"runs":[]');
    } finally {
      await closeApp(otro);
    }
  });
});
