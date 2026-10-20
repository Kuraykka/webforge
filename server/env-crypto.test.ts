import { describe, expect, it } from "vitest";
import { decryptEnvValue, encryptEnvValue, envKeyFrom, isEncrypted } from "./env-crypto.ts";

const KEY = envKeyFrom("clave-de-prueba-012345678901234567890123456789");
const OTRA = envKeyFrom("otra-clave-de-prueba-0123456789012345678");

describe("cifrado de variables de entorno", () => {
  it("cifra y descifra sin perder el valor ni dejarlo legible", () => {
    const cifrado = encryptEnvValue("sk-privada-123", KEY);
    expect(isEncrypted(cifrado)).toBe(true);
    expect(cifrado).not.toContain("sk-privada-123");
    expect(decryptEnvValue(cifrado, KEY)).toBe("sk-privada-123");
  });

  it("el mismo valor dos veces da cifrados distintos", () => {
    expect(encryptEnvValue("mismo", KEY)).not.toBe(encryptEnvValue("mismo", KEY));
  });

  it("otra clave no puede abrirlo", () => {
    const cifrado = encryptEnvValue("secreto", KEY);
    expect(() => decryptEnvValue(cifrado, OTRA)).toThrow();
  });

  it("un texto manipulado no se acepta", () => {
    const cifrado = encryptEnvValue("secreto", KEY);
    const partes = cifrado.split(":");
    const datos = partes[partes.length - 1] ?? "";
    partes[partes.length - 1] = `AAAA${datos.slice(4)}`;
    expect(() => decryptEnvValue(partes.join(":"), KEY)).toThrow();
  });

  it("los valores anteriores en claro se siguen leyendo", () => {
    expect(decryptEnvValue("valor-antiguo-en-claro", KEY)).toBe("valor-antiguo-en-claro");
    expect(isEncrypted("valor-antiguo-en-claro")).toBe(false);
  });

  it("el valor vacío también se cifra", () => {
    const cifrado = encryptEnvValue("", KEY);
    expect(isEncrypted(cifrado)).toBe(true);
    expect(decryptEnvValue(cifrado, KEY)).toBe("");
  });
});
