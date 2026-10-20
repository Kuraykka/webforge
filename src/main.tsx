import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { ToastProvider } from "./components/ui/Toast";
import { StoresProvider, createHttpStores } from "./lib/stores";
import { SessionProvider } from "./features/auth/SessionContext";
import { AdminProvider } from "./features/admin/AdminContext";
import { createAdminApi } from "./features/admin/api";
import { createAuthApi } from "./features/auth/api";
import { createApiClient } from "./lib/api";
import { ApiProvider } from "./lib/ApiContext";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("No se encontró el elemento #root.");

// Un único cliente para toda la app: sesiones, proyectos y archivos comparten cookie y cabecera CSRF.
const api = createApiClient();

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <ApiProvider api={api}>
          <StoresProvider stores={createHttpStores(api)}>
            <SessionProvider auth={createAuthApi(api)}>
              <AdminProvider api={createAdminApi(api)}>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </AdminProvider>
            </SessionProvider>
          </StoresProvider>
        </ApiProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>
);
