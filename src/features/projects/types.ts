export type ProjectStatus = "borrador" | "en_desarrollo" | "listo";

export type StackId = "static" | "typescript" | "react" | "backend-api";

export interface Project {
  id: string;
  name: string;
  description: string;
  folder: string;
  tags: string[];
  stack: StackId;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHistoryEntry {
  id: string;
  projectId: string;
  action: string;
  at: string;
}

export interface NewProjectInput {
  name: string;
  description: string;
  folder: string;
  tags: string[];
  stack: StackId;
  /** Archivos iniciales: los que escribe una plantilla del catálogo. Sin esto, la base de la pila. */
  files?: Record<string, string>;
}

export const PROJECT_STATUSES: ProjectStatus[] = ["borrador", "en_desarrollo", "listo"];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  borrador: "Borrador",
  en_desarrollo: "En desarrollo",
  listo: "Listo"
};

export interface StackOption {
  id: StackId;
  label: string;
  description: string;
  files: string[];
}

export const STACK_OPTIONS: StackOption[] = [
  {
    id: "static",
    label: "HTML, CSS y JS",
    description: "Sitio estático con HTML5 semántico, CSS moderno y JavaScript.",
    files: ["index.html", "styles.css", "main.js"]
  },
  {
    id: "typescript",
    label: "TypeScript",
    description: "Proyecto con TypeScript desde el inicio.",
    files: ["index.html", "src/main.ts", "tsconfig.json"]
  },
  {
    id: "react",
    label: "React",
    description: "Aplicación React con componentes y rutas.",
    files: ["index.html", "src/App.tsx", "src/main.tsx"]
  },
  {
    id: "backend-api",
    label: "Backend / API",
    description: "API con endpoints REST; el servidor real llega en la fase de backend.",
    files: ["src/server.ts", "src/routes.ts"]
  }
];

export function stackById(id: StackId): StackOption {
  const option = STACK_OPTIONS.find((s) => s.id === id);
  if (!option) return STACK_OPTIONS[0]!;
  return option;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}