import { hash } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeApp,
  CSRF,
  cookieFor,
  cuentaVerificada,
  get,
  lastTokenFor,
  makeApp,
  PASSWORD,
  post,
  sessionCookie,
  verificarCuenta,
  type TestApp
} from "../testing.ts";
import { requireAdmin, requireAuth, SESSION_COOKIE } from "../app.ts";
import { createSession } from "../auth/sessions.ts";
import { listOutbox, queueMessage } from "../auth/outbox.ts";
import { insertUser, setEmailVerified, setUserRole, userByEmail } from "../repositories/users.ts";
import { verifyPassword } from "../auth/password.ts";
import { writeSetting } from "../db.ts";

const EMAIL = "ana@dominio.dev";

let target: TestApp;
let app: FastifyInstance;

beforeEach(() => {
  target = makeApp();
  app = target.app;
});

afterEach(async () => {
  await closeApp(target);
});

async function register(email = EMAIL, password = PASSWORD) {
  const res = await post(app, "/api/auth/register", { email, password });
  return { res, cookie: sessionCookie(res) };
}

const verificar = (email = EMAIL) => verificarCuenta(app, target.db, email);
const entrar = (email = EMAIL, password = PASSWORD) => cuentaVerificada(target, email, password);

function setCookieLine(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const line = Array.isArray(raw) ? raw[0] : raw;
  return String(line ?? "");
}

function body(res: { payload: string }): Record<string, unknown> {
  return JSON.parse(res.payload) as Record<string, unknown>;
}

describe("respuestas base", () => {
  it("todo /api lleva cabeceras de seguridad", async () => {
    const res = await get(app, "/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin"
    });
  });

  it("una ruta desconocida responde 404 sin Volcar la pila", async () => {
    const res = await get(app, "/api/no-existe");
    expect(res.statusCode).toBe(404);
    expect(res.payload).not.toMatch(/at |Error:|sqlite/i);
  });
});

describe("anti-CSRF", () => {
  it("toda mutación sin la cabecera de la aplicación es 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email: EMAIL, password: PASSWORD })
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).error).toMatch(/cabecera/);
  });

  it("un origen distinto del servidor y no declarado se rechaza", async () => {
    const res = await post(app, "/api/auth/register", { email: EMAIL, password: PASSWORD }, null, {
      origin: "http://malicioso.dev"
    });
    expect(res.statusCode).toBe(403);
    expect(userByEmail(target.db, EMAIL)).toBeUndefined();
  });

  it("un origen declarado como de confianza pasa", async () => {
    const abierto = makeApp({ WEBFORGE_ALLOWED_ORIGINS: "http://panel.interno" });
    const res = await post(abierto.app, "/api/auth/register", { email: EMAIL, password: PASSWORD }, null, {
      origin: "http://panel.interno"
    });
    expect(res.statusCode).toBe(201);
    await abierto.app.close();
    abierto.db.close();
  });

  it("las lecturas no necesitan la cabecera", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(res.statusCode).toBe(200);
  });
});

describe("configuración pública", () => {
  it("lee el registro abierto o cerrado desde la base", async () => {
    expect(body(await get(app, "/api/auth/config"))).toEqual({ registrationAllowed: true });
    writeSetting(target.db, "allow_registration", "0");
    expect(body(await get(app, "/api/auth/config"))).toEqual({ registrationAllowed: false });
  });
});

describe("registro", () => {
  it("crea la cuenta sin abrir sesión y encola el enlace de tres minutos", async () => {
    const { res, cookie } = await register();
    expect(res.statusCode).toBe(201);
    expect(body(res).user).toMatchObject({ email: EMAIL, role: "user", status: "activa", verifiedAt: null });
    expect(body(res).verificationRequired).toBe(true);
    expect(res.payload).not.toMatch(/password|argon2|token_hash/);
    expect(cookie).toBeNull();

    const session = await get(app, "/api/auth/session", cookie);
    expect(session.statusCode).toBe(401);

    const stored = userByEmail(target.db, EMAIL)?.password_hash ?? "";
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(res.payload).not.toContain(stored);

    const messages = listOutbox(target.db, 10);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ recipient: EMAIL, sentAt: null });
    expect(messages[0]?.subject).toMatch(/Confirma tu correo/);
    expect(messages[0]?.body).toMatch(/tres minutos/);
    expect(messages[0]?.actionUrl.startsWith("/verificar-correo?token=")).toBe(true);
  });

  it("el enlace caduca a los tres minutos y entonces hay que pedir otro", async () => {
    await register();
    const token = lastTokenFor(target.db, EMAIL, "verificacion");
    if (!token) throw new Error("Sin enlace en el outbox.");
    target.db.run("update email_tokens set expires_at = ?", new Date(Date.now() - 1000).toISOString());
    const tarde = await post(app, "/api/auth/verify-email", { token });
    expect(tarde.statusCode).toBe(400);
    expect(body(tarde).error).toMatch(/caduc|no es válido/);
    expect(userByEmail(target.db, EMAIL)?.verified_at).toBeNull();

    const reenvio = await post(app, "/api/auth/verify-email/resend", { email: EMAIL });
    expect(reenvio.statusCode).toBe(202);
    await verificar();
    expect(userByEmail(target.db, EMAIL)?.verified_at).toBeTypeOf("string");
  });

  it("el reenvío no revela qué correos tienen cuenta ni manda correo a una verificada", async () => {
    const ajeno = await post(app, "/api/auth/verify-email/resend", { email: "nadie@dominio.dev" });
    expect(ajeno.statusCode).toBe(202);
    expect(listOutbox(target.db, 10)).toHaveLength(0);

    await register();
    const duplicado = await post(app, "/api/auth/verify-email/resend", { email: EMAIL });
    expect(duplicado.statusCode).toBe(202);
    expect(listOutbox(target.db, 10)).toHaveLength(1);

    await verificar();
    const verificada = await post(app, "/api/auth/verify-email/resend", { email: EMAIL });
    expect(verificada.statusCode).toBe(202);
    expect(listOutbox(target.db, 10)).toHaveLength(1);
  });

  it("la cookie de sesión es HttpOnly, estricta y de camino raíz", async () => {
    await register();
    await verificar();
    const acceso = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(acceso.statusCode).toBe(200);
    const line = setCookieLine(acceso);
    expect(line.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=Strict");
    expect(line).toContain("Path=/");
    expect(line).not.toContain("Domain=");
  });

  it("valida el correo y la contraseña", async () => {
    expect((await register("sin-arroba", PASSWORD)).res.statusCode).toBe(400);
    expect((await register(EMAIL, "corta")).res).toMatchObject({ statusCode: 400 });
    const weak = await register(EMAIL, "corta");
    expect(body(weak.res).error).toMatch(/12 caracteres/);
  });

  it("no permite dos cuentas con el mismo correo aunque cambien las mayúsculas", async () => {
    expect((await register()).res.statusCode).toBe(201);
    const dup = await register("ANA@Dominio.Dev", "otra-contrasena-123");
    expect(dup.res.statusCode).toBe(409);
    expect(body(dup.res).error).toMatch(/ya existe/i);
  });

  it("con el auto-registro cerrado responde 409", async () => {
    writeSetting(target.db, "allow_registration", "0");
    const res = (await register()).res;
    expect(res.statusCode).toBe(409);
    expect(body(res).error).toMatch(/desactivado/);
  });
});

describe("acceso", () => {
  it("abre sesión y anota el último acceso", async () => {
    await register();
    await verificar();
    const res = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(body(res).user).toMatchObject({ email: EMAIL, verifiedAt: expect.any(String), lastLoginAt: expect.any(String) });
    const session = await get(app, "/api/auth/session", sessionCookie(res));
    expect(body(session).user).toMatchObject({ email: EMAIL });
  });

  it("sin verificar el correo no hay sesión, aunque la contraseña sea buena", async () => {
    await register();
    const res = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(403);
    expect(sessionCookie(res)).toBeNull();
    expect(body(res).error).toMatch(/verifica/i);
    expect(body(res).verificationRequired).toBe(true);
    expect((await get(app, "/api/auth/session", sessionCookie(res))).statusCode).toBe(401);
  });

  it("la respuesta es la misma si el correo no existe que si falla la contraseña", async () => {
    const desconocido = await post(app, "/api/auth/login", { email: "nadie@dominio.dev", password: PASSWORD });
    await register();
    const erroneo = await post(app, "/api/auth/login", { email: EMAIL, password: "contrasena-erronea-1" });
    expect(erroneo.statusCode).toBe(401);
    expect(desconocido.statusCode).toBe(401);
    expect(desconocido.payload).toBe(erroneo.payload);
  });

  it("mejora un hash con parámetros antiguos al iniciar sesión", async () => {
    const flojo = await hash(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    const creada = insertUser(target.db, { email: EMAIL, passwordHash: flojo, role: "user" });
    setEmailVerified(target.db, creada.id);
    const res = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    const row = userByEmail(target.db, EMAIL);
    expect(row?.password_hash).not.toBe(flojo);
    expect(row?.password_hash).toContain("$argon2id$");
  });

  it("sin cookie no hay sesión", async () => {
    expect((await get(app, "/api/auth/session")).statusCode).toBe(401);
  });

  it("una cookie manipulada o sin firmar no autenticada", async () => {
    await entrar();
    expect((await get(app, "/api/auth/session", `${SESSION_COOKIE}=abc.def`)).statusCode).toBe(401);
    expect((await get(app, "/api/auth/session", `${SESSION_COOKIE}=abc`)).statusCode).toBe(401);
  });

  it("una cuenta suspendida pierde el acceso en caliente", async () => {
    const cookie = await entrar();
    const row = userByEmail(target.db, EMAIL);
    expect(row).toBeDefined();
    target.db.run("update users set status = 'suspendida' where id = ?", row?.id ?? "");
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(401);
  });
});

// Tres argon2 seguidos no caben en el presupuesto corto: `testTimeout` de la configuración
// (20 s) es el margen que les vale cuando la suite entera va en paralelo.
describe("bloqueo por intentos", () => {
  it("al tercer fallo responde 429 con un día de espera y ni la contraseña buena entra", async () => {
    await register();
    await verificar();
    let ultimo = 0;
    for (let i = 0; i < 2; i++) {
      ultimo = (await post(app, "/api/auth/login", { email: EMAIL, password: "mal-contrasena-prueba" })).statusCode;
    }
    expect(ultimo).toBe(401);
    const tercero = await post(app, "/api/auth/login", { email: EMAIL, password: "mal-contrasena-prueba" });
    expect(tercero.statusCode).toBe(429);
    expect(Number(tercero.headers["retry-after"])).toBe(24 * 3600);
    const blocked = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(24 * 3600);
    expect(body(blocked).error).toMatch(/24 horas/);
  });

  it("un acceso correcto borra el contador", async () => {
    await register();
    await verificar();
    await post(app, "/api/auth/login", { email: EMAIL, password: "mal-contrasena-prueba" });
    await post(app, "/api/auth/login", { email: EMAIL, password: "mal-contrasena-prueba" });
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD })).statusCode).toBe(200);
    expect(
      target.db.get<{ total: number }>("select count(*) as total from login_attempts")?.total
    ).toBe(0);
  });
});

describe("salida y sesiones abiertas", () => {
  it("el cierre invalida la sesión y caduca la cookie", async () => {
    const cookie = await entrar();
    const res = await post(app, "/api/auth/logout", {}, cookie);
    expect(res.statusCode).toBe(204);
    expect(setCookieLine(res)).toContain("Max-Age=0");
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(401);
  });

  it("cerrar sesión sin estar dentro no falla", async () => {
    expect((await post(app, "/api/auth/logout", {}, null)).statusCode).toBe(204);
  });

  it("lista las sesiones y marca la actual", async () => {
    const cookie = await entrar();
    const otra = createSession(target.db, { userId: userByEmail(target.db, EMAIL)?.id ?? "", userAgent: "mvil", ip: "10.0.0.9", ttlMs: 3600_000 });
    const res = await get(app, "/api/auth/sessions", cookie);
    const sessions = body(res).sessions as { id: string; userAgent: string; current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.find((s) => s.userAgent === "mvil")?.current).toBe(false);
    expect(otra.id).toBeTruthy();
  });

  it("revocar una sesión deja de resolverla", async () => {
    const cookie = await entrar();
    const userId = userByEmail(target.db, EMAIL)?.id ?? "";
    const otra = createSession(target.db, { userId, userAgent: "mvil", ip: "10.0.0.9", ttlMs: 3600_000 });
    const res = await post(app, "/api/auth/sessions/revoke", { id: otra.id }, cookie);
    expect(res.statusCode).toBe(200);
    expect((await get(app, "/api/auth/session", cookieFor(app, otra.token))).statusCode).toBe(401);
  });

  it("no se puede revocar la sesión de otra cuenta", async () => {
    const cookie = await entrar();
    const ajeno = insertUser(target.db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" });
    const ajena = createSession(target.db, { userId: ajeno.id, userAgent: "ua", ip: "10.0.0.8", ttlMs: 3600_000 });
    const res = await post(app, "/api/auth/sessions/revoke", { id: ajena.id }, cookie);
    expect(res.statusCode).toBe(404);
    expect((await get(app, "/api/auth/session", cookieFor(app, ajena.token))).statusCode).toBe(200);
  });
});

describe("contraseña desde la sesión abierta", () => {
  it("exige la actual y cumple la política", async () => {
    const cookie = await entrar();
    expect((await post(app, "/api/auth/password", { currentPassword: "no-es-la-mia-1234", newPassword: "nueva-segura-1234" }, cookie)).statusCode).toBe(401);
    expect((await post(app, "/api/auth/password", { currentPassword: PASSWORD, newPassword: "corta" }, cookie)).statusCode).toBe(400);
    const ok = await post(app, "/api/auth/password", { currentPassword: PASSWORD, newPassword: "nueva-segura-1234" }, cookie);
    expect(body(ok)).toEqual({ changed: true, revokedSessions: 0 });
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(200);
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: "nueva-segura-1234" })).statusCode).toBe(200);
  });

  it("cierra las demás sesiones y deja la que autoriza", async () => {
    const cookie = await entrar();
    const userId = userByEmail(target.db, EMAIL)?.id ?? "";
    const mvil = createSession(target.db, { userId, userAgent: "mvil", ip: "10.0.0.9", ttlMs: 3600_000 });
    const res = await post(app, "/api/auth/password", { currentPassword: PASSWORD, newPassword: "nueva-segura-1234" }, cookie);
    expect(body(res)).toEqual({ changed: true, revokedSessions: 1 });
    expect((await get(app, "/api/auth/session", cookieFor(app, mvil.token))).statusCode).toBe(401);
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(200);
  });

  it("sin sesión no se cambia la contraseña", async () => {
    expect((await post(app, "/api/auth/password", { currentPassword: PASSWORD, newPassword: "nueva-segura-1234" }, null)).statusCode).toBe(401);
  });
});

describe("restablecer por correo", () => {
  it("no revela si el correo existe y no deja mensaje cuando no existe", async () => {
    const res = await post(app, "/api/auth/password/reset", { email: "nadie@dominio.dev" });
    expect(res.statusCode).toBe(202);
    expect(body(res)).toEqual({ accepted: true });
    expect(listOutbox(target.db, 10)).toHaveLength(0);
  });

  it("emite un enlace de un solo uso que cambia la contraseña y cierra todo", async () => {
    const cookie = await entrar();
    const userId = userByEmail(target.db, EMAIL)?.id ?? "";
    const mvil = createSession(target.db, { userId, userAgent: "mvil", ip: "10.0.0.9", ttlMs: 3600_000 });

    const res = await post(app, "/api/auth/password/reset", { email: EMAIL });
    expect(res.statusCode).toBe(202);
    const token = lastTokenFor(target.db, EMAIL, "restablecimiento");
    expect(token).toBeTruthy();

    const confirm = await post(app, "/api/auth/password/reset/confirm", { token, newPassword: "recuperada-segura-1" });
    expect(confirm.statusCode).toBe(204);
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(401);
    expect((await get(app, "/api/auth/session", cookieFor(app, mvil.token))).statusCode).toBe(401);
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: "recuperada-segura-1" })).statusCode).toBe(200);
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD })).statusCode).toBe(401);
  });

  it("restablecer la contraseña levanta el bloqueo de un día", async () => {
    await register();
    await verificar();
    for (let i = 0; i < 3; i += 1) {
      await post(app, "/api/auth/login", { email: EMAIL, password: "mal-contrasena-prueba" });
    }
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD })).statusCode).toBe(429);

    await post(app, "/api/auth/password/reset", { email: EMAIL });
    const token = lastTokenFor(target.db, EMAIL, "restablecimiento");
    const confirm = await post(app, "/api/auth/password/reset/confirm", { token, newPassword: "recuperada-segura-1" });
    expect(confirm.statusCode).toBe(204);
    const despues = await post(app, "/api/auth/login", { email: EMAIL, password: "recuperada-segura-1" });
    expect(despues.statusCode).toBe(200);
    expect(target.db.get("select key from login_attempts where key = ?", EMAIL)).toBeUndefined();
  });

  it("un enlace usado, caducado o inválido no cambia nada", async () => {
    await register();
    await post(app, "/api/auth/password/reset", { email: EMAIL });
    const token = lastTokenFor(target.db, EMAIL, "restablecimiento");
    expect((await post(app, "/api/auth/password/reset/confirm", { token, newPassword: "recuperada-segura-1" })).statusCode).toBe(204);
    const reuse = await post(app, "/api/auth/password/reset/confirm", { token, newPassword: "recuperada-segura-2" });
    expect(reuse.statusCode).toBe(400);
    expect(body(reuse).error).toMatch(/no es válido|ya se usó/);
    expect((await post(app, "/api/auth/password/reset/confirm", { token: "inventado", newPassword: "recuperada-segura-3" })).statusCode).toBe(400);
  });

  it("un enlace de verificación no sirve para restablecer", async () => {
    await register();
    const token = lastTokenFor(target.db, EMAIL, "verificacion");
    const res = await post(app, "/api/auth/password/reset/confirm", { token, newPassword: "recuperada-segura-1" });
    expect(res.statusCode).toBe(400);
  });
});

describe("verificación del correo", () => {
  it("el enlace del registro marca la cuenta como verificada", async () => {
    await register();
    const token = lastTokenFor(target.db, EMAIL, "verificacion");
    expect((await post(app, "/api/auth/verify-email", { token })).statusCode).toBe(204);
    expect(userByEmail(target.db, EMAIL)?.verified_at).toBeTypeOf("string");
    expect((await post(app, "/api/auth/verify-email", { token })).statusCode).toBe(400);
  });
});

describe("guardias de rol", () => {
  it("requireAuth y requireAdmin deciden por el rol guardado, no por lo que diga el cliente", async () => {
    app.get("/__sonda", { preHandler: requireAdmin }, async () => ({ ok: true }));
    const cookie = await entrar();
    expect((await get(app, "/__sonda", cookie)).statusCode).toBe(403);
    expect((await get(app, "/__sonda", null)).statusCode).toBe(401);

    const row = userByEmail(target.db, EMAIL);
    setUserRole(target.db, row?.id ?? "", "admin");
    const relogin = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect((await get(app, "/__sonda", sessionCookie(relogin))).statusCode).toBe(200);
  });

  it("requireAuth deja pasar a un usuario normal", async () => {
    app.get("/__lectura", { preHandler: requireAuth }, async () => ({ ok: true }));
    const cookie = await entrar();
    expect(body(await get(app, "/__lectura", cookie))).toEqual({ ok: true });
  });
});

describe("cuerpos malformados", () => {
  it("un JSON roto o sin campos responde 400 genérico y legible", async () => {
    const roto = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json", ...CSRF },
      payload: "{ esto no es json"
    });
    expect(roto.statusCode).toBe(400);
    expect(roto.payload).not.toMatch(/at |Error:/);

    const vacio = await post(app, "/api/auth/login", {});
    expect(vacio.statusCode).toBe(400);
    expect(body(vacio).error).toMatch(/falta el correo|nombre de usuario/i);
  });

  it("un cuerpo que no es objeto se rechaza", async () => {
    const res = await post(app, "/api/auth/login", "hola");
    expect(res.statusCode).toBe(400);
  });

  it("la política de contraseñas se aplica también al cambiar desde la sesión", async () => {
    const cookie = await entrar();
    const res = await post(app, "/api/auth/password", { currentPassword: PASSWORD, newPassword: EMAIL }, cookie);
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/coincidir con tu correo/);
  });
});

describe("outbox", () => {
  it("los mensajes quedan pendientes mientras no haya proveedor de correo", async () => {
    queueMessage(target.db, { recipient: EMAIL, subject: "prueba", body: "cuerpo", actionUrl: "/x" });
    const [first] = listOutbox(target.db, 10);
    expect(first).toMatchObject({ recipient: EMAIL, subject: "prueba", sentAt: null });
  });
});

describe("nombre de usuario", () => {
  it("se puede registrar con usuario y entrar con él", async () => {
    const res = await post(app, "/api/auth/register", { email: "tienda@dominio.dev", password: PASSWORD, username: "Tienda.Ana" });
    expect(res.statusCode).toBe(201);
    expect(body(res).user).toMatchObject({ username: "tienda.ana" });

    await verificar("tienda@dominio.dev");
    const acceso = await post(app, "/api/auth/login", { identifier: "TIENDA.ANA", password: PASSWORD });
    expect(acceso.statusCode).toBe(200);
    expect(body(acceso).user).toMatchObject({ email: "tienda@dominio.dev", username: "tienda.ana" });
    const session = await get(app, "/api/auth/session", sessionCookie(acceso));
    expect(body(session).user).toMatchObject({ username: "tienda.ana" });
  });

  it("sin nombre se deriva del correo y no se repite", async () => {
    const a = await post(app, "/api/auth/register", { email: "ana@dominio.dev", password: PASSWORD });
    expect(body(a).user).toMatchObject({ username: "ana" });
    const b = await post(app, "/api/auth/register", { email: "ana@otro.dev", password: PASSWORD });
    expect(body(b).user).toMatchObject({ username: "ana-2" });
  });

  it("un usuario reservado o repetido se rechaza", async () => {
    const reservado = await post(app, "/api/auth/register", { email: "admin@dominio.dev", password: PASSWORD, username: "admin" });
    expect(reservado.statusCode).toBe(400);
    expect(body(reservado).error).toMatch(/reservado/i);

    await post(app, "/api/auth/register", { email: "uno@dominio.dev", password: PASSWORD, username: "mi-tienda" });
    const repetido = await post(app, "/api/auth/register", { email: "dos@dominio.dev", password: PASSWORD, username: "MI-TIENDA" });
    expect(repetido.statusCode).toBe(409);
    expect(body(repetido).error).toMatch(/usuario/i);
  });

  it("el acceso por correo sigue funcionando", async () => {
    await register();
    await verificar();
    expect((await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD })).statusCode).toBe(200);
  });
});
