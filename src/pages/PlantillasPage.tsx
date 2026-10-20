import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "./PageHeader";
import { Badge, Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Field";
import { useProjects } from "../features/projects/ProjectsContext";
import { PLANTILLAS, type Plantilla } from "../../shared/plantillas";

/**
 * Catálogo (§15). Elegir una familia no enseña una maqueta: escribe los archivos de la plantilla en el
 * proyecto que acaba de nacer, así que lo que se ve en el editor es exactamente lo que se descarga.
 */
export function PlantillasPage() {
  const { create } = useProjects();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState("");
  const [elegida, setElegida] = useState<Plantilla | null>(null);
  const [nombre, setNombre] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const visibles = useMemo(() => {
    const texto = filtro.trim().toLowerCase();
    if (!texto) return PLANTILLAS;
    return PLANTILLAS.filter((p) => `${p.nombre} ${p.descripcion} ${p.incluye.join(" ")}`.toLowerCase().includes(texto));
  }, [filtro]);

  function elegir(plantilla: Plantilla) {
    setElegida(plantilla);
    setNombre("");
    setAviso(null);
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!elegida) return;
    const limpio = nombre.trim();
    if (!limpio) {
      setAviso("Escribe un nombre para el proyecto.");
      return;
    }
    if (limpio.length > 80) {
      setAviso("El nombre no puede superar 80 caracteres.");
      return;
    }
    setOcupado(true);
    setAviso(null);
    try {
      const project = await create({
        name: limpio,
        description: elegida.descripcion,
        folder: "Plantillas",
        tags: [elegida.id],
        stack: "static",
        files: elegida.archivos(limpio)
      });
      navigate(`/projects/${project.id}/editor`);
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "El servidor no ha creado el proyecto.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Plantillas"
        description="Diez familias con la base SEO ya escrita: elige una, ponle nombre y nace un proyecto con sus archivos."
      />

      <div className="mb-4 max-w-sm">
        <Label htmlFor="plantilla-filtro">Filtrar plantillas</Label>
        <Input
          id="plantilla-filtro"
          type="search"
          aria-label="Filtrar plantillas"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Nombre, uso o lo que trae…"
        />
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-ink-muted">Ninguna familia encaja con «{filtro}».</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((plantilla) => (
            <li key={plantilla.id}>
              <article className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface-raised p-4">
                <h3 className="text-base font-semibold text-ink">{plantilla.nombre}</h3>
                <p className="text-sm text-ink-muted">{plantilla.descripcion}</p>
                <ul className="flex flex-wrap gap-1.5" aria-label={`Qué trae ${plantilla.nombre}`}>
                  {plantilla.incluye.map((chip) => (
                    <li key={chip}>
                      <Badge>{chip}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ink-faint">
                  {plantilla.paginas.length} páginas · HTML, CSS y JS sin servidor
                </p>
                <Button className="mt-auto self-start" variant="primary" size="sm" onClick={() => elegir(plantilla)}>
                  Usar la plantilla {plantilla.nombre}
                </Button>
              </article>
            </li>
          ))}
        </ul>
      )}

      {elegida ? (
        <Card className="mt-5 border-accent/40">
          <section aria-label="Crear proyecto desde la plantilla" className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-ink">Plantilla elegida: {elegida.nombre}</h2>
            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={enviar}>
              <div>
                <Label htmlFor="plantilla-nombre">Nombre del proyecto *</Label>
                <Input
                  id="plantilla-nombre"
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value);
                    setAviso(null);
                  }}
                  placeholder="Panadería Norte"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={ocupado}>
                  {ocupado ? "Creando…" : "Crear proyecto"}
                </Button>
                <Button
                  onClick={() => {
                    setElegida(null);
                    setAviso(null);
                  }}
                >
                  Elegir otra
                </Button>
              </div>
            </form>
            {aviso ? (
              <p role="alert" className="text-sm text-danger">
                {aviso}
              </p>
            ) : null}
            <p className="text-xs text-ink-faint">
              El proyecto nace en la carpeta «Plantillas» con la etiqueta {elegida.id} y sus archivos ya escritos:
              las páginas de negocio, el sitemap, el robots y la ficha <code>.webforge.json</code>.
            </p>
          </section>
        </Card>
      ) : null}

      <p className="mt-5 text-xs text-ink-faint">
        Lo que queda por cambiar antes de publicar: sustituye TU-DOMINIO.example por tu dominio en robots.txt,
        en el sitemap y en las URLs canónicas, y reemplaza los textos marcados con la clase por-rellenar. Las
        plantillas no inventan precios, testimonios ni nombres de equipo.
      </p>
    </div>
  );
}
