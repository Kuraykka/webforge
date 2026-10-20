import { describe, expect, it } from "vitest";
import { migrate, openDatabase, type Sql } from "../db.ts";
import { ValidationError } from "../errors.ts";
import { SEO_DEFAULTS } from "../../shared/seo.ts";
import { insertProject, projectHistory } from "./projects.ts";
import { insertUser } from "./users.ts";
import { readSeo, saveSeo } from "./seo.ts";

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-02T10:00:00.000Z";
const T2 = "2026-03-03T10:00:00.000Z";

interface Fixture {
  db: Sql;
  owner: string;
  other: string;
  projectId: string;
}

function fixture(): Fixture {
  const db = openDatabase(":memory:");
  migrate(db);
  const owner = insertUser(db, { email: "ana@dominio.dev", passwordHash: "h", role: "user" }).id;
  const other = insertUser(db, { email: "luis@dominio.dev", passwordHash: "h", role: "user" }).id;
  const project = insertProject(db, { ownerUserId: owner, name: "Mi tienda", stack: "static", now: T0 });
  return { db, owner, other, projectId: project.id };
}

function guardar(f: Fixture, patch: Partial<typeof SEO_DEFAULTS> = {}, now = T1) {
  const seo = saveSeo(f.db, f.owner, f.projectId, { ...SEO_DEFAULTS, siteUrl: "https://mitienda.dev", ...patch }, now);
  if (!seo) throw new Error("El guardado no devolvió fila.");
  return seo;
}

describe("readSeo", () => {
  it("un proyecto recién creado estrena ajustes neutros sin escribir nada", () => {
    const f = fixture();
    expect(readSeo(f.db, f.owner, f.projectId)).toEqual({
      projectId: f.projectId,
      ...SEO_DEFAULTS,
      sitemap: false,
      updatedAt: null
    });
    expect(f.db.get<{ total: number }>("select count(*) as total from project_seo")?.total).toBe(0);
  });

  it("el proyecto de otra cuenta no existe para quien pregunta", () => {
    const f = fixture();
    expect(readSeo(f.db, f.other, f.projectId)).toBeNull();
  });
});

describe("saveSeo", () => {
  it("guarda lo que se le da y sella la fecha", () => {
    const f = fixture();
    const seo = guardar(f, { description: "Tienda de bicicletas de barrio", language: "es-ES" }, T1);
    expect(seo).toMatchObject({
      projectId: f.projectId,
      siteUrl: "https://mitienda.dev",
      description: "Tienda de bicicletas de barrio",
      language: "es-ES",
      updatedAt: T1
    });
    expect(readSeo(f.db, f.owner, f.projectId)).toEqual(seo);
  });

  it("normaliza el dominio y el idioma", () => {
    const f = fixture();
    const seo = guardar(f, { siteUrl: " https://mi-tienda.dev/ ", language: "ES-es" });
    expect(seo.siteUrl).toBe("https://mi-tienda.dev");
    expect(seo.language).toBe("es-ES");
  });

  it("guardar dos veces actualiza la misma fila y deja historial", () => {
    const f = fixture();
    guardar(f, { description: "Primera" }, T1);
    const seo = guardar(f, { description: "Segunda", noindex: true }, T2);
    expect(seo.description).toBe("Segunda");
    expect(seo.noindex).toBe(true);
    expect(f.db.get<{ total: number }>("select count(*) as total from project_seo")?.total).toBe(1);
    const acciones = projectHistory(f.db, f.owner, f.projectId).map((h) => h.action);
    expect(acciones.filter((a) => /SEO/i.test(a))).toHaveLength(2);
  });

  it("un dominio inválido se rechaza antes de escribir", () => {
    const f = fixture();
    expect(() => guardar(f, { siteUrl: "http://mitienda.dev" })).toThrow(ValidationError);
    expect(f.db.get<{ total: number }>("select count(*) as total from project_seo")?.total).toBe(0);
  });

  it("una descripción larga se rechaza con el límite en el mensaje", () => {
    const f = fixture();
    expect(() => guardar(f, { description: "x".repeat(161) })).toThrow(/160/);
  });

  it("el proyecto ajeno no se puede escribir", () => {
    const f = fixture();
    expect(saveSeo(f.db, f.other, f.projectId, SEO_DEFAULTS, T1)).toBeNull();
    expect(f.db.get<{ total: number }>("select count(*) as total from project_seo")?.total).toBe(0);
  });

  it("borrar el proyecto se lleva sus ajustes", () => {
    const f = fixture();
    guardar(f);
    f.db.run("delete from projects where id = ?", f.projectId);
    expect(f.db.get<{ total: number }>("select count(*) as total from project_seo")?.total).toBe(0);
  });
});
