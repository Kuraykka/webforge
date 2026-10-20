import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpCode, verifyTotp } from "./totp.ts";

/** Vector de la RFC 6238: secreto ASCII «12345678901234567890». */
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("base32 va y vuelve", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(SECRET).toString("ascii")).toBe("12345678901234567890");
  });

  it("reproduce los vectores de la RFC 6238 (6 dígitos)", () => {
    expect(totpCode(SECRET, 59_000)).toBe("287082");
    expect(totpCode(SECRET, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(SECRET, 1_111_111_111_000)).toBe("050471");
    expect(totpCode(SECRET, 2_000_000_000_000)).toBe("279037");
  });

  it("acepta el paso actual y los dos vecinos, y nada más", () => {
    const ahora = 1_111_111_109_000;
    expect(verifyTotp(SECRET, "081804", ahora)).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, ahora + 30_000), ahora)).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, ahora - 30_000), ahora)).toBe(true);
    expect(verifyTotp(SECRET, totpCode(SECRET, ahora + 90_000), ahora)).toBe(false);
    expect(verifyTotp(SECRET, "000000", ahora)).toBe(false);
    expect(verifyTotp(SECRET, "08180", ahora)).toBe(false);
    expect(verifyTotp(SECRET, "abcdef", ahora)).toBe(false);
  });

  it("los espacios del código no cuentan", () => {
    expect(verifyTotp(SECRET, "081 804", 1_111_111_109_000)).toBe(true);
  });

  it("el secreto nuevo es base32 y la URI lleva lo que espera la aplicación", () => {
    const nuevo = generateTotpSecret();
    expect(nuevo).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri(nuevo, "ana@dominio.dev");
    expect(uri.startsWith("otpauth://totp/WebForge:ana%40dominio.dev?")).toBe(true);
    expect(uri).toContain(`secret=${nuevo}`);
    expect(uri).toContain("issuer=WebForge");
    expect(uri).toContain("digits=6");
  });
});
