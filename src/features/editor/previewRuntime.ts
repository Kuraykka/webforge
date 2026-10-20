/**
 * Script inyectado en la vista previa. Se ejecuta dentro de un iframe con
 * `sandbox="allow-scripts allow-forms"`: origen opaco, sin acceso al DOM, cookies
 * ni almacenamiento de la plataforma. `allow-forms` solo abre la puerta al evento
 * `submit` para que el JS de la página funcione; la navegación la corta este propio
 * guión. La única comunicación es postMessage con datos mínimos (ruta y texto).
 */
import { TEXT_ONLY_TAGS } from "../builder/htmlSource";

/** La paleta de inserciones y el golpe del ratón usan la misma lista de elementos de solo texto. */
const SOLO_TEXTO = JSON.stringify([...TEXT_ONLY_TAGS]);

export const PREVIEW_RUNTIME = `
(function () {
  var SELECCION = "wf-seleccionado";
  var REFERENCIA = "wf-referencia";
  var ANTES = "wf-antes";
  var DESPUES = "wf-despues";
  var DENTRO = "wf-dentro";
  var MARCAS = [ANTES, DESPUES, DENTRO];
  var MAX = 240;
  var editando = null;

  // Dentro de un título o un enlace no cabe un bloque: el hueco central sube al contenedor
  // más cercano que sí admite hijos de bloque, que es donde la inserción tiene sentido.
  var SOLO_TEXTO = ${SOLO_TEXTO};

  function corte(valor) {
    var texto = String(valor == null ? "" : valor);
    return texto.length > MAX ? texto.slice(0, MAX) + "…" : texto;
  }

  function enviar(msg) {
    msg.wf = true;
    try { parent.postMessage(msg, "*"); } catch (error) {}
  }

  function conRuta(nodo) {
    var actual = nodo;
    while (actual && actual.getAttribute) {
      var path = actual.getAttribute("data-wf-path");
      if (path !== null) return { element: actual, path: path };
      actual = actual.parentElement;
    }
    return null;
  }

  function describir(elemento, path) {
    var clases = typeof elemento.className === "string"
      ? elemento.className.trim().split(/\\s+/).filter(function (c) { return c.indexOf("wf-") !== 0; })
      : [];
    var atributos = [];
    Array.prototype.forEach.call(elemento.attributes, function (atributo) {
      if (atributo.name !== "data-wf-path") atributos.push({ name: atributo.name, value: corte(atributo.value) });
    });
    return {
      path: path,
      tag: elemento.tagName.toLowerCase(),
      descriptor: corte(elemento.tagName.toLowerCase() + (elemento.id ? "#" + elemento.id : "") + (clases.length ? "." + clases.slice(0, 3).join(".") : "")),
      text: corte((elemento.textContent || "").trim()),
      attributes: atributos,
      classes: clases
    };
  }

  function limpiar(clase) {
    Array.prototype.forEach.call(document.querySelectorAll("." + clase), function (nodo) {
      nodo.classList.remove(clase);
    });
  }

  function terminarEdicion(commit) {
    if (!editando) return;
    var destino = editando;
    editando = null;
    destino.contentEditable = "false";
    destino.removeEventListener("blur", onBlurring);
    destino.removeEventListener("keydown", onKeyDowning);
    destino.removeEventListener("paste", onPasting);
    if (commit) enviar({ type: "wf:edit-commit", path: destino.getAttribute("data-wf-path"), text: destino.textContent });
  }

  function onBlurring() { terminarEdicion(true); }

  function onKeyDowning(evento) {
    if (evento.key === "Escape") { evento.preventDefault(); terminarEdicion(false); }
    if (evento.key === "Enter" && !evento.shiftKey) { evento.preventDefault(); terminarEdicion(true); }
  }

  function onPasting(evento) {
    evento.preventDefault();
    var texto = (evento.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, String(texto || ""));
  }

  function editar(elemento, path) {
    terminarEdicion(true);
    if (elemento.children.length > 0) {
      enviar({ type: "wf:blocked", path: path, reason: "El elemento tiene hijos; edita su texto desde el editor de código." });
      return;
    }
    editando = elemento;
    elemento.setAttribute("data-wf-path", path);
    elemento.contentEditable = "true";
    elemento.focus();
    elemento.addEventListener("blur", onBlurring);
    elemento.addEventListener("keydown", onKeyDowning);
    elemento.addEventListener("paste", onPasting);
  }

  document.addEventListener("click", function (event) {
    if (!window.__wfBuilder) return;
    var encontrado = conRuta(event.target);
    if (!encontrado) return;
    if (editando && editando === encontrado.element) return;
    event.preventDefault();
    event.stopPropagation();
    terminarEdicion(true);
    limpiar(SELECCION);
    encontrado.element.classList.add(SELECCION);
    enviar({ type: "wf:select", path: encontrado.path, detalle: describir(encontrado.element, encontrado.path) });
  }, true);

  document.addEventListener("dblclick", function (event) {
    if (!window.__wfBuilder) return;
    var encontrado = conRuta(event.target);
    if (!encontrado) return;
    event.preventDefault();
    event.stopPropagation();
    editar(encontrado.element, encontrado.path);
  }, true);

  /**
   * Elemento bajo un punto del viewport del iframe. El navegador lo resuelve con el hit-test
   * real; jsdom no lo implementa, y entonces se recorre el documento: en orden de documento el
   * último que envuelve el punto es el más profundo.
   */
  function bajoElPunto(x, y) {
    if (typeof document.elementFromPoint === "function") {
      var tocado = document.elementFromPoint(x, y);
      if (tocado) return tocado;
    }
    var encontrado = null;
    Array.prototype.forEach.call(document.querySelectorAll("[data-wf-path]"), function (nodo) {
      if (!nodo.getBoundingClientRect) return;
      var caja = nodo.getBoundingClientRect();
      if (caja.width <= 0 || caja.height <= 0) return;
      if (x < caja.left || x > caja.right || y < caja.top || y > caja.bottom) return;
      encontrado = nodo;
    });
    return encontrado;
  }

  /**
   * Destino del arrastre: el elemento con ruta bajo el punto y el hueco que marca su franja
   * (arriba antes, abajo después, en medio dentro). Lo pregunta el escudo de la plataforma,
   * que cubre la vista previa mientras dura el arrastre; el iframe no ve eventos de arrastre.
   * Sin geometría (un recuadro sin alto) el hueco central es la lectura sensata.
   */
  function destino(x, y) {
    var tocado = bajoElPunto(x, y);
    var encontrado = tocado ? conRuta(tocado) : null;
    if (!encontrado) return null;
    var elemento = encontrado.element;
    var path = encontrado.path;
    var slot = "inside-end";
    var caja = elemento.getBoundingClientRect ? elemento.getBoundingClientRect() : null;
    var alto = caja ? caja.height : 0;
    if (alto > 0) {
      var proporcion = (y - caja.top) / alto;
      if (proporcion < 0.25) slot = "before";
      else if (proporcion > 0.75) slot = "after";
    }
    if (slot === "inside-end" && SOLO_TEXTO.indexOf(elemento.tagName.toLowerCase()) !== -1) {
      var subido = conRuta(elemento.parentElement);
      if (subido) {
        elemento = subido.element;
        path = subido.path;
      }
    }
    return { element: elemento, path: path, slot: slot };
  }

  function quitarMarcas() {
    MARCAS.forEach(limpiar);
  }

  function senalaDestino(x, y) {
    // Las marcas se quitan aunque no haya destino: el puntero puede haber salido del recorrido.
    quitarMarcas();
    var d = destino(x, y);
    if (!d) {
      enviar({ type: "wf:hit", path: null, slot: null });
      return;
    }
    var marca = d.slot === "before" ? ANTES : d.slot === "after" ? DESPUES : DENTRO;
    d.element.classList.add(marca);
    enviar({ type: "wf:hit", path: d.path, slot: d.slot });
  }

  window.addEventListener("error", function (event) {
    enviar({
      type: "wf:console",
      level: "error",
      message: corte(event.message || "Error en la vista previa"),
      origen: corte(event.filename || "vista previa"),
      linea: event.lineno || 0
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    enviar({
      type: "wf:console",
      level: "error",
      message: "Promesa rechazada: " + corte(event.reason),
      origen: "vista previa",
      linea: 0
    });
  });

  // Los enlaces y formularios resolverían contra la URL de la plataforma y sacarían
  // el iframe del documento de la vista previa. Se interceptan en la burbuja, después
  // de que el código de la página haya podido gestionarlos él mismo.
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;
    var objetivo = event.target;
    if (!objetivo || !objetivo.closest) return;
    var enlace = objetivo.closest("a[href], area[href]");
    if (!enlace) return;
    var destino = enlace.getAttribute("href") || "";
    if (destino.charAt(0) === "#") {
      // Un salto de ancla recargaría el iframe sobre la URL de la plataforma: se desplaza
      // el objetivo a mano y el documento de la vista previa no se mueve.
      event.preventDefault();
      try {
        var meta = destino.length > 1 ? document.getElementById(decodeURIComponent(destino.slice(1))) : document.body;
        if (meta && meta.scrollIntoView) meta.scrollIntoView({ block: "start" });
      } catch (error) {}
      return;
    }
    event.preventDefault();
    enviar({ type: "wf:blocked", reason: "La vista previa no carga otras direcciones: " + corte(destino) + "." });
  });

  // method="dialog" no navega: cierra el diálogo que contiene el formulario. Bloquearlo
  // rompería los modales que escribe el constructor, así que ahí se deja pasar el acto nativo.
  function esDeDialogo(form) {
    return form && String(form.getAttribute("method") || "").toLowerCase() === "dialog";
  }

  document.addEventListener("submit", function (event) {
    if (event.defaultPrevented) return;
    if (esDeDialogo(event.target)) return;
    event.preventDefault();
    enviar({ type: "wf:blocked", reason: "La vista previa no envía formularios; el backend real llega en la Fase 6." });
  });

  // Con allow-forms el evento submit sí llega al script de la página, pero
  // submit() salta ese evento y navegaría el iframe: se anula sin llamar al nativo.
  HTMLFormElement.prototype.submit = function () {
    if (esDeDialogo(this)) {
      var caja = this.closest ? this.closest("dialog") : null;
      if (caja && caja.close) caja.close();
      return;
    }
    enviar({ type: "wf:blocked", reason: "La vista previa no envía formularios; el backend real llega en la Fase 6." });
  };

  ["log", "info", "warn", "error"].forEach(function (nivel) {
    var original = console[nivel];
    console[nivel] = function () {
      var argumentos = Array.prototype.slice.call(arguments);
      enviar({ type: "wf:console", level: nivel, message: argumentos.map(corte).join(" "), origen: "vista previa", linea: 0 });
      if (original) original.apply(console, argumentos);
    };
  });

  window.addEventListener("message", function (event) {
    var datos = event.data;
    if (!datos || datos.wf !== true || typeof datos.type !== "string") return;
    if (datos.type === "wf:hit") {
      // Lo pide el escudo de arrastre con un punto del viewport del iframe. Fuera del
      // constructor no se responde ni se marca nada: la vista previa se comporta como página normal.
      if (!window.__wfBuilder) return;
      senalaDestino(Number(datos.x) || 0, Number(datos.y) || 0);
      return;
    }
    if (datos.type === "wf:desmarcar") {
      quitarMarcas();
      return;
    }
    var selector = '[data-wf-path="' + (window.CSS && CSS.escape ? CSS.escape(datos.path) : datos.path) + '"]';
    var nodo = typeof datos.path === "string" ? document.querySelector(selector) : null;
    if (datos.type === "wf:focus") {
      // El clic que acompaña al doble clic devuelve su propia selección: si el destino es
      // el elemento que ya se está editando, el eco no debe cerrar la edición en curso.
      if (!editando || editando.getAttribute("data-wf-path") !== datos.path) terminarEdicion(true);
      limpiar(SELECCION);
      if (nodo) {
        nodo.classList.add(SELECCION);
        if (nodo.scrollIntoView) nodo.scrollIntoView({ block: "nearest" });
      }
    }
    if (datos.type === "wf:reference") {
      limpiar(REFERENCIA);
      if (nodo) nodo.classList.add(REFERENCIA);
    }
    if (datos.type === "wf:clear") {
      terminarEdicion(true);
      limpiar(SELECCION);
      limpiar(REFERENCIA);
    }
  });

  var estilos = document.createElement("style");
  estilos.textContent =
    ".wf-seleccionado{outline:2px solid #2563eb;outline-offset:2px}" +
    ".wf-referencia{outline:1px dashed #d97706;outline-offset:1px}" +
    ".wf-antes{box-shadow:0 -3px 0 0 #16a34a}" +
    ".wf-despues{box-shadow:0 3px 0 0 #16a34a}" +
    ".wf-dentro{outline:2px dashed #16a34a;outline-offset:-2px;background:rgba(22,163,74,.10)}" +
    "[contenteditable=\\"true\\"]{outline:2px solid #16a34a;outline-offset:2px}";
  (document.head || document.documentElement).appendChild(estilos);
  enviar({ type: "wf:ready" });
})();
`;
