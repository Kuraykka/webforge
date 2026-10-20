import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useStores } from "../../lib/stores";
import type { ProjectStore } from "./storage";
import type { NewProjectInput, Project, ProjectHistoryEntry, ProjectStatus } from "./types";
import { STATUS_LABELS } from "./types";

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: NewProjectInput) => Promise<Project>;
  rename: (id: string, name: string) => Promise<Project>;
  setStatus: (id: string, status: ProjectStatus) => Promise<Project>;
  updateDetails: (
    id: string,
    patch: Pick<Project, "description" | "folder" | "tags" | "stack">
  ) => Promise<Project>;
  duplicate: (id: string) => Promise<Project>;
  remove: (id: string) => Promise<void>;
  loadHistory: (projectId: string) => Promise<ProjectHistoryEntry[]>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

/** `store` existe para las pruebas; la app real inyecta el store HTTP por contexto. */
export function ProjectsProvider({
  children,
  store
}: {
  children: ReactNode;
  store?: ProjectStore;
}) {
  const stores = useStores();
  const projectStore = store ?? stores.projects;
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Solo la primera lista de cada store deja la página en blanco. Revalidar con datos
  // en pantalla no debe desmontar lo que el usuario tiene delante: el resumen de la
  // importación vive en el panel y se perdería si el spinner de página volviera.
  const listaDe = useRef<ProjectStore | null>(null);

  const reload = useCallback(async () => {
    if (listaDe.current !== projectStore) setLoading(true);
    setError(null);
    try {
      setProjects(await projectStore.list());
      listaDe.current = projectStore;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos.");
    } finally {
      setLoading(false);
    }
  }, [projectStore]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback((project: Project) => {
    setProjects((current) => {
      const index = current.findIndex((p) => p.id === project.id);
      if (index === -1) return [project, ...current];
      const next = [...current];
      next[index] = project;
      return next;
    });
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      loading,
      error,
      reload,
      create: async (input) => {
        const project = await projectStore.create(input);
        upsert(project);
        return project;
      },
      rename: async (id, name) => {
        const project = await projectStore.rename(id, name);
        upsert(project);
        return project;
      },
      setStatus: async (id, status) => {
        const project = await projectStore.update(id, { status }, `Estado: ${STATUS_LABELS[status]}`);
        upsert(project);
        return project;
      },
      updateDetails: async (id, patch) => {
        const project = await projectStore.update(id, patch, "Detalles del proyecto actualizados");
        upsert(project);
        return project;
      },
      duplicate: async (id) => {
        const project = await projectStore.duplicate(id);
        upsert(project);
        return project;
      },
      remove: async (id) => {
        await projectStore.remove(id);
        // Con el store HTTP esto no borra nada: el servidor tira los archivos en cascada.
        await stores.files.removeProject(id);
        setProjects((current) => current.filter((p) => p.id !== id));
      },
      loadHistory: (projectId) => projectStore.history(projectId)
    }),
    [projectStore, stores.files, projects, loading, error, reload, upsert]
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects debe usarse dentro de ProjectsProvider");
  return ctx;
}
