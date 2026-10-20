import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { totpCode } from "../auth/totp.ts";
import { closeApp, cuentaVerificada, get, makeApp, post, sessionCookie, type TestApp } from "../testing.ts";

const EMAIL = "ana@dominio.dev";
const PASSWORD = "contrasena-de-prueba-1";

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

async function conSegundoFactor(): Promise<{ cookie: string; secret: string; recoveryCodes: string[] }> {
  const cookie = await cuentaVerificada(target, EMAIL);
  const setup = await post(app, "/api/auth/2fa/setup", {}, cookie);
  expect(setup.statusCode).toBe(200);
  const { secret } = data<{ secret: string }>(setup);
  const confirmar = await post(app, "/api/auth/2fa/confirm", { code: totpCode(secret) }, cookie);
  expect(confirmar.statusCode).toBe(200);
  const { recoveryCodes } = data<{ recoveryCodes: string[] }>(confirmar);
  return { cookie, secret, recoveryCodes };
}

async function desafio(): Promise<{ challenge: string }> {
  const res = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
  expect(res.statusCode).toBe(200);
  expect(sessionCookie(res)).toBeNull();
  return data<{ challenge: string }>(res);
}

describe("activar el segundo factor", () => {
  it("sin sesión no se puede configurar", async () => {
    expect((await post(app, "/api/auth/2fa/setup", {})).statusCode).toBe(401);
    expect((await post(app, "/api/auth/2fa/confirm", { code: "123456" })).statusCode).toBe(401);
  });

  it("genera secreto y URI, y solo se activa con un código válido", async () => {
    const cookie = await cuentaVerificada(target, EMAIL);
    const setup = await post(app, "/api/auth/2fa/setup", {}, cookie);
    const { secret, otpauth } = data<{ secret: string; otpauth: string }>(setup);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauth).toContain(`secret=${secret}`);

    expect(data<{ twoFactor: { enabled: boolean; pending: boolean } }>(await get(app, "/api/auth/2fa", cookie)).twoFactor).toMatchObject({
      enabled: false,
      pending: true
    });
    const malo = await post(app, "/api/auth/2fa/confirm", { code: "000000" }, cookie);
    expect(malo.statusCode).toBe(400);

    const bueno = await post(app, "/api/auth/2fa/confirm", { code: totpCode(secret) }, cookie);
    expect(bueno.statusCode).toBe(200);
    const activado = data<{ enabled: boolean; recoveryCodes: string[] }>(bueno);
    expect(activado.enabled).toBe(true);
    expect(activado.recoveryCodes).toHaveLength(8);
    expect(activado.recoveryCodes[0]).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
    expect(data<{ twoFactor: { enabled: boolean; recoveryCodes: number } }>(await get(app, "/api/auth/2fa", cookie)).twoFactor).toMatchObject({
      enabled: true,
      recoveryCodes: 8
    });
    expect((await post(app, "/api/auth/2fa/setup", {}, cookie)).statusCode).toBe(409);
  });
});

describe("acceso con segundo factor", () => {
  it("la contraseña sola no abre sesión y el código correcto sí", async () => {
    const { secret } = await conSegundoFactor();
    const { challenge } = await desafio();

    const malo = await post(app, "/api/auth/login/2fa", { challenge, code: "000000" });
    expect(malo.statusCode).toBe(401);
    expect(sessionCookie(malo)).toBeNull();
    // El desafío se consumió con el intento fallido: repetirlo no vale.
    expect((await post(app, "/api/auth/login/2fa", { challenge, code: totpCode(secret) })).statusCode).toBe(400);

    const { challenge: segundo } = await desafio();
    const bueno = await post(app, "/api/auth/login/2fa", { challenge: segundo, code: totpCode(secret) });
    expect(bueno.statusCode).toBe(200);
    const cookie = sessionCookie(bueno);
    expect(cookie).not.toBeNull();
    expect((await get(app, "/api/auth/session", cookie)).statusCode).toBe(200);
  });

  it("un código de recuperación sirve una vez", async () => {
    const { recoveryCodes } = await conSegundoFactor();
    const { challenge } = await desafio();
    const conCodigo = await post(app, "/api/auth/login/2fa", { challenge, code: recoveryCodes[0] });
    expect(conCodigo.statusCode).toBe(200);
    expect(sessionCookie(conCodigo)).not.toBeNull();

    const repetido = await desafio();
    expect((await post(app, "/api/auth/login/2fa", { challenge: repetido.challenge, code: recoveryCodes[0] })).statusCode).toBe(401);

    const otro = await desafio();
    expect((await post(app, "/api/auth/login/2fa", { challenge: otro.challenge, code: recoveryCodes[1] })).statusCode).toBe(200);
  });

  it("desactivar exige contraseña y código vigente", async () => {
    const { cookie, secret } = await conSegundoFactor();
    expect((await post(app, "/api/auth/2fa/disable", { password: "mala-clave-1234", code: totpCode(secret) }, cookie)).statusCode).toBe(401);
    expect((await post(app, "/api/auth/2fa/disable", { password: PASSWORD, code: "000000" }, cookie)).statusCode).toBe(400);
    const apagar = await post(app, "/api/auth/2fa/disable", { password: PASSWORD, code: totpCode(secret) }, cookie);
    expect(apagar.statusCode).toBe(204);

    const acceso = await post(app, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(acceso.statusCode).toBe(200);
    expect(sessionCookie(acceso)).not.toBeNull();
  });

  it("un desafío inventado no abre nada", async () => {
    await conSegundoFactor();
    const res = await post(app, "/api/auth/login/2fa", { challenge: "inventado", code: "123456" });
    expect(res.statusCode).toBe(400);
  });
});
