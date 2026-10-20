import type { StackId } from "./types";

const escapeName = (name: string) =>
  name.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

function pageShell(title: string, body: string, headExtra = ""): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeName(title)}</title>
    <meta name="description" content="${escapeName(title)} — página creada con WebForge." />
    <link rel="stylesheet" href="styles.css" />
${headExtra}  </head>
${body}
</html>
`;
}

const BODY = `  <body>
    <header class="site-header">
      <a class="brand" href="#inicio">WebForge</a>
      <nav aria-label="Principal">
        <ul class="nav-list">
          <li><a href="#servicios">Servicios</a></li>
          <li><a href="#contacto">Contacto</a></li>
        </ul>
      </nav>
    </header>

    <main id="inicio">
      <section class="hero">
        <h1>Tu proyecto, listo para crecer</h1>
        <p>Edita esta página desde el editor de código o arrastra componentes con el constructor visual.</p>
        <a class="cta" href="#contacto" id="cta-principal">Solicitar información</a>
      </section>

      <section id="servicios" class="cards">
        <article class="card">
          <h2>Diseño responsive</h2>
          <p>Maquetación adaptable a móvil, tablet y escritorio.</p>
        </article>
        <article class="card">
          <h2>Contenido editable</h2>
          <p>El constructor escribe HTML real en tus archivos.</p>
        </article>
      </section>

      <section id="contacto">
        <h2>Contacto</h2>
        <form id="formulario-contacto">
          <label for="nombre">Nombre</label>
          <input id="nombre" name="nombre" type="text" required />
          <label for="mensaje">Mensaje</label>
          <textarea id="mensaje" name="mensaje" rows="4" required></textarea>
          <button type="submit">Enviar</button>
          <p id="estado-formulario" role="status"></p>
        </form>
      </section>
    </main>

    <footer class="site-footer">
      <p>Datos de contacto: hola@tu-dominio.example · L-V de 9:00 a 18:00</p>
    </footer>
  </body>`;

const CSS = `/*
  Hoja de estilos de la página. Todo el color, el espacio y la tipografía salen de las variables
  de :root: cambia un valor aquí y se actualiza toda la maquetación.
  Las clases de abajo son las que escribe el constructor visual, así que cada bloque del
  constructor ya tiene su estilo al insertarse.
*/

:root {
  /* Paleta. */
  --ink: #0f172a;
  --muted: #475569;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-ink: #ffffff;
  --surface: #ffffff;
  --surface-2: #f8fafc;
  --line: #e2e8f0;

  /* Tipografía. */
  --fuente-cuerpo: system-ui, -apple-system, "Segoe UI", sans-serif;
  --fuente-titulo: inherit;
  --escala-titulo: clamp(1.5rem, 4vw, 2.1rem);

  /* Espaciado, formas y elevación. */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --radio: 0.75rem;
  --sombra: 0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.06);

  /* Ancho de lectura de la página. */
  --ancho: 68ch;
}

/* Tema oscuro: se activa poniendo data-theme="oscuro" en <html>. */
[data-theme="oscuro"] {
  --ink: #e2e8f0;
  --muted: #94a3b8;
  --accent: #60a5fa;
  --accent-hover: #93c5fd;
  --accent-ink: #0f172a;
  --surface: #0b1120;
  --surface-2: #1e293b;
  --line: #334155;
  --sombra: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--fuente-cuerpo);
  color: var(--ink);
  background: var(--surface);
  line-height: 1.55;
}

h1,
h2,
h3 {
  font-family: var(--fuente-titulo);
  line-height: 1.2;
  margin-block: 0 var(--space-2);
}

h1 {
  font-size: clamp(1.8rem, 5vw, 2.6rem);
}

h2 {
  font-size: var(--escala-titulo);
}

a {
  color: var(--accent);
}

.site-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) clamp(var(--space-4), 5vw, 3rem);
  border-bottom: 1px solid var(--line);
}

.brand {
  font-weight: 700;
  text-decoration: none;
  color: var(--ink);
}

.menu {
  display: block;
}

.nav-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-list a {
  color: var(--ink);
  text-decoration: none;
}

.nav-list a:hover {
  color: var(--accent);
}

main {
  padding: clamp(var(--space-6), 6vw, 4rem);
  max-width: var(--ancho);
  margin: 0 auto;
}

.seccion {
  padding-block: clamp(var(--space-6), 6vw, 3rem);
}

.seccion + .seccion {
  border-top: 1px solid var(--line);
}

.hero {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.lead {
  font-size: 1.05rem;
  color: var(--muted);
  margin: 0;
}

.cta,
.boton {
  display: inline-block;
  margin-top: var(--space-2);
  padding: 0.7rem 1.2rem;
  border: 0;
  border-radius: var(--radio);
  background: var(--accent);
  color: var(--accent-ink);
  text-decoration: none;
  font-weight: 600;
}

.cta:hover,
.boton:hover {
  background: var(--accent-hover);
  color: var(--accent-ink);
}

.enlace {
  color: var(--accent);
  text-underline-offset: 2px;
}

.enlace:hover {
  color: var(--accent-hover);
}

.columnas,
.cards,
.rejilla {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-6);
}

/* Móvil: una columna. Tablet: dos. Escritorio: las columnas propias de cada rejilla. */
.cards {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

@media (min-width: 40rem) {
  .columnas {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rejilla-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rejilla-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 64rem) {
  .rejilla-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .rejilla-4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.rejilla-hueco,
.card,
.tarjeta {
  border: 1px solid var(--line);
  border-radius: var(--radio);
  padding: var(--space-4);
  background: var(--surface-2);
}

.card {
  background: var(--surface);
}

.tarjeta {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}

.lista {
  display: grid;
  gap: var(--space-2);
  padding-left: 1.25rem;
  margin: 0;
}

.cita {
  margin: var(--space-4) 0;
  padding-left: var(--space-4);
  border-left: 3px solid var(--accent);
  color: var(--muted);
  font-style: italic;
}

.cita footer {
  font-style: normal;
  font-size: 0.9rem;
  margin-top: var(--space-2);
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-4);
  font-size: 0.95rem;
}

.tabla caption {
  caption-side: bottom;
  text-align: left;
  color: var(--muted);
  font-size: 0.85rem;
  padding-top: var(--space-2);
}

.tabla th,
.tabla td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line);
}

.tabla thead th {
  color: var(--ink);
  font-weight: 600;
  border-bottom-width: 2px;
}

.figura {
  margin: var(--space-4) 0;
}

.figura img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radio);
}

.figura figcaption {
  margin-top: var(--space-2);
  color: var(--muted);
  font-size: 0.9rem;
}

.icono {
  width: 1.5rem;
  height: 1.5rem;
  color: var(--accent);
  flex: none;
  vertical-align: middle;
}

.video {
  width: 100%;
  height: auto;
  border-radius: var(--radio);
  background: #000;
}

.modal-bloque {
  display: inline-block;
}

.modal {
  width: min(100% - 2rem, 34rem);
  padding: var(--space-6);
  border: 1px solid var(--line);
  border-radius: var(--radio);
  color: var(--ink);
  background: var(--surface);
  box-shadow: var(--sombra);
}

.modal::backdrop {
  background: rgba(15, 23, 42, 0.55);
}

.modal h2 {
  margin-block-start: 0;
}

.modal form {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin-top: var(--space-4);
}

.formulario,
form {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}

input,
textarea,
select {
  font: inherit;
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--ink);
}

button {
  justify-self: start;
  padding: 0.6rem 1.2rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--accent-ink);
  font: inherit;
  cursor: pointer;
}

button:hover {
  background: var(--accent-hover);
}

.estado-formulario {
  min-height: 1.2em;
  color: var(--muted);
  font-size: 0.9rem;
}

.separador {
  border: 0;
  border-top: 1px solid var(--line);
  margin-block: var(--space-8);
}

.site-footer {
  border-top: 1px solid var(--line);
  padding: var(--space-6) clamp(var(--space-4), 5vw, 3rem);
  color: var(--muted);
  font-size: 0.9rem;
}
`;

const FORM_SCRIPT = `const form = document.getElementById("formulario-contacto");
const status = document.getElementById("estado-formulario");

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = String(data.get("nombre") ?? "").trim();
  if (!name) {
    status.textContent = "Revisa los campos obligatorios.";
    return;
  }
  // Envío real disponible a partir de la fase de backend; aquí se valida y confirma en cliente.
  status.textContent = "Gracias, " + name + ". Tu mensaje ha quedado registrado en esta sesión.";
  form.reset();
});

document.getElementById("cta-principal")?.addEventListener("click", () => {
  console.info("CTA principal pulsado");
});
`;

export function staticTemplate(projectName: string, stack: StackId): Record<string, string> {
  const title = `${projectName} · Inicio`;
  if (stack === "typescript") {
    return {
      "index.html": pageShell(
        title,
        BODY,
        `    <!-- El navegador no ejecuta .ts: la compilación llega con la fase de backend. -->\n    <script type="module" src="src/main.ts"></script>\n`
      ),
      "styles.css": CSS,
      "src/main.ts": `interface ContactForm extends HTMLFormElement {
  reset(): void;
}

const form = document.querySelector<ContactForm>("#formulario-contacto");
const status = document.getElementById("estado-formulario");

form?.addEventListener("submit", (event: SubmitEvent) => {
  event.preventDefault();
  const name = new FormData(form).get("nombre");
  if (typeof name !== "string" || !name.trim()) return;
  if (status) status.textContent = "Gracias, " + name + ". Mensaje registrado en esta sesión.";
  form.reset();
});
`,
      "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
`
    };
  }

  if (stack === "react") {
    return {
      "index.html": pageShell(
        title,
        `  <body>
    <div id="root"></div>
    <!-- La compilación de JSX se activa con la fase de backend; el HTML de arriba es editable a mano. -->
    <script type="module" src="src/main.tsx"></script>
  </body>`
      ),
      "styles.css": CSS,
      "src/App.tsx": `export function App() {
  return (
    <main>
      <h1>${escapeName(projectName)}</h1>
      <p>Componente inicial. La compilación de JSX llega con la fase de backend.</p>
    </main>
  );
}
`,
      "src/main.tsx": `import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
`
    };
  }

  if (stack === "backend-api") {
    return {
      "README.md": `# ${projectName}

API en fase de diseño. La ejecución del servidor requiere el backend de la plataforma (Fase 6):
aquí solo se editan y versionan los archivos, no se levanta ningún proceso.

## Endpoints previstos

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | /health | Estado del servicio |
| POST | /leads | Recibe un lead desde el formulario |
`,
      "src/server.ts": `import { router } from "./routes";

export const PORT = Number(process.env.PORT ?? 8080);

export function start() {
  // Pendiente: el adaptador de servidor real se implementa en la Fase 6.
  console.log("Servidor ${escapeName(projectName)} configurado en el puerto", PORT);
  return router;
}
`,
      "src/routes.ts": `export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: () => unknown;
}

export const router: Route[] = [
  { method: "GET", path: "/health", handler: () => ({ status: "ok" }) },
  { method: "POST", path: "/leads", handler: () => ({ created: true }) }
];
`
    };
  }

  return {
    "index.html": pageShell(
      title,
      BODY,
      `    <script type="module" src="main.js"></script>\n`
    ),
    "styles.css": CSS,
    "main.js": FORM_SCRIPT
  };
}
