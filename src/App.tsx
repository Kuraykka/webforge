import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectPreviewPage } from "./pages/ProjectPreviewPage";
import { ProjectSeoPage } from "./pages/ProjectSeoPage";
import { ProjectAnalyticsPage } from "./pages/ProjectAnalyticsPage";
import { BuildsPage } from "./pages/BuildsPage";
import { DocsPage } from "./pages/DocsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RequireAuth } from "./features/auth/RequireAuth";
import { LoginPage } from "./features/auth/LoginPage";
import { RegisterPage } from "./features/auth/RegisterPage";
import { ForgotPasswordPage } from "./features/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./features/auth/ResetPasswordPage";
import { VerifyEmailPage } from "./features/auth/VerifyEmailPage";
import { AdminPage } from "./features/admin/AdminPage";
import { ProjectsProvider } from "./features/projects/ProjectsContext";

/* El editor se lleva CodeMirror y el constructor: pesa mucho más que el resto y no hace falta para
   entrar al panel. El `Suspense` que lo cubre mientras llega está en AppShell. */
const EditorWorkspace = lazy(() =>
  import("./features/editor/EditorWorkspace").then((m) => ({ default: m.EditorWorkspace }))
);

/* Las plantillas viajan con el catálogo entero escrito: son decenas de páginas de HTML y CSS que
   solo hacen falta en esta pantalla. */
const PlantillasPage = lazy(() => import("./pages/PlantillasPage").then((m) => ({ default: m.PlantillasPage })));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/recuperar" element={<ForgotPasswordPage />} />
      <Route path="/restablecer-contrasena" element={<ResetPasswordPage />} />
      <Route path="/verificar-correo" element={<VerifyEmailPage />} />

      {/* Los proyectos son datos del usuario: el espacio de trabajo solo se monta con sesión confirmada. */}
      <Route
        element={
          <RequireAuth>
            <ProjectsProvider>
              <AppShell />
            </ProjectsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="projects/:id/editor" element={<EditorWorkspace />} />
        <Route path="projects/:id/preview" element={<ProjectPreviewPage />} />
        <Route path="projects/:id/seo" element={<ProjectSeoPage />} />
        <Route path="projects/:id/analitica" element={<ProjectAnalyticsPage />} />
        <Route path="templates" element={<PlantillasPage />} />
        <Route path="builds" element={<BuildsPage />} />
        <Route path="documentacion" element={<DocsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* El guardado real está en /api/admin: esta ruta solo pinta lo que el servidor deja ver. */}
        <Route path="admin" element={<AdminPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
