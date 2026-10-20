import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameFromEmail, validateUsername } from "./username";

describe("validateUsername", () => {
  it("acepta letras, números, punto, guion y guion bajo", () => {
    expect(validateUsername("ana")).toBeNull();
    expect(validateUsername("Ana.Perez")).toBeNull();
    expect(validateUsername("ana_2")).toBeNull();
    expect(validateUsername("a-b-c")).toBeNull();
  });

  it("rechaza longitudes absurdas y formas raras", () => {
    expect(validateUsername("ab")).toMatch(/3 y 30/);
    expect(validateUsername("a".repeat(31))).toMatch(/3 y 30/);
    expect(validateUsername("-ana")).toMatch(/letras/i);
    expect(validateUsername("ana-")).toMatch(/letras/i);
    expect(validateUsername("ana perez")).toMatch(/letras/i);
    expect(validateUsername("ana@perez")).toMatch(/letras/i);
  });

  it("reserva los nombres del sistema", () => {
    expect(validateUsername("admin")).toMatch(/reservado/i);
    expect(validateUsername("Root")).toMatch(/reservado/i);
    expect(validateUsername("webforge")).toMatch(/reservado/i);
  });

  it("normaliza a minúsculas", () => {
    expect(normalizeUsername("  Ana.Perez ")).toBe("ana.perez");
  });
});

describe("usernameFromEmail", () => {
  it("usa la parte local cuando sirve", () => {
    expect(usernameFromEmail("ana.perez@dominio.dev")).toBe("ana.perez");
    expect(usernameFromEmail("ANA@dominio.dev")).toBe("ana");
  });

  it("arregla los correos cuyo prefijo no vale como usuario", () => {
    expect(usernameFromEmail("admin@dominio.dev")).toBe("admin-user");
    expect(usernameFromEmail("ab@dominio.dev")).toBe("ab-user");
    expect(usernameFromEmail("++@dominio.dev")).toBe("usuario");
  });
});
