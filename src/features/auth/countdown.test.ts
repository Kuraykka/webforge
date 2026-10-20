import { describe, expect, it } from "vitest";
import { restoFormateado } from "./countdown";

describe("restoFormateado", () => {
  it("sin horas basta con minutos y segundos", () => {
    expect(restoFormateado(180)).toBe("3:00");
    expect(restoFormateado(75)).toBe("1:15");
    expect(restoFormateado(9)).toBe("0:09");
  });

  it("con horas enseña horas, minutos y segundos", () => {
    expect(restoFormateado(86_400)).toBe("24:00:00");
    expect(restoFormateado(3_661)).toBe("1:01:01");
  });

  it("un plazo ya cumplido se queda en cero", () => {
    expect(restoFormateado(0)).toBe("0:00");
    expect(restoFormateado(-12)).toBe("0:00");
  });
});
