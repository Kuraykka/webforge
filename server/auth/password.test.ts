import { hash } from "@node-rs/argon2";
import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  hashPassword,
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
  needsRehash,
  PASSWORD_POLICY,
  verifyPassword
} from "./password.ts";

describe("hashPassword / verifyPassword", () => {
  it("verifica la contraseña correcta y rechaza una parecida", async () => {
    const stored = await hashPassword("contrasena-de-prueba-1");
    expect(await verifyPassword(stored, "contrasena-de-prueba-1")).toBe(true);
    expect(await verifyPassword(stored, "contrasena-de-prueba-2")).toBe(false);
  });

  it("guarda argon2id con los parámetros de la política", async () => {
    const stored = await hashPassword("contrasena-de-prueba-1");
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(stored).toContain(`m=${PASSWORD_POLICY.memoryCost},t=${PASSWORD_POLICY.timeCost},p=${PASSWORD_POLICY.parallelism}`);
  });

  it("un hash corrupto se lee como credencial inválida, no como fallo del servidor", async () => {
    expect(await verifyPassword("no-es-un-hash", "cualquiera")).toBe(false);
    expect(await verifyPassword("$argon2id$v=19$m=1,t=1,p=1$$$", "cualquiera")).toBe(false);
  });

  it("dos hashes de la misma contraseña difieren (sal aleatoria)", async () => {
    const a = await hashPassword("contrasena-de-prueba-1");
    const b = await hashPassword("contrasena-de-prueba-1");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "contrasena-de-prueba-1")).toBe(true);
    expect(await verifyPassword(b, "contrasena-de-prueba-1")).toBe(true);
  });
});

describe("needsRehash", () => {
  it("no pide rehacer el hash recién creado", async () => {
    expect(needsRehash(await hashPassword("contrasena-de-prueba-1"))).toBe(false);
  });

  it("pide rehacer cuando los parámetros se quedan atrás", async () => {
    const flojo = await hash("contrasena-de-prueba-1", { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    expect(needsRehash(flojo)).toBe(true);
  });

  it("pide rehacer otros algoritmos y basura", () => {
    expect(needsRehash("$argon2i$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(needsRehash("$2b$12$abcdefghij")).toBe(true);
    expect(needsRehash("")).toBe(true);
  });
});

describe("checkPasswordPolicy", () => {
  const email = "ana@dominio.dev";

  it("acepta una contraseña larga y distinta del correo", () => {
    expect(checkPasswordPolicy("contrasena-de-prueba-1", email)).toBe(null);
  });

  it(`exige al menos ${MIN_PASSWORD_CHARS} caracteres`, () => {
    expect(checkPasswordPolicy("abcdefghijkl", email)).toBe(null);
    expect(checkPasswordPolicy("abcdefghijk", email)).toMatch(/12 caracteres/);
    expect(checkPasswordPolicy("", email)).toMatch(/12 caracteres/);
  });

  it(`pone un techo de ${MAX_PASSWORD_CHARS} caracteres`, () => {
    expect(checkPasswordPolicy("a".repeat(MAX_PASSWORD_CHARS + 1), email)).toMatch(/no puede superar/);
  });

  it("rechaza coincidir con el correo", () => {
    expect(checkPasswordPolicy(email, email)).toMatch(/no puede coincidir/);
  });

  it("rechaza un solo carácter repetido", () => {
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaaa", email)).toMatch(/un solo carácter/);
  });
});
