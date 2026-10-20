import { describe, expect, it } from "vitest";
import { formatBytes, parseTags, relativeTime } from "./format";

describe("formatBytes", () => {
  it("muestra bytes sueltos hasta el primer kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
  });

  it("pasa a kilobytes y megabytes con un decimal", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(120_000)).toBe("117,2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("relativeTime y parseTags", () => {
  it("un instante reciente se lee como «hace unos segundos»", () => {
    expect(relativeTime(new Date(Date.now() - 5_000).toISOString())).toContain("segundo");
  });

  it("una fecha lejana se muestra como fecha", () => {
    expect(relativeTime("2020-01-01T00:00:00.000Z")).not.toBe("—");
  });

  it("separa etiquetas por coma o salto de línea sin repetir", () => {
    expect(parseTags("tienda, blog\ntienda")).toEqual(["tienda", "blog"]);
  });
});
