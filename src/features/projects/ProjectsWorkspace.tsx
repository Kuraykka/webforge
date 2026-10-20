import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FolderSearch, Upload } from "lucide-react";
import { useProjects } from "./ProjectsContext";
import { ProjectCard, type ProjectCardHandlers } from "./ProjectCard";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { exportProjectZip, importProjectZip } from "./archive";
import { ConfirmDialog, Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { Input, Label } from "../../components/ui/Field";
import { EmptyState, Spinner } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { useApi } from "../../lib/ApiContext";
import type { Project, ProjectStatus } from "./types";

export function ProjectsWorkspace({
  projects: visibleProjects,
  filtersActive = false
}: {
  projects?: Project[];
  filtersActive?: boolean;
}) {
  const { projects, loading, error, create, rename, setStatus, updateDetails, duplicate, remove, reload } =
    useProjects();
  const { notify } = useToast();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [importando, setImportando] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const list = visibleProjects ?? projects;

  /** `?nuevo=1` viene de la barra superior: abre el formulario y se quita de la URL. */
  useEffect(() => {
    if (params.get("nuevo") !== "1") return;
    setEditing(null);
    setFormOpen(true);
    const restantes = new URLSearchParams(params);
    restantes.delete("nuevo");
    setParams(restantes, { replace: true });
  }, [params, setParams]);

  const folderSuggestions = useMemo(
    () => [...new Set(projects.map((p) => p.folder).filter((f) => f && f !== "Sin carpeta"))],
    [projects]
  );

  const fail = (e: unknown) => {
    notify("error", e instanceof Error ? e.message : "La operación no se completó.");
  };

  const handlers: ProjectCardHandlers = {
    onOpen: (p) => navigate(`/projects/${p.id}`),
    onRename: (p) => {
      setRenaming(p);
      setRenameValue(p.name);
    },
    onEdit: (p) => {
      setEditing(p);
      setFormOpen(true);
    },
    onDuplicate: (p) => {
      duplicate(p.id)
        .then((copy) => notify("success", `Proyecto duplicado como "${copy.name}".`))
        .catch(fail);
    },
    onDelete: (p) => setDeleting(p),
    onExport: (p) => {
      exportProjectZip(api, p)
        .then((nombre) => notify("success", `ZIP descargado: ${nombre}.`))
        .catch(fail);
    },
    onStatus: (p, status: ProjectStatus) => {
      setStatus(p.id, status)
        .then(() => notify("success", "Estado actualizado."))
        .catch(fail);
    }
  };

  const submitForm = async (input: Parameters<typeof create>[0]) => {
    try {
      if (editing) {
        await updateDetails(editing.id, {
          description: input.description,
          folder: input.folder,
          tags: input.tags,
          stack: input.stack
        });
        if (input.name !== editing.name) await rename(editing.id, input.name);
        notify("success", "Proyecto actualizado.");
      } else {
        const project = await create(input);
        notify("success", `Proyecto "${project.name}" creado.`);
        navigate(`/projects/${project.id}`);
      }
    } catch (e) {
      fail(e);
      throw e;
    }
  };

  const confirmRename = async () => {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      notify("error", "El nombre no puede quedar vacío.");
      return;
    }
    try {
      await rename(renaming.id, trimmed);
      notify("success", "Proyecto renombrado.");
      setRenaming(null);
    } catch (e) {
      fail(e);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id);
      notify("success", `Proyecto "${deleting.name}" eliminado.`);
    } catch (e) {
      fail(e);
    } finally {
      setDeleting(null);
    }
  };

  /** La lista solo se refresca cuando el servidor confirma la importación. */
  const subirZip = async (archivo: File) => {
    setImportando(true);
    try {
      const project = await importProjectZip(api, archivo);
      await reload();
      notify("success", `Proyecto «${project.name}» importado desde el ZIP.`);
    } catch (e) {
      fail(e);
    } finally {
      setImportando(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-ink-muted">
        <Spinner /> Cargando proyectos…
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<FolderSearch className="h-8 w-8" aria-hidden />}
        title="No se pudieron cargar los proyectos"
        description={error}
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {list.length} {list.length === 1 ? "proyecto" : "proyectos"}
          {visibleProjects && projects.length !== visibleProjects.length
            ? ` de ${projects.length}`
            : ""}
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            aria-label="Archivo ZIP"
            className="sr-only"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              e.target.value = "";
              if (archivo) void subirZip(archivo);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={importando}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {importando ? "Importando…" : "Importar ZIP"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Nuevo proyecto
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<FolderSearch className="h-8 w-8" aria-hidden />}
          title={filtersActive ? "No hay proyectos que mostrar" : "Todavía no hay proyectos"}
          description={
            filtersActive
              ? "Ningún proyecto coincide con los filtros aplicados."
              : "Crea tu primer proyecto para empezar a trabajar desde el dashboard."
          }
          action={
            filtersActive ? null : (
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Crear proyecto
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Proyectos">
          {list.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} handlers={handlers} />
            </li>
          ))}
        </ul>
      )}

      <ProjectFormDialog
        open={formOpen}
        project={editing}
        folderSuggestions={folderSuggestions}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={submitForm}
      />

      <Modal
        open={Boolean(renaming)}
        title="Renombrar proyecto"
        onClose={() => setRenaming(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirmRename();
          }}
        >
          <Label htmlFor="rename-field">Nuevo nombre</Label>
          <Input
            id="rename-field"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={120}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit">
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Eliminar proyecto"
        message={`Se eliminará "${deleting?.name ?? ""}" junto con su historial. Esta acción no se puede deshacer.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
