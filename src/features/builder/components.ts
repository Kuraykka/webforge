/**
 * Biblioteca de componentes del constructor visual.
 * Cada entrada produce HTML real que se escribe en el archivo; no hay un modelo
 * paralelo, así que editor y constructor siempre muestran el mismo código.
 *
 * Las clases que aparecen aquí tienen que estar definidas en la hoja de estilos que siembra
 * `templates.ts`: `components.test.ts` lo comprueba, porque un bloque sin estilo se ve suelto
 * en la página generada.
 */
import type { ReglaDeEstilo } from "./cssSource";

export type InsertSlot = "before" | "after" | "inside-end";

export interface BuilderComponent {
  id: string;
  label: string;
  /** Etiqueta corta del grupo en la paleta. «biblioteca» es la del usuario, no la sembrada. */
  group: "estructura" | "contenido" | "formulario" | "medio" | "biblioteca";
  /** Donde se coloca por defecto al insertarlo. */
  slot: InsertSlot;
  /** Plantilla con {texto} para el título o el rótulo principal. */
  html: string;
  /** Reglas que necesitan sus clases `wf-eN`: solo las de la biblioteca, el catálogo va en la hoja sembrada. */
  reglas?: ReglaDeEstilo[];
}

export const BUILDER_COMPONENTS: BuilderComponent[] = [
  {
    id: "encabezado",
    label: "Encabezado con menú",
    group: "estructura",
    slot: "before",
    html: `<header class="site-header">
  <a class="brand" href="#inicio">Mi marca</a>
  <nav class="menu" aria-label="Principal">
    <ul class="nav-list">
      <li><a class="enlace" href="#inicio">Inicio</a></li>
      <li><a class="enlace" href="#servicios">Servicios</a></li>
      <li><a class="enlace" href="#contacto">Contacto</a></li>
    </ul>
  </nav>
</header>`
  },
  {
    id: "menu",
    label: "Menú de navegación",
    group: "estructura",
    slot: "inside-end",
    html: `<nav class="menu" aria-label="Secciones">
  <ul class="nav-list">
    <li><a class="enlace" href="#inicio">Inicio</a></li>
    <li><a class="enlace" href="#servicios">Servicios</a></li>
    <li><a class="enlace" href="#contacto">Contacto</a></li>
  </ul>
</nav>`
  },
  {
    id: "hero",
    label: "Portada",
    group: "estructura",
    slot: "inside-end",
    html: `<section class="hero">
  <h1>Título que resume tu propuesta</h1>
  <p class="lead">Una frase de apoyo breve, escrita para quien llega por primera vez.</p>
  <a class="cta" href="#contacto">Solicitar información</a>
</section>`
  },
  {
    id: "seccion",
    label: "Sección",
    group: "estructura",
    slot: "after",
    html: `<section class="seccion">
  <h2>Nueva sección</h2>
  <p>Escribe aquí el texto de la sección.</p>
</section>`
  },
  {
    id: "columnas",
    label: "Dos columnas",
    group: "estructura",
    slot: "inside-end",
    html: `<div class="columnas">
  <div>
    <h3>Primera columna</h3>
    <p>Contenido de la primera columna.</p>
  </div>
  <div>
    <h3>Segunda columna</h3>
    <p>Contenido de la segunda columna.</p>
  </div>
</div>`
  },
  {
    id: "rejilla-3",
    label: "Rejilla de 3",
    group: "estructura",
    slot: "inside-end",
    html: `<div class="rejilla rejilla-3">
  <div class="rejilla-hueco">
    <h3>Primer bloque</h3>
    <p>Descripción corta.</p>
  </div>
  <div class="rejilla-hueco">
    <h3>Segundo bloque</h3>
    <p>Descripción corta.</p>
  </div>
  <div class="rejilla-hueco">
    <h3>Tercer bloque</h3>
    <p>Descripción corta.</p>
  </div>
</div>`
  },
  {
    id: "rejilla-4",
    label: "Rejilla de 4",
    group: "estructura",
    slot: "inside-end",
    html: `<div class="rejilla rejilla-4">
  <div class="rejilla-hueco">
    <h3>Primera</h3>
    <p>Descripción corta.</p>
  </div>
  <div class="rejilla-hueco">
    <h3>Segunda</h3>
    <p>Descripción corta.</p>
  </div>
  <div class="rejilla-hueco">
    <h3>Tercera</h3>
    <p>Descripción corta.</p>
  </div>
  <div class="rejilla-hueco">
    <h3>Cuarta</h3>
    <p>Descripción corta.</p>
  </div>
</div>`
  },
  {
    id: "separador",
    label: "Separador",
    group: "estructura",
    slot: "after",
    html: `<hr class="separador" />`
  },
  {
    id: "titulo",
    label: "Título",
    group: "contenido",
    slot: "inside-end",
    html: `<h2>Título nuevo</h2>`
  },
  {
    id: "parrafo",
    label: "Párrafo",
    group: "contenido",
    slot: "inside-end",
    html: `<p>Párrafo nuevo. Edítalo desde el inspector o escribiendo en el código.</p>`
  },
  {
    id: "lista",
    label: "Lista",
    group: "contenido",
    slot: "inside-end",
    html: `<ul class="lista">
  <li>Primer elemento</li>
  <li>Segundo elemento</li>
  <li>Tercer elemento</li>
</ul>`
  },
  {
    id: "tabla",
    label: "Tabla",
    group: "contenido",
    slot: "inside-end",
    html: `<table class="tabla">
  <caption>Detalle del servicio</caption>
  <thead>
    <tr>
      <th scope="col">Concepto</th>
      <th scope="col">Importe</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Diseño</td>
      <td>120 €</td>
    </tr>
    <tr>
      <td>Desarrollo</td>
      <td>480 €</td>
    </tr>
  </tbody>
</table>`
  },
  {
    id: "tarjeta",
    label: "Tarjeta",
    group: "contenido",
    slot: "inside-end",
    html: `<article class="tarjeta">
  <h3>Tarjeta</h3>
  <p>Descripción breve del contenido.</p>
  <a class="enlace" href="#contacto">Ver más</a>
</article>`
  },
  {
    id: "cita",
    label: "Cita",
    group: "contenido",
    slot: "inside-end",
    html: `<blockquote class="cita">
  <p>Frase destacada.</p>
  <footer>— Autor</footer>
</blockquote>`
  },
  {
    id: "boton",
    label: "Botón",
    group: "contenido",
    slot: "inside-end",
    html: `<a class="boton" href="#contacto">Acción principal</a>`
  },
  {
    id: "enlace",
    label: "Enlace",
    group: "contenido",
    slot: "inside-end",
    html: `<a class="enlace" href="#contacto">Enlace a otra sección</a>`
  },
  {
    id: "modal",
    label: "Diálogo modal",
    group: "contenido",
    slot: "inside-end",
    // Sin ids: el guion se busca a sí mismo, así que se pueden insertar dos diálogos seguidos.
    html: `<div class="modal-bloque">
  <button type="button" class="boton">Abrir diálogo</button>
  <dialog class="modal" aria-label="Diálogo de ejemplo">
    <h2>Título del diálogo</h2>
    <p>Contenido que aparece por encima de la página.</p>
    <form method="dialog">
      <button type="submit" class="boton">Cerrar</button>
    </form>
  </dialog>
  <script>
    (function (bloque) {
      var boton = bloque.querySelector("button");
      var caja = bloque.querySelector("dialog");
      if (boton && caja) boton.addEventListener("click", function () { caja.showModal(); });
    })(document.currentScript.parentNode);
  </script>
</div>`
  },
  {
    id: "imagen",
    label: "Imagen",
    group: "medio",
    slot: "inside-end",
    html: `<figure class="figura">
  <img src="assets/imagen.svg" alt="Descripción de la imagen" width="640" height="360" />
  <figcaption>Pie de imagen</figcaption>
</figure>`
  },
  {
    id: "icono",
    label: "Icono SVG",
    group: "medio",
    slot: "inside-end",
    html: `<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false">
  <path d="M4 12h16M12 4v16" stroke-linecap="round" />
</svg>`
  },
  {
    id: "video",
    label: "Vídeo",
    group: "medio",
    slot: "inside-end",
    html: `<video class="video" controls preload="metadata" width="640" height="360" poster="assets/poster.jpg">
  <source src="assets/video.mp4" type="video/mp4" />
  Tu navegador no admite vídeo incrustado.
</video>`
  },
  {
    id: "formulario",
    label: "Formulario de contacto",
    group: "formulario",
    slot: "inside-end",
    html: `<form class="formulario" id="formulario-nuevo">
  <label for="nombre-nuevo">Nombre</label>
  <input id="nombre-nuevo" name="nombre" type="text" required />
  <label for="mensaje-nuevo">Mensaje</label>
  <textarea id="mensaje-nuevo" name="mensaje" rows="4" required></textarea>
  <button type="submit">Enviar</button>
  <p class="estado-formulario" role="status"></p>
</form>`
  },
  {
    id: "campo",
    label: "Campo de formulario",
    group: "formulario",
    slot: "inside-end",
    html: `<label for="campo-nuevo">Etiqueta</label>
<input id="campo-nuevo" name="campo" type="text" />`
  }
];

export function componentById(id: string): BuilderComponent | undefined {
  return BUILDER_COMPONENTS.find((component) => component.id === id);
}

export const COMPONENT_GROUPS: BuilderComponent["group"][] = ["estructura", "contenido", "formulario", "medio"];
