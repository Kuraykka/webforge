/* Catálogo de plantillas (§15). Cada familia trae la base SEO de §9 (idioma, canónica, tarjetas para
   compartir, sitemap y robots), las páginas de negocio de §10 (contacto, agradecimiento, privacidad y
   aviso legal) y, en la de negocio local, los datos estructurados de §12.
   Viaja en `shared/` porque lo leen la pantalla de plantillas y el servidor al escribir los archivos.
   Los textos entre corchetes son pistas: ninguna plantilla inventa testimonios, precios ni identidades. */

export interface Img {
  archivo: string;
  alt: string;
  ancho: number;
  alto: number;
}

export type Seccion =
  | { tipo: "hero"; titulo: string; texto: string; cta: string; ctaHref: string; imagen?: Img }
  | { tipo: "tarjetas"; titulo: string; intro?: string; rejilla?: 2 | 3 | 4; elementos: { titulo: string; texto: string }[] }
  | { tipo: "pasos"; titulo: string; elementos: { titulo: string; texto: string }[] }
  | { tipo: "faq"; titulo: string; preguntas: { p: string; a: string }[] }
  | { tipo: "galeria"; titulo: string; imagenes: Img[] }
  | { tipo: "tabla"; titulo: string; cabecera: string[]; filas: string[][]; nota?: string }
  | { tipo: "texto"; titulo: string; parrafos: string[] }
  | { tipo: "lista"; titulo: string; items: string[] }
  | { tipo: "formulario"; titulo: string; texto: string; campos: "contacto" | "sencillo" }
  | { tipo: "aviso"; titulo: string; texto: string }
  | { tipo: "datos"; titulo: string; filas: { label: string; valor: string; href?: string }[] }
  | { tipo: "testimonios"; titulo: string };

export interface PaginaDef {
  ruta: string;
  etiqueta: string;
  descripcion: string;
  secciones: Seccion[];
  /** Sin esto la página no aparece en el menú principal (el pie sí la enlaza). */
  ocultaEnMenu?: true;
  /** Datos estructurados de la página; se serializan dentro de un `<script type="application/ld+json">`. */
  ld?: Record<string, unknown>;
}

export interface Plantilla {
  id: string;
  nombre: string;
  descripcion: string;
  /** Qué trae la familia, en chips para la interfaz. */
  incluye: string[];
  /** Rutas HTML que genera; cada una existe de verdad en `archivos()`. */
  paginas: string[];
  archivos(nombre: string): Record<string, string>;
}

interface Modelo {
  id: string;
  nombre: string;
  descripcion: string;
  incluye: string[];
  /** Enlace del CTA fijo de móvil y de la llamada a la acción del hero. */
  cta: { texto: string; href: string };
  portada: Img;
  paginas: PaginaDef[];
}

const DOMINIO = "TU-DOMINIO.example";

const esc = (texto: string) =>
  texto.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

const hoy = () => new Date().toISOString().slice(0, 10);

/** Pista visible de que ese texto es del usuario, no de la plantilla. */
const pr = (texto: string) => `<span class="por-rellenar">${esc(texto)}</span>`;

const portadaDe = (archivo: string, alt: string, ancho = 1200, alto = 675): Img => ({ archivo, alt, ancho, alto });

interface Contexto {
  img: (o: Img) => string;
}

/** Tokens que se rescriben al generar: ni las plantillas ni los datos estructurados llevan dominio real. */
interface Datos {
  proyecto: string;
  fecha: string;
}

function sustituir(valor: string, datos: Datos): string;
function sustituir(valor: unknown, datos: Datos): unknown;
function sustituir(valor: unknown, datos: Datos): unknown {
  if (typeof valor === "string") return valor.replace(/\{proyecto\}/g, datos.proyecto).replace(/\{fecha\}/g, datos.fecha);
  if (Array.isArray(valor)) return valor.map((item) => sustituir(item, datos));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, v]) => [k, sustituir(v, datos)]));
  }
  return valor;
}

function seccionHtml(s: Seccion, ctx: Contexto): string {
  switch (s.tipo) {
    case "hero": {
      const fig = s.imagen ? `\n      <div class="figura">${ctx.img(s.imagen)}</div>` : "";
      return `      <section class="seccion hero" id="inicio">
        <h1>${esc(s.titulo)}</h1>
        <p class="lead">${s.texto}</p>
        <a class="cta" href="${s.ctaHref}">${esc(s.cta)}</a>${fig}
      </section>`;
    }
    case "tarjetas": {
      const intro = s.intro ? `\n        <p class="lead">${s.intro}</p>` : "";
      const cajas = s.elementos
        .map((e) => `        <article class="card"><h3>${esc(e.titulo)}</h3><p>${esc(e.texto)}</p></article>`)
        .join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>${intro}
        <div class="rejilla rejilla-${s.rejilla ?? 3}">
${cajas}
        </div>
      </section>`;
    }
    case "pasos": {
      const items = s.elementos
        .map((e) => `          <li><strong>${esc(e.titulo)}</strong> — ${esc(e.texto)}</li>`)
        .join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <ol class="lista">
${items}
        </ol>
      </section>`;
    }
    case "faq": {
      const bloques = s.preguntas
        .map((q) => `          <details><summary>${esc(q.p)}</summary><p>${esc(q.a)}</p></details>`)
        .join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <div class="faq">
${bloques}
        </div>
      </section>`;
    }
    case "galeria": {
      const piezas = s.imagenes
        .map((i) => `          <figure class="figura">${ctx.img(i)}<figcaption>${esc(i.alt)}</figcaption></figure>`)
        .join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <div class="rejilla rejilla-3">
${piezas}
        </div>
      </section>`;
    }
    case "tabla": {
      const cab = s.cabecera.map((c) => `<th scope="col">${c}</th>`).join("");
      const filas = s.filas.map((f) => `          <tr>${f.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
      const nota = s.nota ? `\n        <p class="nota">${esc(s.nota)}</p>` : "";
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <table class="tabla">
          <thead><tr>${cab}</tr></thead>
          <tbody>
${filas}
          </tbody>
        </table>${nota}
      </section>`;
    }
    case "texto": {
      const parrafos = s.parrafos.map((p) => `        <p>${p}</p>`).join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
${parrafos}
      </section>`;
    }
    case "lista": {
      const items = s.items.map((i) => `          <li>${i}</li>`).join("\n");
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <ul class="lista">
${items}
        </ul>
      </section>`;
    }
    case "formulario": {
      const cuerpo =
        s.campos === "contacto"
          ? `          <label for="nombre">Nombre</label>
          <input id="nombre" name="nombre" type="text" autocomplete="name" required />
          <label for="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autocomplete="email" required />
          <label for="mensaje">Mensaje</label>
          <textarea id="mensaje" name="mensaje" rows="5" required></textarea>`
          : `          <label for="nombre">Nombre</label>
          <input id="nombre" name="nombre" type="text" autocomplete="name" required />
          <label for="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autocomplete="email" required />`;
      return `      <section class="seccion" id="formulario">
        <h2>${esc(s.titulo)}</h2>
        <p class="lead">${s.texto}</p>
        <form data-formulario novalidate>
${cuerpo}
          <button type="submit">Enviar</button>
          <p class="estado-formulario" data-estado role="status"></p>
        </form>
      </section>`;
    }
    case "aviso":
      return `      <aside class="seccion aviso">
        <h2>${esc(s.titulo)}</h2>
        <p>${esc(s.texto)}</p>
      </aside>`;
    case "datos": {
      const filas = s.filas
        .map(
          (f) =>
            `          <tr><th scope="row">${esc(f.label)}</th><td>${f.href ? `<a class="enlace" href="${f.href}">${esc(f.valor)}</a>` : f.valor}</td></tr>`
        )
        .join("\n");
      return `      <section class="seccion" id="datos">
        <h2>${esc(s.titulo)}</h2>
        <table class="tabla datos">
          <tbody>
${filas}
          </tbody>
        </table>
      </section>`;
    }
    case "testimonios":
      return `      <section class="seccion">
        <h2>${esc(s.titulo)}</h2>
        <blockquote class="cita">
          <p>${pr("Frase del cliente, entre comillas y en primera persona.")}</p>
          <footer>${pr("Nombre y empresa de quien lo dice")}</footer>
        </blockquote>
        <p class="nota">Estos espacios son estructura, no contenido: la plataforma no inventa testimonios
          ni nombres, y ${pr("solo tú puedes confirmar que las citas que escribas son reales")} — WebForge
          no las verifica.</p>
      </section>`;
  }
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = partes[0]?.[0] ?? "W";
  const segunda = partes[1]?.[0] ?? "";
  return (primera + segunda).toUpperCase();
}

function faviconSvg(nombre: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#2563eb" />
  <text x="32" y="42" fill="#ffffff" font-family="system-ui, sans-serif" font-size="28" font-weight="700"
    text-anchor="middle">${esc(iniciales(nombre))}</text>
</svg>
`;
}

/** Hueco etiquetado: el archivo existe para que la vista previa no rompa, pero dice que hay que sustituirlo. */
function marcadorSvg(o: Img): string {
  const titulo = Math.round(Math.min(o.ancho, o.alto) / 12);
  const sub = Math.round(Math.min(o.ancho, o.alto) / 18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.ancho}" height="${o.alto}" viewBox="0 0 ${o.ancho} ${o.alto}" role="img" aria-label="${esc(o.alt)}">
  <rect width="${o.ancho}" height="${o.alto}" fill="#e2e8f0" />
  <rect x="8" y="8" width="${o.ancho - 16}" height="${o.alto - 16}" fill="none" stroke="#94a3b8" stroke-width="3" stroke-dasharray="14 10" />
  <text x="${o.ancho / 2}" y="${o.alto / 2 - 10}" fill="#334155" font-family="system-ui, sans-serif" font-size="${titulo}" text-anchor="middle">${esc(o.archivo)}</text>
  <text x="${o.ancho / 2}" y="${o.alto / 2 + 28}" fill="#64748b" font-family="system-ui, sans-serif" font-size="${sub}" text-anchor="middle">Sustituye este hueco por tu imagen</text>
</svg>
`;
}

function paginaHtml(m: Modelo, p: PaginaDef, proyecto: string): { contenido: string; imagenes: Map<string, Img> } {
  const imagenes = new Map<string, Img>();
  let vistas = 0;
  const img = (o: Img) => {
    imagenes.set(o.archivo, o);
    vistas += 1;
    // La primera imagen de cada página es la que se ve antes de hacer scroll: esa no debe esperar.
    const carga = vistas === 1 ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"';
    return `<img src="assets/${esc(o.archivo)}" alt="${esc(o.alt)}" width="${o.ancho}" height="${o.alto}"${carga} />`;
  };
  const ctx: Contexto = { img };
  const fecha = hoy();
  const datos: Datos = { proyecto, fecha };

  const titulo = `${proyecto} · ${p.etiqueta}`;
  const url = `https://${DOMINIO}/${p.ruta}`;
  const rutas = m.paginas.filter((x) => x.ruta !== "404.html");
  const enMenu = rutas.filter((x) => !x.ocultaEnMenu);
  const actual = (ruta: string) => (ruta === p.ruta ? ' aria-current="page"' : "");

  const menu = enMenu
    .map((x) => `          <li><a href="${x.ruta}"${actual(x.ruta)}>${esc(x.etiqueta)}</a></li>`)
    .join("\n");
  const pie = rutas
    .map((x) => `        <li><a href="${x.ruta}"${actual(x.ruta)}>${esc(x.etiqueta)}</a></li>`)
    .join("\n");
  const migas =
    p.ruta === "index.html"
      ? `        <nav class="migas" aria-label="Migas de pan"><ol><li>${esc(p.etiqueta)}</li></ol></nav>`
      : `        <nav class="migas" aria-label="Migas de pan"><ol><li><a href="index.html">Inicio</a></li><li>${esc(p.etiqueta)}</li></ol></nav>`;

  const descripcion = sustituir(p.descripcion, datos);
  const ld = p.ld
    ? `\n    <script type="application/ld+json">${JSON.stringify(sustituir(p.ld, datos)).replace(/</g, "\\u003c")}</script>`
    : "";

  const secciones = sustituir(p.secciones, datos) as Seccion[];
  const cuerpo = secciones.map((s) => seccionHtml(s, ctx)).join("\n\n");

  return {
    contenido: `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(titulo)}</title>
    <meta name="description" content="${esc(descripcion)}" />
    <meta name="theme-color" content="#2563eb" />
    <meta name="author" content="${esc(proyecto)}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${esc(proyecto)}" />
    <meta property="og:title" content="${esc(titulo)}" />
    <meta property="og:description" content="${esc(descripcion)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="https://${DOMINIO}/assets/${esc(m.portada.archivo)}" />
    <meta property="og:locale" content="es_ES" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(titulo)}" />
    <meta name="twitter:description" content="${esc(descripcion)}" />
    <meta name="twitter:image" content="https://${DOMINIO}/assets/${esc(m.portada.archivo)}" />
    <link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="assets/favicon.svg" />
    <link rel="stylesheet" href="styles.css" />${ld}
  </head>
  <body>
    <a class="salto" href="#contenido">Saltar al contenido</a>
    <header class="site-header">
      <a class="brand" href="index.html">${esc(proyecto)}</a>
      <button class="menu" type="button" data-menu aria-expanded="false" aria-controls="nav-principal">Menú</button>
      <nav id="nav-principal" class="nav" aria-label="Principal" hidden>
        <ul class="nav-list">
${menu}
        </ul>
        <button class="tema" type="button" data-tema aria-pressed="false">Modo oscuro</button>
      </nav>
    </header>

    <main id="contenido">
${migas}

${cuerpo}
    </main>

    <a class="cta-fijo" href="${m.cta.href}">${esc(m.cta.texto)}</a>

    <footer class="site-footer">
      <nav aria-label="Enlaces del pie">
        <ul class="nav-list">
${pie}
        </ul>
      </nav>
      <p><span data-anio>${fecha.slice(0, 4)}</span> ${esc(proyecto)} · Última revisión el <time datetime="${fecha}">${fecha.split("-").reverse().join("/")}</time>.</p>
      <p class="nota">Maquetado con WebForge. Cambia los textos naranjas por los tuyos y pon tu dominio real
        en el fichero <code>.webforge.json</code>.</p>
    </footer>
    <script type="module" src="main.js"></script>
  </body>
</html>
`,
    imagenes
  };
}

function sitemapXml(rutas: string[]): string {
  const paginas = rutas.filter((r) => r !== "404.html");
  const hoy2 = hoy();
  const bloques = paginas
    .map(
      (r) => `  <url>
    <loc>https://${DOMINIO}/${r}</loc>
    <lastmod>${hoy2}</lastmod>
    <changefreq>monthly</changefreq>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Al publicar, sustituye TU-DOMINIO.example por tu dominio en este archivo y en robots.txt. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${bloques}
</urlset>
`;
}

const robotsTxt = () => `# Sustituye TU-DOMINIO.example por tu dominio antes de publicar.
User-agent: *
Allow: /

Sitemap: https://${DOMINIO}/sitemap.xml
`;

const CSS = `/*
  Estilos de la plantilla. El color, el espacio y la tipografía salen de las variables de :root:
  cambia un valor aquí y se actualiza toda la maquetación.
*/

:root {
  --ink: #0f172a;
  --muted: #475569;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-ink: #ffffff;
  --surface: #ffffff;
  --surface-2: #f8fafc;
  --line: #e2e8f0;
  --aviso: #b45309;
  --aviso-fondo: #fffbeb;

  --fuente-cuerpo: system-ui, -apple-system, "Segoe UI", sans-serif;
  --fuente-titulo: inherit;
  --escala-titulo: clamp(1.4rem, 3.4vw, 2rem);

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --radio: 0.75rem;
  --sombra: 0 1px 2px rgba(15, 23, 42, 0.08), 0 8px 24px rgba(15, 23, 42, 0.06);
  --ancho: 72ch;
}

/* Tema oscuro: main.js pone data-theme="oscuro" en <html> según la preferencia del visitante. */
[data-theme="oscuro"] {
  --ink: #e2e8f0;
  --muted: #94a3b8;
  --accent: #60a5fa;
  --accent-hover: #93c5fd;
  --accent-ink: #0b1120;
  --surface: #0b1120;
  --surface-2: #1e293b;
  --line: #334155;
  --aviso: #fcd34d;
  --aviso-fondo: #1f2937;
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
  line-height: 1.6;
}

h1,
h2,
h3 {
  font-family: var(--fuente-titulo);
  line-height: 1.2;
  margin-block: 0 var(--space-2);
}

h1 {
  font-size: clamp(1.8rem, 5vw, 2.7rem);
}

h2 {
  font-size: var(--escala-titulo);
}

h3 {
  font-size: 1.05rem;
}

a {
  color: var(--accent);
}

code {
  font-family: ui-monospace, "SFMono-Regular", monospace;
  font-size: 0.9em;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.salto {
  position: absolute;
  left: -9999px;
}

.salto:focus {
  left: var(--space-3);
  top: var(--space-3);
  z-index: 20;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
}

.site-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) clamp(var(--space-4), 5vw, 3rem);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.brand {
  font-weight: 700;
  text-decoration: none;
  color: var(--ink);
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
}

.nav[hidden] {
  display: none;
}

.menu {
  justify-self: auto;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink);
}

.menu:hover {
  background: var(--surface-2);
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

.nav-list a:hover,
.nav-list a[aria-current="page"] {
  color: var(--accent);
}

.tema {
  justify-self: auto;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
}

.tema:hover {
  background: var(--surface-2);
}

main {
  padding: clamp(var(--space-6), 6vw, 4rem);
  max-width: var(--ancho);
  margin: 0 auto;
}

.migas ol {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  list-style: none;
  margin: 0 0 var(--space-6);
  padding: 0;
  font-size: 0.85rem;
  color: var(--muted);
}

.migas li + li::before {
  content: "/";
  margin-inline-end: var(--space-2);
}

.seccion {
  padding-block: clamp(var(--space-4), 4vw, 2.5rem);
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

/* CTA pegada al borde inferior en móvil: se retira en escritorio, donde ya está en la cabecera. */
.cta-fijo {
  position: sticky;
  bottom: 0;
  display: block;
  margin: 0;
  padding: var(--space-3);
  text-align: center;
  font-weight: 600;
  text-decoration: none;
  background: var(--accent);
  color: var(--accent-ink);
  border-top: 1px solid var(--accent-hover);
}

@media (min-width: 64rem) {
  .cta-fijo {
    display: none;
  }
}

.enlace {
  color: var(--accent);
  text-underline-offset: 2px;
}

.enlace:hover {
  color: var(--accent-hover);
}

.tarjetas,
.rejilla {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.rejilla {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
}

.card,
.tarjeta,
.figura {
  border: 1px solid var(--line);
  border-radius: var(--radio);
  padding: var(--space-4);
  background: var(--surface-2);
}

.card {
  background: var(--surface);
}

.card p {
  margin: 0;
  color: var(--muted);
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

/* Texto que la plantilla escribe para que el dueño del sitio lo sustituya. */
.por-rellenar {
  background: var(--aviso-fondo);
  color: var(--aviso);
  border-bottom: 1px dashed var(--aviso);
  padding: 0 0.2rem;
  font-style: normal;
}

.nota {
  font-size: 0.9rem;
  color: var(--muted);
}

.aviso {
  border: 1px solid var(--aviso);
  border-radius: var(--radio);
  background: var(--aviso-fondo);
  padding: var(--space-4);
}

.aviso p {
  margin: 0;
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  margin-top: var(--space-4);
  font-size: 0.95rem;
}

.tabla th,
.tabla td {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}

.tabla thead th {
  font-weight: 600;
  border-bottom-width: 2px;
}

.tabla.datos th {
  width: 9rem;
  color: var(--muted);
  font-weight: 600;
}

.figura {
  margin: var(--space-4) 0;
  padding: var(--space-2);
}

.figura img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: calc(var(--radio) / 2);
}

.figura figcaption {
  margin-top: var(--space-2);
  padding-inline: var(--space-2);
  color: var(--muted);
  font-size: 0.9rem;
}

.faq {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.faq details {
  border: 1px solid var(--line);
  border-radius: var(--radio);
  padding: var(--space-3);
  background: var(--surface-2);
}

.faq summary {
  cursor: pointer;
  font-weight: 600;
}

.faq p {
  margin: var(--space-2) 0 0;
  color: var(--muted);
}

form,
.formulario {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  margin-top: var(--space-4);
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
  background: var(--surface-2);
}

@media (min-width: 40rem) {
  .menu {
    display: none;
  }

  .nav {
    display: flex !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto;
    transition: none;
  }
}

@media print {
  .cta-fijo,
  .site-header,
  .tema,
  .menu {
    display: none;
  }
}
`;

const MAIN_JS = `/*
  Lo que hay aquí funciona sin servidor: tema, menú de móvil, año del pie y validación de formularios.
  No simula envíos: si no hay backend, el mensaje se queda en el navegador y la página lo dice.
*/

const raiz = document.documentElement;
const CLAVE_TEMA = "wf-tema";

function aplicarTema(tema) {
  if (tema === "oscuro") raiz.setAttribute("data-theme", "oscuro");
  else raiz.removeAttribute("data-theme");
  const boton = document.querySelector("[data-tema]");
  if (!boton) return;
  boton.setAttribute("aria-pressed", String(tema === "oscuro"));
  boton.textContent = tema === "oscuro" ? "Modo claro" : "Modo oscuro";
}

function leerTemaGuardado() {
  try {
    return window.localStorage.getItem(CLAVE_TEMA);
  } catch {
    return null; // Navegación privada o almacenamiento bloqueado.
  }
}

function guardarTema(tema) {
  try {
    window.localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    /* Sin almacenamiento el tema solo dura esta visita. */
  }
}

const prefiereOscuro = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
aplicarTema(leerTemaGuardado() ?? (prefiereOscuro ? "oscuro" : "claro"));

document.querySelector("[data-tema]")?.addEventListener("click", () => {
  const nuevo = raiz.getAttribute("data-theme") === "oscuro" ? "claro" : "oscuro";
  aplicarTema(nuevo);
  guardarTema(nuevo);
});

const botonMenu = document.querySelector("[data-menu]");
const navegacion = document.getElementById("nav-principal");

function cambiarMenu(abrir) {
  if (!navegacion || !botonMenu) return;
  navegacion.hidden = !abrir;
  botonMenu.setAttribute("aria-expanded", String(abrir));
  botonMenu.textContent = abrir ? "Cerrar" : "Menú";
}

botonMenu?.addEventListener("click", () => cambiarMenu(navegacion ? navegacion.hidden : true));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cambiarMenu(false);
});
// En escritorio el menú se muestra siempre; el botón solo existe para pantallas estrechas.
cambiarMenu(window.matchMedia("(min-width: 40rem)").matches);

document.querySelectorAll("[data-anio]").forEach((elemento) => {
  elemento.textContent = String(new Date().getFullYear());
});

document.querySelectorAll("form[data-formulario]").forEach((form) => {
  const estado = form.querySelector("[data-estado]");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!estado) return;
    const faltan = [...form.querySelectorAll("[required]")].filter((campo) => {
      const valor = campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement ? campo.value : "";
      return valor.trim() === "";
    });
    if (faltan.length > 0) {
      estado.textContent = "Faltan campos obligatorios: " + faltan.map((campo) => campo.name ?? "").join(", ") + ".";
      const primero = faltan[0];
      if (primero instanceof HTMLElement) primero.focus();
      return;
    }
    const incorrecto = form.querySelector(":invalid");
    if (incorrecto instanceof HTMLElement) {
      incorrecto.reportValidity();
      return;
    }
    estado.textContent =
      "Los datos son válidos. Todavía no hay servidor que los reciba, así que no han salido de tu navegador: " +
      "conecta el backend desde WebForge y este formulario enviará a tu API.";
  });
});
`;

function fichaJson(m: Modelo, nombre: string): string {
  return `${JSON.stringify(
    {
      plantilla: m.id,
      familia: m.nombre,
      nombre,
      dominio: DOMINIO,
      idioma: "es",
      paginas: m.paginas.map((p) => p.ruta),
      creado: hoy(),
      pendientes: [
        "Sustituye TU-DOMINIO.example por tu dominio en sitemap.xml, robots.txt y en los enlaces canónicos de cada página.",
        "Escribe tus textos: todo lo marcado con la clase .por-rellenar es una pista, no contenido.",
        "Cambia los huecos de assets/ por tus imágenes reales y ajusta los atributos width y height.",
        "Rellena los datos de contacto y, si pides mensajes, conecta un backend antes de anunciar el formulario."
      ]
    },
    null,
    2
  )}\n`;
}

/** Páginas de negocio que comparten todas las familias comerciales (§10), con textos propios de cada una. */
function paginasComerciales(m: Modelo, textos: ComercialTextos): PaginaDef[] {
  return [
    ...m.paginas,
    {
      ruta: "contacto.html",
      etiqueta: "Contacto",
      ocultaEnMenu: true,
      descripcion: "Habla con {proyecto}: formulario, correo y horario de atención.",
      secciones: [
        { tipo: "hero", titulo: textos.contactoTitulo, texto: textos.contactoIntro, cta: m.cta.texto, ctaHref: "#formulario" },
        { tipo: "formulario", titulo: "Escríbenos", texto: "Cuéntanos qué necesitas y te respondemos por correo.", campos: "contacto" },
        {
          tipo: "datos",
          titulo: "Otros canales",
          filas: [
            { label: "Correo", valor: `<a class="enlace" href="mailto:hola@${DOMINIO}">hola@${DOMINIO}</a>` },
            { label: "Teléfono", valor: `<a class="enlace" href="tel:+34000000000">${pr("tu teléfono")}</a>` },
            { label: "Horario", valor: pr("días y horas en los que respondes") }
          ]
        },
        {
          tipo: "aviso",
          titulo: "Antes de publicar",
          texto: "El formulario valida y confirma, pero no envía: mientras no conectes un backend, los mensajes se quedan en el navegador del visitante."
        }
      ]
    },
    {
      ruta: "gracias.html",
      etiqueta: "Gracias",
      ocultaEnMenu: true,
      descripcion: "Confirmación de {proyecto}: el mensaje se ha validado en el navegador y falta el envío real.",
      secciones: [
        { tipo: "hero", titulo: "Gracias por escribir", texto: textos.graciasTexto, cta: "Volver al inicio", ctaHref: "index.html" },
        {
          tipo: "lista",
          titulo: "Qué pasa ahora",
          items: [
            "El mensaje se ha validado, pero solo viaja a tu correo cuando el sitio tenga un backend conectado.",
            `Revisa la bandeja de entrada de ${pr("el correo con el que respondes")}.`,
            "Si es urgente, usa el teléfono de la página de contacto."
          ]
        }
      ]
    },
    {
      ruta: "privacidad.html",
      etiqueta: "Privacidad",
      descripcion: "Qué datos guarda {proyecto}, con qué finalidad, cuánto tiempo y cómo pedir su borrado.",
      secciones: [
        {
          tipo: "texto",
          titulo: "Política de privacidad",
          parrafos: [
            `Plantilla orientativa, no es asesoramiento legal: adapta el texto a lo que haces de verdad con los datos de quienes visitan {proyecto}.`,
            textos.privacidadPunto
          ]
        },
        {
          tipo: "tabla",
          titulo: "Tratamientos de datos",
          cabecera: ["Dato", "Finalidad", "Base legal", "Conservación"],
          filas: [
            [pr("nombre y correo"), "Responder a tu solicitud", "Consentimiento del visitante", pr("cuánto tiempo los guardas")],
            [pr("datos de navegación"), pr("para qué los usas"), pr("base legal"), pr("tiempo")],
            [pr("otros datos"), pr("finalidad"), pr("base legal"), pr("tiempo")]
          ],
          nota: "Si no instalas analítica ni cookies de terceros, dilo explícito: también es información útil para quien visita el sitio."
        },
        {
          tipo: "lista",
          titulo: "Derechos",
          items: [
            "Pedir qué datos tuyos hay guardados.",
            "Corregirlos o pedir su borrado.",
            `Ejercerlos escribiendo a ${pr("tu correo de contacto")}.`
          ]
        }
      ]
    },
    {
      ruta: "aviso-legal.html",
      etiqueta: "Aviso legal",
      descripcion: "Información legal de {proyecto}: titularidad del sitio, condiciones de uso y limitaciones.",
      secciones: [
        {
          tipo: "texto",
          titulo: "Aviso legal",
          parrafos: [
            "Plantilla orientativa: sustituye los huecos naranjas por tu razón social y comprueba lo que exige la normativa de tu país.",
            textos.avisoPunto
          ]
        },
        {
          tipo: "datos",
          titulo: "Titular del sitio",
          filas: [
            { label: "Titular", valor: pr("persona o empresa responsable") },
            { label: "Identificación fiscal", valor: pr("CIF o NIF") },
            { label: "Domicilio", valor: pr("dirección postal") },
            { label: "Correo", valor: `<a class="enlace" href="mailto:legal@${DOMINIO}">legal@${DOMINIO}</a>` }
          ]
        },
        {
          tipo: "lista",
          titulo: "Condiciones de uso",
          items: [
            "Los contenidos son informativos; no sustituyen a un presupuesto ni a un contrato firmado.",
            "Las imágenes y textos del sitio deben ser tuyos o tener licencia que lo permita.",
            pr("añade aquí lo que condicione tu sector")
          ]
        }
      ]
    }
  ];
}

interface ComercialTextos {
  contactoTitulo: string;
  contactoIntro: string;
  graciasTexto: string;
  privacidadPunto: string;
  avisoPunto: string;
}

/* ------------------------------------------------------------------ piezas de copia */

const hero = (titulo: string, texto: string, ctaTexto: string, ctaHref: string, imagen?: Img): Seccion =>
  imagen
    ? { tipo: "hero", titulo, texto, cta: ctaTexto, ctaHref, imagen }
    : { tipo: "hero", titulo, texto, cta: ctaTexto, ctaHref };

const lista = (titulo: string, items: string[]): Seccion => ({ tipo: "lista", titulo, items });

const aviso = (titulo: string, texto: string): Seccion => ({ tipo: "aviso", titulo, texto });

/** Enlace de mapa que existe de verdad: OpenStreetMap publica `/directions`, el destino queda como hueco. */
const comoLlegar = (destino: string) => `https://www.openstreetmap.org/directions?to=${encodeURIComponent(destino)}`;

const pagina404 = (salida: { texto: string; href: string }): PaginaDef => ({
  ruta: "404.html",
  etiqueta: "Página no encontrada",
  ocultaEnMenu: true,
  descripcion: "Página no encontrada en {proyecto}: la dirección pedida no existe y aquí están las salidas.",
  secciones: [
    hero("Página no encontrada", "La dirección que has pedido no está en {proyecto}. Puede que hayamos movido el contenido o que el enlace venga mal escrito.", salida.texto, salida.href),
    lista("Salidas rápidas", [
      '<a class="enlace" href="index.html">Volver al inicio</a>',
      `El enlace del botón de arriba, que lleva a ${salida.texto.toLowerCase()}`,
      "Si buscabas un archivo concreto, escríbelo en el contacto y lo localizamos."
    ]),
    aviso(
      "Para quien mantiene el sitio",
      "Esta página devuelve estado 404 cuando el hosting lo configura. Revisa el dominio en robots.txt y en el sitemap antes de publicar."
    )
  ]
});

/** Familias comerciales (§10): al esqueleto se le añade contacto, agradecimiento, privacidad y aviso legal. */
function comercial(ficha: Omit<Modelo, "paginas">, base: PaginaDef[], textos: ComercialTextos): Modelo {
  // El CTA fijo del 404 no puede heredar el del inicio: en captación apunta a un ancla que aquí no existe.
  const con404: Modelo = { ...ficha, paginas: [...base, pagina404({ texto: "Escribir un mensaje", href: "contacto.html" })] };
  return { ...con404, paginas: paginasComerciales(con404, textos) };
}

const BASE_COMERCIAL: ComercialTextos = {
  contactoTitulo: "Hablemos de tu proyecto",
  contactoIntro: "Cuéntanos qué necesitas. <span class=\"por-rellenar\">en cuántos días respondes</span>",
  graciasTexto: "El mensaje se ha validado en tu navegador. Te contestamos a la dirección que nos dejes.",
  privacidadPunto: "Describe qué guardas, por qué y durante cuánto tiempo: la tabla de abajo es el formato habitual.",
  avisoPunto: "Incluye titular, domicilio, identificación fiscal y las condiciones con las que ofreces el servicio."
};

/* ------------------------------------------------------------------ diez familias (§15) */

const landing = comercial(
  {
    id: "landing",
    nombre: "Landing de producto",
    descripcion: "Una sola página que explica el producto, resuelve dudas y lleva al visitante al formulario.",
    incluye: [
      "Inicio con CTA fijo en móvil",
      "Beneficios y pasos para empezar",
      "Preguntas frecuentes",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Pedir información", href: "contacto.html" },
    portada: portadaDe("portada.svg", "Portada con el producto y el nombre del proyecto")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Inicio",
      descripcion: "{proyecto}: para qué sirve el producto, a quién ayuda y cómo se da el primer paso.",
      secciones: [
        hero(
          "Tu producto, en una frase",
          "Escribe aquí la promesa principal de {proyecto} y a quién va dirigida. <span class=\"por-rellenar\">una frase, no un párrafo</span>",
          "Ver para qué sirve",
          "contacto.html",
          portadaDe("portada.svg", "Portada con el producto y el nombre del proyecto")
        ),
        {
          tipo: "tarjetas",
          titulo: "Para qué sirve",
          intro: "Tres ideas concretas: si el visitante solo lee esto, tiene que entender qué hace el producto.",
          elementos: [
            { titulo: "Ahorra tiempo", texto: "Cambia «resuelve X en dos clics» por el beneficio real que ofreces." },
            { titulo: "Se entiende", texto: "Habla en el idioma de quien compra, no en el de tu equipo." },
            { titulo: "Da el paso", texto: "Un solo botón siempre visible: por eso el CTA viaja pegado al borde en móvil." }
          ]
        },
        {
          tipo: "pasos",
          titulo: "Cómo empezar",
          elementos: [
            { titulo: "Escríbenos", texto: "Rellena el formulario de contacto con lo que necesitas." },
            { titulo: "Lo miramos", texto: "Sustituye este paso por lo que ocurre de verdad entre el mensaje y la respuesta." },
            { titulo: "Arrancas", texto: "Cambia este texto por tu entrega real: alta, reunión, presupuesto o envío." }
          ]
        },
        { tipo: "testimonios", titulo: "Testimonios" },
        {
          tipo: "faq",
          titulo: "Preguntas frecuentes",
          preguntas: [
            { p: "¿Cuánto cuesta?", a: "Pon aquí tus tarifas o explica cómo se calculan: es la primera pregunta que hará quien llegue." },
            { p: "¿Cuánto se tarda?", a: "Di el plazo real de entrega, incluyendo el peor caso." },
            { p: "¿Puedo probar antes?", a: "Explica qué puede ver gratis alguien que todavía no compra." }
          ]
        }
      ]
    }
  ],
  { ...BASE_COMERCIAL, contactoTitulo: "Pide información" }
);

const captacion = comercial(
  {
    id: "captacion",
    nombre: "Captación de contactos",
    descripcion: "Página orientada a conseguir correos interesados: oferta clara, dudas resueltas y formulario corto.",
    incluye: [
      "Formulario en el propio inicio",
      "Seis preguntas frecuentes",
      "CTA fijo en móvil",
      "Datos estructurados de FAQ",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal"
    ],
    cta: { texto: "Apuntarme", href: "#formulario" },
    portada: portadaDe("oferta.svg", "Imagen de la oferta principal del proyecto")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Oferta",
      descripcion: "Apúntate a {proyecto}: qué recibes, cada cuánto y cómo darte de baja, con las dudas más habituales resueltas.",
      ld: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        name: "{proyecto}",
        mainEntity: [
          { "@type": "Question", name: "¿Qué recibo exactamente?", acceptedAnswer: { "@type": "Answer", text: "Describe el contenido que llega al suscriptor." } },
          { "@type": "Question", name: "¿Cada cuánto escribe el proyecto?", acceptedAnswer: { "@type": "Answer", text: "Dice la frecuencia real de envío." } },
          { "@type": "Question", name: "¿Quién está detrás?", acceptedAnswer: { "@type": "Answer", text: "Nombre y motivo por el que se puede confiar." } },
          { "@type": "Question", name: "¿Es gratis?", acceptedAnswer: { "@type": "Answer", text: "Deja claro lo que es gratis y lo que se paga después." } },
          { "@type": "Question", name: "¿Cómo doy de baja?", acceptedAnswer: { "@type": "Answer", text: "Un clic desde el correo, sin llamadas ni papeles." } },
          { "@type": "Question", name: "¿Qué hacéis con mi correo?", acceptedAnswer: { "@type": "Answer", text: "Remite a la política de privacidad del sitio." } }
        ]
      },
      secciones: [
        hero(
          "Apúntate y te lo contamos",
          "Explica en dos frases qué va a recibir quien se apunte a {proyecto} y por qué merece el sitio en su bandeja de entrada.",
          "Quiero recibirlo",
          "#formulario",
          portadaDe("oferta.svg", "Imagen de la oferta principal del proyecto")
        ),
        { tipo: "formulario", titulo: "Déjanos tu correo", texto: "Nombre y correo, nada más: menos campos, más apuntes.", campos: "sencillo" },
        {
          tipo: "tarjetas",
          titulo: "Qué recibes",
          rejilla: 2,
          elementos: [
            { titulo: "Contenido", texto: "Enumera el tipo de envío: análisis, casos prácticos, ofertas." },
            { titulo: "Frecuencia", texto: "Di cada cuánto escribes y cúmplelo." },
            { titulo: "Autoría", texto: "Quién firma y por qué sabe de lo que habla." },
            { titulo: "Salida", texto: "Cómo se da de baja quien ya no quiere seguir." }
          ]
        },
        {
          tipo: "faq",
          titulo: "Dudas frecuentes",
          preguntas: [
            { p: "¿Qué recibo exactamente?", a: "Describe el contenido que llega al suscriptor, sin prometer lo que no envías." },
            { p: "¿Cada cuánto escribís?", a: "Pon la frecuencia real: semanal, quincenal o por temporada." },
            { p: "¿Quién está detrás?", a: "Nombre y por qué se puede confiar en lo que se cuenta." },
            { p: "¿Es gratis?", a: "Deja claro lo que es gratis y lo que se paga más adelante." },
            { p: "¿Cómo me doy de baja?", a: "Un clic desde el correo, sin llamadas ni papeles." },
            { p: "¿Qué hacéis con mi correo?", a: "Explica el uso y enlaza la política de privacidad: es lo primero que miran los que dudan." }
          ]
        },
        aviso(
          "El formulario todavía no envía",
          "Esta página valida los campos y avisa en pantalla, pero no manda el correo a ningún sitio. Conecta el backend desde WebForge y decide dónde se guardan los contactos."
        )
      ]
    }
  ],
  {
    ...BASE_COMERCIAL,
    contactoTitulo: "Habla con el proyecto",
    graciasTexto: "Ya estás en la lista. El primer envío llega cuando haya algo escrito que merezca la pena leerte."
  }
);

const corporativa = comercial(
  {
    id: "corporativa",
    nombre: "Empresa o estudio",
    descripcion: "Sitio serio de varios servicios: quién eres, qué haces, cómo trabajas y cómo contratarte.",
    incluye: [
      "Inicio con servicios",
      "Página de servicios detallada",
      "Testimonios con aviso de veracidad",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Solicitar presupuesto", href: "contacto.html" },
    portada: portadaDe("sede.svg", "Fachada, oficina o lugar de trabajo del proyecto")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Inicio",
      descripcion: "{proyecto} trabaja con quien necesita servicios profesionales: servicios, forma de trabajar y contacto directo.",
      ld: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "{proyecto}",
        url: "https://TU-DOMINIO.example/index.html"
      },
      secciones: [
        hero(
          "Quiénes somos y qué hacemos",
          "Presenta {proyecto} en dos frases: a quién sirves y con qué resultado. Sin adjetivos que no puedas demostrar.",
          "Ver servicios",
          "servicios.html",
          portadaDe("sede.svg", "Fachada, oficina o lugar de trabajo del proyecto")
        ),
        {
          tipo: "tarjetas",
          titulo: "Servicios",
          intro: "Cada tarjeta es una línea de trabajo. La página de servicios las explica con calma.",
          elementos: [
            { titulo: "Servicio principal", texto: "Nombre y resultado que obtiene el cliente." },
            { titulo: "Servicio habitual", texto: "Lo que más se repite en tu cartera." },
            { titulo: "Servicio de apoyo", texto: "Lo que resuelve dudas antes o después del trabajo." }
          ]
        },
        {
          tipo: "pasos",
          titulo: "Cómo trabajamos",
          elementos: [
            { titulo: "Escuchamos", texto: "Primera conversación sin coste ni compromiso." },
            { titulo: "Proponemos", texto: "Alcance, plazo y precio por escrito." },
            { titulo: "Entregamos", texto: "Trabajo, revisión y qué pasa después de firmar." }
          ]
        },
        { tipo: "testimonios", titulo: "Lo que dicen los clientes" },
        {
          tipo: "tabla",
          titulo: "Datos para decidir",
          cabecera: ["Concepto", "Lo que puedes prometer"],
          filas: [
            ["Plazo habitual", pr("semanas o meses reales")],
            ["Cómo se factura", pr("forma de pago")],
            ["Garantía", pr("qué cubre y qué no")]
          ],
          nota: "Una tabla breve responde más rápido que tres párrafos de introducción."
        }
      ]
    },
    {
      ruta: "servicios.html",
      etiqueta: "Servicios",
      descripcion: "Detalle de los servicios de {proyecto}: qué incluye cada uno, para quién es y cómo se contrata.",
      secciones: [
        {
          tipo: "tarjetas",
          titulo: "Cada servicio, por separado",
          rejilla: 2,
          elementos: [
            { titulo: "Servicio A", texto: "Qué incluye, para quién es y qué no entra." },
            { titulo: "Servicio B", texto: "Plazo estimado y qué hace falta para empezar." },
            { titulo: "Servicio C", texto: "Precio o rango, y qué lo encarece o abarata." },
            { titulo: "Mantenimiento", texto: "Qué pasa después de entregar el primer trabajo." }
          ]
        },
        {
          tipo: "lista",
          titulo: "Antes de contratar",
          items: [
            pr("lo que necesitas del cliente para empezar"),
            pr("lo que entregas y en qué formato"),
            pr("qué no entra en el precio"),
            "Las condiciones se firman: esta página informa, no obliga."
          ]
        }
      ]
    }
  ],
  { ...BASE_COMERCIAL, contactoTitulo: "Pide presupuesto" }
);

const negocioLocal = comercial(
  {
    id: "negocio-local",
    nombre: "Negocio de barrio",
    descripcion: "Para tiendas, clínicas o talleres: dónde estás, cuándo abres y cómo llegar, con ficha de negocio local.",
    incluye: [
      "Ficha con horario y dirección",
      "Datos estructurados LocalBusiness",
      "Enlace de indicaciones para llegar",
      "Galería del local",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal"
    ],
    cta: { texto: "Cómo llegar", href: "como-llegar.html" },
    portada: portadaDe("local.svg", "Fachada del local desde la calle")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Inicio",
      descripcion: "{proyecto}: horario, dirección, teléfono y cómo llegar al local, con la ficha también en datos estructurados.",
      ld: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: "{proyecto}",
        url: "https://TU-DOMINIO.example/index.html",
        image: "https://TU-DOMINIO.example/assets/local.svg",
        address: {
          "@type": "PostalAddress",
          streetAddress: "Calle y número reales",
          addressLocality: "Ciudad",
          postalCode: "00000",
          addressCountry: "ES"
        },
        openingHoursSpecification: [
          {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            opens: "09:00",
            closes: "18:00"
          }
        ],
        telephone: "+34 000 000 000"
      },
      secciones: [
        hero(
          "Cerca de ti, abierto hoy",
          "Di qué es {proyecto} y en qué barrio estás: quien busca cerca quiere dirección, horario y una foto de la fachada.",
          "Ver horario y dirección",
          "#datos",
          portadaDe("local.svg", "Fachada del local desde la calle")
        ),
        {
          tipo: "datos",
          titulo: "Dónde y cuándo",
          filas: [
            { label: "Dirección", valor: pr("calle, número y ciudad") },
            { label: "Horario", valor: pr("lunes a viernes de 9 a 18") },
            { label: "Teléfono", valor: `<a class="enlace" href="tel:+34000000000">${pr("tu teléfono")}</a>` },
            { label: "Indicaciones", valor: `<a class="enlace" href="${comoLlegar("00000 Tu ciudad")}">Cómo llegar</a>` }
          ]
        },
        {
          tipo: "galeria",
          titulo: "Cómo es el local",
          imagenes: [
            { archivo: "interior.svg", alt: "Interior del local con el mostrador y luz natural", ancho: 800, alto: 600 },
            { archivo: "producto-local.svg", alt: "Producto o servicio principal de este negocio", ancho: 800, alto: 600 },
            { archivo: "mostrador.svg", alt: "Persona que atiende el mostrador del negocio", ancho: 800, alto: 600 }
          ]
        },
        { tipo: "testimonios", titulo: "Reseñas" },
        aviso(
          "Los datos de la ficha van en serio",
          "Horario, dirección y teléfono aparecen también en los datos estructurados que leen los buscadores. Si cambian, actualiza las dos cosas: la página y el bloque JSON-LD."
        )
      ]
    },
    {
      ruta: "como-llegar.html",
      etiqueta: "Cómo llegar",
      descripcion: "Cómo llegar a {proyecto}: dirección, transporte público, horario y el enlace de indicaciones.",
      secciones: [
        {
          tipo: "lista",
          titulo: "Llegar al local",
          items: [
            `Dirección: ${pr("calle, número, ciudad y código postal")}`,
            `Metro o autobús: ${pr("líneas y parada más cercana")}`,
            `Dónde aparcar: ${pr("aparcamiento o calles cercanas")}`,
            `<a class="enlace" href="${comoLlegar("00000 Tu ciudad")}">Abrir el mapa con indicaciones</a>`
          ]
        },
        {
          tipo: "datos",
          titulo: "Horario de atención",
          filas: [
            { label: "Mañanas", valor: pr("de 9:00 a 14:00") },
            { label: "Tardes", valor: pr("de 17:00 a 20:00") },
            { label: "Festivos", valor: pr("qué haces los festivos") }
          ]
        },
        aviso(
          "Sobre el mapa",
          "El enlace abre OpenStreetMap con la dirección como destino. Si prefieres incrustar un mapa interactivo, necesitas el servicio de un proveedor y su política de cookies."
        )
      ]
    }
  ],
  {
    ...BASE_COMERCIAL,
    contactoTitulo: "Reservar cita o escribir",
    contactoIntro: "Cuéntanos qué necesitas de {proyecto} y te decimos cuándo hay hueco. <span class=\"por-rellenar\">en cuántos días respondes</span>"
  }
);

const portfolio = comercial(
  {
    id: "portfolio",
    nombre: "Portfolio profesional",
    descripcion: "Galería de trabajos con contexto de cada encargo, para quien vende diseño, fotografía o desarrollo.",
    incluye: [
      "Galería con carga diferida",
      "Página de trabajos con contexto",
      "CTA de encargo fija en móvil",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Pedir encargo", href: "contacto.html" },
    portada: portadaDe("trabajo-destacado.svg", "Trabajo destacado del portfolio a gran tamaño")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Inicio",
      descripcion: "Portfolio de {proyecto}: trabajos seleccionados, en qué consistieron y qué se puede encargar.",
      secciones: [
        hero(
          "Trabajo seleccionado",
          "Presenta a quien firma {proyecto} y el tipo de encargo que hace mejor.",
          "Ver todos los trabajos",
          "trabajos.html",
          portadaDe("trabajo-destacado.svg", "Trabajo destacado del portfolio a gran tamaño")
        ),
        {
          tipo: "galeria",
          titulo: "Últimos trabajos",
          imagenes: [
            { archivo: "trabajo-1.svg", alt: "Primer trabajo seleccionado del portfolio", ancho: 800, alto: 600 },
            { archivo: "trabajo-2.svg", alt: "Segundo trabajo seleccionado del portfolio", ancho: 800, alto: 600 },
            { archivo: "trabajo-3.svg", alt: "Tercer trabajo seleccionado del portfolio", ancho: 800, alto: 600 }
          ]
        },
        {
          tipo: "tarjetas",
          titulo: "Qué encargar",
          rejilla: 2,
          elementos: [
            { titulo: "Tipo de encargo A", texto: "Plazo aproximado y qué necesita quien contrata." },
            { titulo: "Tipo de encargo B", texto: "Precio de partida y qué lo cambia." },
            { titulo: "Tipo de encargo C", texto: "Ejemplo real de algo ya entregado." },
            { titulo: "Colaboraciones", texto: "Qué tipo de proyecto no aceptas ahora mismo." }
          ]
        },
        { tipo: "testimonios", titulo: "Testimonios" }
      ]
    },
    {
      ruta: "trabajos.html",
      etiqueta: "Trabajos",
      descripcion: "Todos los trabajos de {proyecto}: qué se pidió en cada encargo y qué se entregó al final.",
      secciones: [
        {
          tipo: "tabla",
          titulo: "Cada encargo, con contexto",
          cabecera: ["Trabajo", "Qué se pidió", "Qué se entregó"],
          filas: [
            [pr("nombre del proyecto"), pr("el encargo"), pr("el resultado")],
            [pr("nombre del proyecto"), pr("el encargo"), pr("el resultado")],
            [pr("nombre del proyecto"), pr("el encargo"), pr("el resultado")]
          ],
          nota: "Explica el problema y la solución, no solo la captura bonita: eso es lo que lee quien contrata."
        },
        {
          tipo: "galeria",
          titulo: "Galería ampliada",
          imagenes: [
            { archivo: "trabajo-4.svg", alt: "Cuarto trabajo del portfolio visto de cerca", ancho: 800, alto: 600 },
            { archivo: "trabajo-5.svg", alt: "Quinto trabajo del portfolio visto de cerca", ancho: 800, alto: 600 },
            { archivo: "trabajo-6.svg", alt: "Sexto trabajo del portfolio visto de cerca", ancho: 800, alto: 600 },
            { archivo: "detalle.svg", alt: "Detalle de un material o pantalla de un trabajo entregado", ancho: 800, alto: 600 }
          ]
        }
      ]
    }
  ],
  { ...BASE_COMERCIAL, contactoTitulo: "Encargar un trabajo" }
);

const blog = comercial(
  {
    id: "blog",
    nombre: "Blog con suscripción",
    descripcion: "Listado de entradas y una entrada de ejemplo escrita de verdad, con suscripción por correo.",
    incluye: [
      "Listado de entradas con fecha",
      "Entrada de ejemplo con BlogPosting",
      "Formulario de suscripción",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Leer la entrada de ejemplo", href: "ejemplo-de-entrada.html" },
    portada: portadaDe("entrada-destacada.svg", "Imagen de la entrada destacada del blog")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Blog",
      descripcion: "Blog de {proyecto}: entradas recientes, de qué se escribe aquí y cómo recibirlas por correo.",
      secciones: [
        hero(
          "Lo que cuenta el blog",
          "Di en dos frases de qué se escribe aquí y a quién le interesa leer {proyecto}.",
          "Leer la entrada de ejemplo",
          "ejemplo-de-entrada.html",
          portadaDe("entrada-destacada.svg", "Imagen de la entrada destacada del blog")
        ),
        {
          tipo: "tarjetas",
          titulo: "Formato de una entrada",
          intro: "Título que dice algo, fecha y una frase que dé ganas de entrar: así están escritas las tarjetas de abajo.",
          elementos: [
            { titulo: "Cómo usar esta plantilla", texto: "La entrada de ejemplo lleva el formato completo, escrito." },
            { titulo: "Tu primera entrada", texto: "Escribe sobre algo que ya sabes hacer y demuéstralo con detalle." },
            { titulo: "Series", texto: "Agrupa entradas por tema cuando tengas varias del mismo asunto." }
          ]
        },
        {
          tipo: "lista",
          titulo: "Últimas entradas",
          items: [
            `<a class="enlace" href="ejemplo-de-entrada.html">Cómo usar esta plantilla de blog</a> — <time datetime="{fecha}">{fecha}</time>`,
            `${pr("título de tu segunda entrada")} — <time datetime="{fecha}">{fecha}</time>`,
            `${pr("título de tu tercera entrada")} — <time datetime="{fecha}">{fecha}</time>`
          ]
        }
      ]
    },
    {
      ruta: "ejemplo-de-entrada.html",
      etiqueta: "Entrada de ejemplo",
      ocultaEnMenu: true,
      descripcion: "Entrada escrita de ejemplo en {proyecto}: qué lleva cada bloque y qué cambiar para publicar la tuya.",
      ld: {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: "Cómo usar esta plantilla de blog",
        datePublished: "{fecha}",
        dateModified: "{fecha}",
        author: { "@type": "Organization", name: "{proyecto}" },
        publisher: { "@type": "Organization", name: "{proyecto}" },
        image: "https://TU-DOMINIO.example/assets/entrada-destacada.svg",
        url: "https://TU-DOMINIO.example/ejemplo-de-entrada.html"
      },
      secciones: [
        {
          tipo: "texto",
          titulo: "Cómo usar esta plantilla de blog",
          parrafos: [
            "Esta entrada no es relleno: está escrita para que veas el formato completo. Copia la estructura y cambia el contenido.",
            "Un título que dice algo concreto, una primera frase que explica por qué merece la pena leer, y párrafos cortos. Después vienen los bloques que la plantilla ya trae: imagen, lista y formulario.",
            "El pie de página enlaza privacidad y aviso legal, y el sitemap incluye esta entrada para que el buscador la encuentre sin que tú tengas que hacer nada más."
          ]
        },
        {
          tipo: "galeria",
          titulo: "Una imagen por entrada",
          imagenes: [{ archivo: "detalle-entrada.svg", alt: "Imagen que acompaña el texto de la entrada del blog", ancho: 1200, alto: 675 }]
        },
        {
          tipo: "lista",
          titulo: "Comprobación antes de publicar",
          items: [
            "Título único de menos de 60 caracteres y descripción de menos de 160.",
            "Imagen con texto alternativo que describe la foto, no el nombre del archivo.",
            "Enlaces internos a otras entradas del mismo tema.",
            `Fecha y autoría reales de {proyecto}: ${pr("quién firma la entrada")}`
          ]
        },
        { tipo: "testimonios", titulo: "Comentarios de quien lee" },
        { tipo: "formulario", titulo: "Suscripción", texto: "Correo y nada más: quien ya te lee no tiene por qué repetir su nombre.", campos: "sencillo" }
      ]
    }
  ],
  {
    ...BASE_COMERCIAL,
    contactoTitulo: "Escribir al blog",
    graciasTexto: "Apuntado queda. Las entradas se envían cuando hay algo escrito, no por calendario."
  }
);

const tienda = comercial(
  {
    id: "tienda",
    nombre: "Tienda pequeña",
    descripcion: "Catálogo breve con ficha de producto honesta: sin carrito ni pago simulados hasta conectar una pasarela.",
    incluye: [
      "Catálogo con precios por rellenar",
      "Ficha de producto con Product",
      "Aviso explícito de que no hay pago",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Preguntar por un producto", href: "contacto.html" },
    portada: portadaDe("producto-destacado.svg", "Producto destacado de la tienda")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Catálogo",
      descripcion: "Catálogo de {proyecto}: productos, precios y cómo pedirlos mientras no haya tienda con pago en línea.",
      secciones: [
        hero(
          "Lo que vende la tienda",
          "Explica qué tipo de producto vende {proyecto} y por qué se compra aquí en vez de en otro sitio.",
          "Ver la ficha de ejemplo",
          "producto-ejemplo.html",
          portadaDe("producto-destacado.svg", "Producto destacado de la tienda")
        ),
        {
          tipo: "galeria",
          titulo: "Productos",
          imagenes: [
            { archivo: "producto-1.svg", alt: "Primer producto de la tienda sobre fondo neutro", ancho: 800, alto: 600 },
            { archivo: "producto-2.svg", alt: "Segundo producto de la tienda sobre fondo neutro", ancho: 800, alto: 600 },
            { archivo: "producto-3.svg", alt: "Tercer producto de la tienda sobre fondo neutro", ancho: 800, alto: 600 }
          ]
        },
        {
          tipo: "tabla",
          titulo: "Precios y entrega",
          cabecera: ["Producto", "Precio", "Plazo de entrega"],
          filas: [
            [`<a class="enlace" href="producto-ejemplo.html">Producto de ejemplo</a>`, pr("importe y divis"), pr("días")],
            [pr("producto"), pr("importe"), pr("días")],
            [pr("producto"), pr("importe"), pr("días")]
          ]
        },
        aviso(
          "Todavía no hay pago en línea",
          "Esta plantilla no simula carrito ni cobro: no hay ninguna pasarela conectada. Para vender ahora, quien llega escribe desde la página de contacto y el pedido se cierra con el medio que ya uses."
        )
      ]
    },
    {
      ruta: "producto-ejemplo.html",
      etiqueta: "Producto de ejemplo",
      ocultaEnMenu: true,
      descripcion: "Ficha del producto de ejemplo de {proyecto}: medidas, material, precio y qué pasa cuando lo pides.",
      ld: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Producto de ejemplo",
        image: "https://TU-DOMINIO.example/assets/producto-destacado.svg",
        description: "Ficha de ejemplo que muestra el formato completo de un producto de esta tienda.",
        brand: { "@type": "Brand", name: "{proyecto}" },
        offers: {
          "@type": "Offer",
          price: "0.00",
          priceCurrency: "EUR",
          availability: "https://schema.org/InStock",
          url: "https://TU-DOMINIO.example/producto-ejemplo.html"
        }
      },
      secciones: [
        {
          tipo: "galeria",
          titulo: "El producto",
          imagenes: [
            { archivo: "producto-frente.svg", alt: "Vista frontal del producto de ejemplo de la tienda", ancho: 1000, alto: 750 },
            { archivo: "producto-detalle.svg", alt: "Detalle del material acabado del producto de ejemplo", ancho: 1000, alto: 750 }
          ]
        },
        {
          tipo: "datos",
          titulo: "Ficha técnica",
          filas: [
            { label: "Precio", valor: pr("importe con impuestos incluidos") },
            { label: "Medidas", valor: pr("alto, ancho y peso") },
            { label: "Material", valor: pr("de qué está hecho") },
            { label: "Entrega", valor: pr("plazo y coste del envío") }
          ]
        },
        {
          tipo: "lista",
          titulo: "Cómo pedirlo",
          items: [
            '<a class="enlace" href="contacto.html">Escríbenos</a> diciendo cuántas unidades quieres.',
            pr("cómo confirmas el pedido y el cobro"),
            pr("qué pasa si hay que devolverlo")
          ]
        },
        aviso(
          "Sobre el precio de los datos estructurados",
          "El bloque JSON-LD de esta página lleva 0.00 como marcador. Cambia ese valor por tu precio real antes de publicar: el buscador lee ese número, no el texto que se ve."
        )
      ]
    }
  ],
  {
    ...BASE_COMERCIAL,
    contactoTitulo: "Preguntar por un producto",
    privacidadPunto: "Añade lo que guardas de los pedidos: dirección de envío, medio de pago y conservación de facturas.",
    avisoPunto: "Una tienda necesita condiciones de venta, derecho de desistimiento y quién responde ante las incidencias."
  }
);

const directorio = comercial(
  {
    id: "directorio",
    nombre: "Directorio de fichas",
    descripcion: "Listado de fichas en tabla, con página para que cualquiera proponga una entrada nueva.",
    incluye: [
      "Tabla de entradas con estado del dato",
      "Formulario para proponer fichas",
      "Aviso de verificación",
      "Contacto y agradecimiento",
      "Privacidad y aviso legal",
      "sitemap.xml y robots.txt"
    ],
    cta: { texto: "Proponer una ficha", href: "proponer.html" },
    portada: portadaDe("directorio.svg", "Vista general del directorio con varias fichas")
  },
  [
    {
      ruta: "index.html",
      etiqueta: "Directorio",
      descripcion: "Directorio de {proyecto}: fichas ordenadas con fecha de comprobación y forma de proponer nuevas.",
      ld: {
        "@context": "https://schema.org",
        "@type": "DataCatalog",
        name: "{proyecto}",
        url: "https://TU-DOMINIO.example/index.html"
      },
      secciones: [
        hero(
          "Fichas del directorio",
          "Explica qué reúne este directorio, quién lo mantiene y cada cuánto se comprueban los datos de {proyecto}.",
          "Proponer una ficha",
          "proponer.html",
          portadaDe("directorio.svg", "Vista general del directorio con varias fichas")
        ),
        {
          tipo: "tabla",
          titulo: "Entradas",
          cabecera: ["Ficha", "Categoría", "Estado del dato"],
          filas: [
            [pr("nombre de la ficha"), pr("categoría"), pr("cuándo se comprobó")],
            [pr("nombre de la ficha"), pr("categoría"), pr("cuándo se comprobó")],
            [pr("nombre de la ficha"), pr("categoría"), pr("cuándo se comprobó")]
          ],
          nota: "Un directorio vale lo que valga su comprobación: pon la fecha en la que miraste cada ficha por última vez."
        },
        {
          tipo: "lista",
          titulo: "Cómo se añade una ficha",
          items: [
            '<a class="enlace" href="proponer.html">Propón la ficha</a> con el nombre y el enlace que quieres incluir.',
            pr("quién revisa las propuestas"),
            pr("en cuánto tiempo aparece publicada"),
            "Si la ficha es de un negocio, enlaza su página oficial: no copies datos de terceros."
          ]
        }
      ]
    },
    {
      ruta: "proponer.html",
      etiqueta: "Proponer ficha",
      descripcion: "Propón una ficha para el directorio de {proyecto}: nombre, enlace y por qué debería estar.",
      secciones: [
        {
          tipo: "formulario",
          titulo: "Nueva ficha",
          texto: "Nombre, correo de quien propone y el enlace de la ficha. El resto lo comprobamos nosotros.",
          campos: "contacto"
        },
        {
          tipo: "lista",
          titulo: "Qué entra y qué no",
          items: [
            "Fichas de negocios o recursos con página propia.",
            "Nada de datos personales de terceros sin su permiso.",
            pr("criterios de tu sector")
          ]
        },
        aviso("Sin envío todavía", "El formulario valida los campos y confirma en pantalla, pero no guarda ninguna propuesta mientras no conectes el backend.")
      ]
    }
  ],
  {
    ...BASE_COMERCIAL,
    contactoTitulo: "Contacto del directorio",
    avisoPunto: "Un directorio responde por los datos que publica: deja claro quién los comprueba y cómo se corrigen."
  }
);

const aplicacion: Omit<Modelo, "paginas"> = {
  id: "aplicacion",
  nombre: "Aplicación web",
  descripcion: "Interfaz de herramienta con acceso, ayuda y aviso claro de lo que todavía necesita un servidor.",
  incluye: ["Inicio con primeros pasos", "Pantalla de acceso", "Centro de ayuda", "Preguntas frecuentes", "Aviso de backend pendiente", "sitemap.xml y robots.txt"],
  cta: { texto: "Entrar", href: "acceso.html" },
  portada: portadaDe("pantalla.svg", "Captura de la pantalla principal de la aplicación")
};

const aplicacionPaginas: PaginaDef[] = [
  {
    ruta: "index.html",
    etiqueta: "Inicio",
    descripcion: "{proyecto}: qué hace la aplicación, qué necesita cada cuenta y cómo se entra.",
    secciones: [
      hero(
        "La herramienta, en una frase",
        "Explica qué resuelve {proyecto} y con qué cuenta se entra. Aquí no se viene a leer promesas: se viene a usar algo.",
        "Entrar",
        "acceso.html",
        portadaDe("pantalla.svg", "Captura de la pantalla principal de la aplicación")
      ),
      {
        tipo: "pasos",
        titulo: "Primeros pasos",
        elementos: [
          { titulo: "Entra con tu cuenta", texto: "La pantalla de acceso está en el menú principal." },
          { titulo: "Elige un archivo", texto: "Cambia esto por el primer objeto real con el que se trabaja." },
          { titulo: "Guarda", texto: "Di qué se guarda, dónde y si se puede deshacer." }
        ]
      },
      {
        tipo: "tarjetas",
        titulo: "Qué incluye",
        elementos: [
          { titulo: "Función principal", texto: "La que justifica que alguien abra la aplicación." },
          { titulo: "Función de apoyo", texto: "La que se usa una vez al mes pero se echa de menos." },
          { titulo: "Exportar", texto: "Cómo sale el trabajo de aquí en un formato útil." }
        ]
      },
      {
        tipo: "faq",
        titulo: "Dudas de uso",
        preguntas: [
          { p: "¿Hace falta instalar algo?", a: "Responde si funciona solo en el navegador o necesita algo más." },
          { p: "¿Dónde están mis datos?", a: "Di el almacenamiento real y quién puede leerlos." },
          { p: "¿Y si se cae?", a: "Explica qué se pierde y qué no." }
        ]
      },
      aviso(
        "Esta plantilla es la interfaz, no el servicio",
        "Las pantallas están escritas y funcionan en el navegador, pero no hay cuentas ni datos reales hasta que conectes una API. WebForge te deja programar esa parte en un proyecto de backend."
      )
    ]
  },
  {
    ruta: "acceso.html",
    etiqueta: "Acceso",
    descripcion: "Entrar en {proyecto}: pantalla de acceso y qué hacer si no recuerdas la contraseña.",
    secciones: [
      { tipo: "formulario", titulo: "Entrar en tu cuenta", texto: "Correo y contraseña de la cuenta que ya tengas.", campos: "sencillo" },
      {
        tipo: "lista",
        titulo: "Si no puedes entrar",
        items: [
          pr("cómo se recupera el acceso"),
          pr("quién da de alta las cuentas nuevas"),
          "El formulario de arriba no comprueba ninguna contraseña: todavía no hay servidor."
        ]
      },
      aviso(
        "Sobre las contraseñas",
        "Nunca guardes contraseñas en el navegador ni en los archivos del proyecto. El acceso real necesita un backend que las almacene con un hash, no en texto plano."
      )
    ]
  },
  {
    ruta: "ayuda.html",
    etiqueta: "Ayuda",
    descripcion: "Ayuda de {proyecto}: dudas resueltas, atajos de teclado y a quién pedir lo que no está escrito.",
    secciones: [
      {
        tipo: "faq",
        titulo: "Preguntas que se repiten",
        preguntas: [
          { p: "¿Cómo empiezo un trabajo nuevo?", a: "Describe el primer paso concreto, con el nombre del botón que se pulsa." },
          { p: "¿Se puede volver atrás?", a: "Di si hay historial de versiones y cuánto dura." },
          { p: "¿Funciona en el móvil?", a: "Sé exacto con lo que se puede hacer en pantalla pequeña." },
          { p: "¿Cómo me avisan?", a: "Explica qué notificaciones existen y cuáles no hay." }
        ]
      },
      { tipo: "lista", titulo: "Atajos de teclado", items: [pr("combinación y qué hace"), pr("combinación y qué hace"), pr("combinación y qué hace")] }
    ]
  }
];

const panel: Omit<Modelo, "paginas"> = {
  id: "panel",
  nombre: "Panel interno",
  descripcion: "Dashboard de equipo con resumen, informes y reparto de roles, avisando de dónde faltan datos.",
  incluye: ["Resumen con tarjetas", "Tabla de últimos movimientos", "Informes por periodo", "Página de equipo", "Avisos de datos pendientes", "sitemap.xml y robots.txt"],
  cta: { texto: "Ver informes", href: "informes.html" },
  portada: portadaDe("panel.svg", "Vista general del panel con las tarjetas de resumen")
};

const panelPaginas: PaginaDef[] = [
  {
    ruta: "index.html",
    etiqueta: "Panel",
    descripcion: "Panel de {proyecto}: resumen del estado, últimos movimientos y dónde se cambia cada cosa.",
    secciones: [
      hero(
        "El estado del proyecto",
        "Lo primero que se ve al entrar: cuatro números que alguien mira cada día y una tabla con lo último ocurrido en {proyecto}.",
        "Ver informes",
        "informes.html",
        portadaDe("panel.svg", "Vista general del panel con las tarjetas de resumen")
      ),
      {
        tipo: "tarjetas",
        titulo: "Resumen",
        rejilla: 4,
        elementos: [
          { titulo: "Unidades activas", texto: "Cifra sin conectar: escribe la medida y su fuente." },
          { titulo: "Trabajo de hoy", texto: "Qué entra hoy y cuánto queda por cerrar." },
          { titulo: "Incidentes abiertos", texto: "Lo que está roto y quién lo mira." },
          { titulo: "Pendiente de revisar", texto: "La cola que espera a alguien con permiso." }
        ]
      },
      {
        tipo: "tabla",
        titulo: "Últimos movimientos",
        cabecera: ["Cuándo", "Qué", "Quién", "Estado"],
        filas: [
          [`<time datetime="{fecha}">{fecha}</time>`, pr("acción"), pr("persona"), pr("estado")],
          [pr("fecha"), pr("acción"), pr("persona"), pr("estado")],
          [pr("fecha"), pr("acción"), pr("persona"), pr("estado")]
        ]
      },
      aviso(
        "Los números son de formato, no de tu negocio",
        "Un panel sin datos engaña: estas tarjetas enseñan el formato. Conecta la API que los alimente antes de enseñar este panel a nadie."
      )
    ]
  },
  {
    ruta: "informes.html",
    etiqueta: "Informes",
    descripcion: "Informes de {proyecto}: series por periodo, comparaciones y de dónde sale cada cifra.",
    secciones: [
      {
        tipo: "tabla",
        titulo: "Serie mensual",
        cabecera: ["Mes", "Medida", "Frente al mes anterior"],
        filas: [
          [pr("mes"), pr("valor"), pr("diferencia")],
          [pr("mes"), pr("valor"), pr("diferencia")],
          [pr("mes"), pr("valor"), pr("diferencia")]
        ],
        nota: "Deja escrita la fuente de cada cifra: un informe sin fuente no se defiende en una reunión."
      },
      {
        tipo: "lista",
        titulo: "Cómo se calcula",
        items: [pr("fórmula o criterio de la primera medida"), pr("criterio de la segunda"), "Qué se queda fuera del cálculo y por qué."]
      }
    ]
  },
  {
    ruta: "equipo.html",
    etiqueta: "Equipo",
    descripcion: "Equipo de {proyecto}: roles, a quién pedir cada cosa y cómo se cubren las ausencias.",
    secciones: [
      {
        tipo: "tabla",
        titulo: "Quién hace qué",
        cabecera: ["Nombre", "Rol", "Se le pide"],
        filas: [
          [pr("nombre"), pr("rol"), pr("responsabilidad")],
          [pr("nombre"), pr("rol"), pr("responsabilidad")],
          [pr("nombre"), pr("rol"), pr("responsabilidad")]
        ],
        nota: "La plantilla no inventa personas: escribe nombres y roles reales antes de publicar."
      },
      { tipo: "lista", titulo: "Cubriciones", items: [pr("quién sustituye a quién"), pr("cómo se avisa una ausencia")] }
    ]
  }
];

/* ------------------------------------------------------------------ ensamblado */

function construir(m: Modelo): Plantilla {
  const rutas = m.paginas.map((p) => p.ruta);
  return {
    id: m.id,
    nombre: m.nombre,
    descripcion: m.descripcion,
    incluye: m.incluye,
    paginas: rutas,
    archivos(nombreProyecto: string): Record<string, string> {
      const proyecto = nombreProyecto.trim() || "Mi proyecto";
      const map: Record<string, string> = {};
      const imagenes = new Map<string, Img>([[m.portada.archivo, m.portada]]);
      for (const pagina of m.paginas) {
        const generada = paginaHtml(m, pagina, proyecto);
        map[pagina.ruta] = generada.contenido;
        for (const [archivo, img] of generada.imagenes) imagenes.set(archivo, img);
      }
      map["styles.css"] = CSS;
      map["main.js"] = MAIN_JS;
      map[".webforge.json"] = fichaJson(m, proyecto);
      map["robots.txt"] = robotsTxt();
      map["sitemap.xml"] = sitemapXml(rutas);
      map["assets/favicon.svg"] = faviconSvg(proyecto);
      for (const [archivo, img] of imagenes) map[`assets/${archivo}`] = marcadorSvg(img);
      return map;
    }
  };
}

const app: Modelo = { ...aplicacion, paginas: [...aplicacionPaginas, pagina404({ texto: "Ver la ayuda", href: "ayuda.html" })] };
const panelModelo: Modelo = { ...panel, paginas: [...panelPaginas, pagina404({ texto: "Volver al panel", href: "index.html" })] };

export const PLANTILLAS: Plantilla[] = [landing, captacion, corporativa, negocioLocal, portfolio, blog, tienda, directorio, app, panelModelo].map(
  construir
);

export function plantillaPorId(id: string): Plantilla | undefined {
  return PLANTILLAS.find((p) => p.id === id);
}
