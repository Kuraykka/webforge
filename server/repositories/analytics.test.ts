import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { ANALYTICS_DEFAULTS } from "../../shared/analytics.ts";
import { insertProject } from "./projects.ts";
import { insertUser } from "./users.ts";
import { enabledAnalyticsProjects, readAnalytics, saveAnalytics } from "./analytics.ts";

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";

function fixture(): { db: Sql; owner: string; other: string; projectId: string } {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const project = insertProject(db, { ownerUserId: owner, name: "Mi tienda", stack: "static", now: T0 });
  return { db, owner, other, projectId: project.id };
}

const guardar = (f: ReturnType<typeof fixture>, patch: Partial<typeof ANALYTICS_DEFAULTS> = {}) => {
  const resultado = saveAnalytics(
    f.db,
    f.owner,
    f.projectId,
    { ...ANALYTICS_DEFAULTS, enabled: true, measurementId: "G-ABC123XYZ", ...patch },
    T1
  );
  if (!resultado) throw new Error("El guardado no devolvió fila.");
  return resultado;
};

describe("analytics por proyecto", () => {
  it("sin fila devuelve los valores de partida", () => {
    const f = fixture();
    expect(readAnalytics(f.db, f.owner, f.projectId)).toEqual({
      projectId: f.projectId,
      ...ANALYTICS_DEFAULTS,
      updatedAt: null
    });
  });

  it("guarda en mayúsculas y vuelve a leerse igual", () => {
    const f = fixture();
    const guardado = guardar(f, { measurementId: "g-abc123xyz", thankYouPaths: "/gracias.html" });
    expect(guardado.measurementId).toBe("G-ABC123XYZ");
    expect(guardado.thankYouPaths).toBe("/gracias.html");
    expect(readAnalytics(f.db, f.owner, f.projectId)).toEqual(guardado);
    expect(enabledAnalyticsProjects(f.db)).toBe(1);
  });

  it("rechaza un identificador que no es de GA4", () => {
    const f = fixture();
    expect(() => guardar(f, { measurementId: "UA-123" })).toThrow(ValidationError);
    expect(f.db.get("select project_id from project_analytics")).toBeUndefined();
  });

  it("activarla sin identificador no se acepta", () => {
    const f = fixture();
    expect(() => guardar(f, { measurementId: "" })).toThrow(/identificador/i);
  });

  it("el proyecto ajeno no existe", () => {
    const f = fixture();
    expect(readAnalytics(f.db, f.other, f.projectId)).toBeNull();
    expect(saveAnalytics(f.db, f.other, f.projectId, ANALYTICS_DEFAULTS, T1)).toBeNull();
  });

  it("borrar el proyecto se lleva su configuración", () => {
    const f = fixture();
    guardar(f);
    f.db.run("delete from projects where id = ?", f.projectId);
    expect(f.db.get("select project_id from project_analytics")).toBeUndefined();
    expect(enabledAnalyticsProjects(f.db)).toBe(0);
  });
});
