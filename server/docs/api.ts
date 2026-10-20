/**
 * Documentación de la API generada desde las rutas que el servidor registra de verdad. La tabla de
 * abajo es la única fuente de prosa; la lista de rutas la da Fastify, y una prueba falla si las dos
 * listas dejan de coincidir: así no puede quedar un endpoint sin documentar ni documentarse uno que
 * no existe.
 */

export interface RutaApi {
  method: string;
  url: string;
}

export type Acceso = "pública" | "sesión" | "dueño" | "administración";

export type TipoCampo = "texto" | "entero" | "booleano" | "lista" | "mapa" | "registro" | "binario";

export interface Campo {
  nombre: string;
  tipo: TipoCampo;
  descripcion: string;
  requerido?: boolean;
}

export interface DocDeFin {
  resumen: string;
  detalle: string;
  acceso: Acceso;
  /** Estado HTTP de la respuesta buena. Sin él, 200. */
  estado?: string;
  cuerpo?: Campo[];
  /** El tipo de `Content-Type` del cuerpo cuando no es JSON. */
  content?: string;
  consulta?: Campo[];
  exito: string;
}

export interface ParametroDoc {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Record<string, unknown>;
  description: string;
}

/** Lo que el documento dice de una operación. `x-` son las etiquetas propias de WebForge. */
export interface OperacionDoc {
  summary: string;
  description: string;
  operationId: string;
  tags: string[];
  security: Record<string, string[]>[];
  "x-acceso": string;
  "x-sin-documentar"?: boolean;
  parameters: ParametroDoc[];
  requestBody?: { required: boolean; content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<string, { description: string }>;
}

export interface DocumentoApi {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  components: { securitySchemes: Record<string, { type: string; in: string; name: string; description: string }> };
  paths: Record<string, Record<string, OperacionDoc>>;
}

const TEXTO = (nombre: string, descripcion: string, requerido = false): Campo => ({ nombre, tipo: "texto", descripcion, ...(requerido ? { requerido } : {}) });

export const FINES: Record<string, DocDeFin> = {
  "GET /api/health": {
    resumen: "Estado del proceso",
    detalle: "Dice si la API responde. No toca la base de datos ni revela configuración.",
    acceso: "pública",
    exito: "Objeto `status: \"ok\"`."
  },
  "GET /api/docs/openapi": {
    resumen: "Este documento",
    detalle: "La API en OpenAPI 3.1, construida sobre las rutas registradas en el propio proceso.",
    acceso: "pública",
    exito: "Documento OpenAPI con un `paths` por endpoint."
  },

  "GET /api/auth/config": {
    resumen: "Si se puede crear una cuenta",
    detalle: "Lo decide la administración en `PATCH /api/admin/settings`; el valor de arranque es solo la semilla.",
    acceso: "pública",
    exito: "`registrationAllowed` verdadero o falso."
  },
  "POST /api/auth/register": {
    resumen: "Alta de cuenta",
    detalle: "Crea la cuenta y encola el correo de verificación, pero no abre sesión: sin confirmar el correo la cuenta no entra. El enlace caduca a los tres minutos. Sin proveedor de correo configurado el mensaje se queda en el outbox del servidor.",
    acceso: "pública",
    estado: "201",
    cuerpo: [TEXTO("email", "correo de la cuenta", true), TEXTO("password", "contraseña: se guarda como hash argon2id, nunca en claro", true)],
    exito: "`user` con el identificador, correo y rol, y `verificationRequired: true`."
  },
  "POST /api/auth/login": {
    resumen: "Iniciar sesión",
    detalle: "Comprueba la contraseña y abre una sesión con cookie firmada `httpOnly`. Si falta verificar el correo responde 403 con `verificationRequired`. Tres intentos fallidos cierran la cuenta 24 horas (429 con `retry-after`); el restablecimiento de contraseña o la administración levantan el bloqueo.",
    acceso: "pública",
    cuerpo: [TEXTO("email", "correo de la cuenta", true), TEXTO("password", "contraseña", true)],
    exito: "`user` y cookie de sesión en la respuesta."
  },
  "POST /api/auth/login/2fa": {
    resumen: "Segundo factor del acceso",
    detalle: "Con TOTP confirmado, el acceso por contraseña devuelve `twoFactorRequired` y un desafío de cinco minutos. Aquí se entrega el código de la aplicación o uno de recuperación; el desafío se consume en el primer intento.",
    acceso: "pública",
    cuerpo: [TEXTO("challenge", "desafío devuelto por el acceso", true), TEXTO("code", "código TOTP o de recuperación", true)],
    exito: "`user` y cookie de sesión."
  },
  "GET /api/auth/2fa": {
    resumen: "Estado del segundo factor",
    detalle: "Dice si hay TOTP confirmado, si hay uno pendiente y cuántos códigos de recuperación quedan.",
    acceso: "sesión",
    exito: "`twoFactor` con `enabled`, `pending` y `recoveryCodes`."
  },
  "POST /api/auth/2fa/setup": {
    resumen: "Empezar la configuración de TOTP",
    detalle: "Genera un secreto nuevo y lo deja pendiente. Devuelve el secreto y la URI `otpauth://` para la aplicación de autenticación; no se activa hasta confirmar un código.",
    acceso: "sesión",
    exito: "`secret` y `otpauth`."
  },
  "POST /api/auth/2fa/confirm": {
    resumen: "Confirmar el segundo factor",
    detalle: "Verifica un código del secreto pendiente, lo activa y devuelve ocho códigos de recuperación de un solo uso (solo se enseñan aquí).",
    acceso: "sesión",
    cuerpo: [TEXTO("code", "código de 6 dígitos", true)],
    exito: "`enabled` y `recoveryCodes`."
  },
  "POST /api/auth/2fa/disable": {
    resumen: "Desactivar el segundo factor",
    detalle: "Exige la contraseña y un código vigente (o de recuperación): nadie desactiva el 2FA solo con una sesión robada.",
    acceso: "sesión",
    estado: "204",
    cuerpo: [TEXTO("password", "contraseña actual", true), TEXTO("code", "código vigente o de recuperación", true)],
    exito: "Respuesta vacía."
  },
  "POST /api/auth/logout": {
    resumen: "Cerrar la sesión actual",
    detalle: "Revoca la fila de sesión y borra la cookie.",
    acceso: "sesión",
    estado: "204",
    exito: "Respuesta vacía."
  },
  "GET /api/auth/session": {
    resumen: "Quién es la sesión",
    detalle: "La sesión que autoriza la petición y las sesiones abiertas de la cuenta.",
    acceso: "sesión",
    exito: "`user` y `sessions`, marcando cuál es la actual."
  },
  "GET /api/auth/sessions": {
    resumen: "Sesiones abiertas de la cuenta",
    detalle: "Sirve para cerrar sesiones ajenas desde Ajustes.",
    acceso: "sesión",
    exito: "`sessions` con dispositivo, ip relativa y último uso."
  },
  "POST /api/auth/sessions/revoke": {
    resumen: "Cerrar una sesión concreta",
    detalle: "Solo cierra sesiones de la cuenta que pregunta.",
    acceso: "sesión",
    cuerpo: [TEXTO("id", "identificador de la sesión", true)],
    exito: "`revoked` con el id cerrado."
  },
  "POST /api/auth/password": {
    resumen: "Cambiar la contraseña",
    detalle: "Pide la actual y cierra las demás sesiones al cambiarla.",
    acceso: "sesión",
    cuerpo: [TEXTO("currentPassword", "contraseña actual", true), TEXTO("newPassword", "contraseña nueva", true)],
    exito: "`changed` y cuántas sesiones se cerraron."
  },
  "POST /api/auth/password/reset": {
    resumen: "Pedir un enlace de restablecimiento",
    detalle: "Encola el correo si la cuenta existe. La respuesta es siempre la misma para no revelar qué correos tienen cuenta.",
    acceso: "pública",
    estado: "202",
    cuerpo: [TEXTO("email", "correo de la cuenta", true)],
    exito: "`accepted: true`."
  },
  "POST /api/auth/password/reset/confirm": {
    resumen: "Usar el enlace de restablecimiento",
    detalle: "El token caduca en 30 minutos y solo funciona una vez. Al usarlo se cierran todas las sesiones y se levanta el bloqueo de intentos fallidos, porque el enlace demuestra el control del buzón.",
    acceso: "pública",
    estado: "204",
    cuerpo: [TEXTO("token", "token del enlace", true), TEXTO("newPassword", "contraseña nueva", true)],
    exito: "Respuesta vacía."
  },
  "POST /api/auth/verify-email": {
    resumen: "Confirmar el correo",
    detalle: "Consume el token de verificación y marca la cuenta como confirmada. Sin proveedor de correo el enlace vive en el outbox del servidor.",
    acceso: "pública",
    estado: "204",
    cuerpo: [TEXTO("token", "token del enlace de verificación", true)],
    exito: "Respuesta vacía."
  },
  "POST /api/auth/verify-email/resend": {
    resumen: "Pedir otro enlace de verificación",
    detalle: "El enlace de tres minutos caduca solo. Si aún hay uno vivo o la cuenta ya está verificada no se encola nada, y si el correo no tiene cuenta tampoco: la respuesta es siempre la misma.",
    acceso: "pública",
    estado: "202",
    cuerpo: [TEXTO("email", "correo de la cuenta", true)],
    exito: "`accepted: true`."
  },

  "GET /api/account/usage": {
    resumen: "Uso y límites de la cuenta",
    detalle: "Los números los decide el servidor: proyectos, archivos, bytes y lo que la administración permita.",
    acceso: "sesión",
    exito: "`usage` y `limits`."
  },

  "GET /api/search": {
    resumen: "Buscar en los archivos de la cuenta",
    detalle: "Solo lectura: devuelve rutas y un fragmento alrededor de la coincidencia, nunca el archivo completo.",
    acceso: "sesión",
    consulta: [TEXTO("q", "texto a buscar; vacío devuelve lo reciente")],
    exito: "Coincidencias agrupadas por proyecto."
  },

  "GET /api/projects": {
    resumen: "Listar los proyectos",
    detalle: "Los proyectos de la cuenta, sin los borrados.",
    acceso: "dueño",
    exito: "`projects` con nombre, carpeta, etiquetas, pila, estado y fechas."
  },
  "POST /api/projects": {
    resumen: "Crear un proyecto",
    detalle: "Puede nacer con archivos. Se comprueba el cupo de proyectos de la cuenta antes de insertar nada.",
    acceso: "dueño",
    estado: "201",
    cuerpo: [
      TEXTO("name", "nombre visible", true),
      TEXTO("stack", "static, react, vue, svelte o astro", true),
      TEXTO("description", "descripción corta"),
      TEXTO("folder", "carpeta del espacio de trabajo"),
      { nombre: "tags", tipo: "lista", descripcion: "etiquetas propias" },
      { nombre: "files", tipo: "mapa", descripcion: "ruta de archivo → contenido inicial" }
    ],
    exito: "`project` creado."
  },
  "GET /api/projects/:id": {
    resumen: "Ficha de un proyecto",
    detalle: "Un proyecto de la cuenta. Lo de otra cuenta es un 404, no un 403.",
    acceso: "dueño",
    exito: "`project`."
  },
  "PATCH /api/projects/:id": {
    resumen: "Cambiar la ficha",
    detalle: "Cambia solo los campos que llegan y anota en el historial lo que varió.",
    acceso: "dueño",
    cuerpo: [
      TEXTO("name", "nombre visible"),
      TEXTO("description", "descripción corta"),
      TEXTO("folder", "carpeta del espacio de trabajo"),
      TEXTO("stack", "pila del proyecto"),
      TEXTO("status", "borrador, en_desarrollo o listo"),
      { nombre: "tags", tipo: "lista", descripcion: "etiquetas propias" }
    ],
    exito: "`project` actualizado."
  },
  "DELETE /api/projects/:id": {
    resumen: "Eliminar un proyecto",
    detalle: "Se lleva sus archivos, versiones, variables, ejecuciones e historial.",
    acceso: "dueño",
    estado: "204",
    exito: "Respuesta vacía."
  },
  "GET /api/projects/:id/history": {
    resumen: "Actividad del proyecto",
    detalle: "Lo que pasó en el proyecto: cambios de ficha, exportaciones, ejecuciones y valores consultados.",
    acceso: "dueño",
    exito: "`history` de la más nueva a la más antigua."
  },
  "POST /api/projects/:id/duplicate": {
    resumen: "Duplicar un proyecto",
    detalle: "Copia la ficha y todos los archivos a un proyecto nuevo de la cuenta. También gasta cupo.",
    acceso: "dueño",
    estado: "201",
    exito: "`project` de la copia."
  },
  "GET /api/projects/:id/export": {
    resumen: "Descargar el proyecto en ZIP",
    detalle: "Los archivos tal cual más una ficha con sus datos. Anota la exportación en el historial.",
    acceso: "dueño",
    exito: "Binario `application/zip` con `content-disposition`."
  },
  "POST /api/projects/import": {
    resumen: "Crear un proyecto desde un ZIP",
    detalle: "Acepta el archivo exportado aquí mismo. El cuerpo entra crudo, con su propio tope de tamaño.",
    acceso: "dueño",
    estado: "201",
    content: "application/zip",
    cuerpo: [{ nombre: "archivo", tipo: "binario", descripcion: "ZIP exportado por la plataforma", requerido: true }],
    exito: "`project` nuevo, propiedad de quien lo sube."
  },

  "GET /api/projects/:id/files": {
    resumen: "Listar los archivos",
    detalle: "Rutas, tamaño y fecha; el contenido se pide archivo por archivo.",
    acceso: "dueño",
    exito: "`files`."
  },
  "GET /api/projects/:id/files/content": {
    resumen: "Leer un archivo",
    detalle: "El contenido tal como está guardado.",
    acceso: "dueño",
    consulta: [TEXTO("path", "ruta del archivo dentro del proyecto", true)],
    exito: "`file` con `path` y `content`."
  },
  "POST /api/projects/:id/files": {
    resumen: "Crear un archivo",
    detalle: "La ruta debe ser válida y no puede existir ya. Fuera del proyecto no se escribe: un `../` es un 400.",
    acceso: "dueño",
    estado: "201",
    cuerpo: [TEXTO("path", "ruta dentro del proyecto", true), TEXTO("content", "contenido inicial; vacío si no se manda")],
    exito: "`file` creado."
  },
  "PUT /api/projects/:id/files/content": {
    resumen: "Escribir un archivo",
    detalle: "Sobrescribe el contenido. Es lo que usa el autoguardado del editor.",
    acceso: "dueño",
    consulta: [TEXTO("path", "ruta del archivo", true)],
    cuerpo: [TEXTO("content", "contenido completo", true)],
    exito: "`file` actualizado."
  },
  "PATCH /api/projects/:id/files": {
    resumen: "Renombrar o mover un archivo",
    detalle: "Cambia la ruta, no el contenido. El destino tampoco puede existir ni salir del proyecto.",
    acceso: "dueño",
    cuerpo: [TEXTO("from", "ruta actual", true), TEXTO("to", "ruta nueva", true)],
    exito: "`file` con su ruta nueva."
  },
  "DELETE /api/projects/:id/files": {
    resumen: "Borrar un archivo",
    detalle: "Baja el archivo del proyecto.",
    acceso: "dueño",
    estado: "204",
    consulta: [TEXTO("path", "ruta del archivo", true)],
    exito: "Respuesta vacía."
  },

  "GET /api/projects/:id/versions": {
    resumen: "Listar las versiones",
    detalle: "Resúmenes con cuántos archivos y bytes guarda cada una.",
    acceso: "dueño",
    exito: "`versions`."
  },
  "POST /api/projects/:id/versions": {
    resumen: "Guardar una versión",
    detalle: "Guarda el estado completo del proyecto con su etiqueta.",
    acceso: "dueño",
    estado: "201",
    cuerpo: [TEXTO("label", "nombre de la versión")],
    exito: "`version` guardada."
  },
  "GET /api/projects/:id/versions/:versionId": {
    resumen: "Leer una versión",
    detalle: "Devuelve el contenido de todos sus archivos para poder compararlo.",
    acceso: "dueño",
    exito: "`version` con `content`."
  },
  "DELETE /api/projects/:id/versions/:versionId": {
    resumen: "Descartar una versión",
    detalle: "Baja la versión guardada.",
    acceso: "dueño",
    estado: "204",
    exito: "Respuesta vacía."
  },
  "POST /api/projects/:id/versions/:versionId/restore": {
    resumen: "Recuperar una versión",
    detalle: "Antes de escribir lo viejo guarda lo actual como versión de seguridad, para que recuperar nunca sea irreversible.",
    acceso: "dueño",
    exito: "`restored` y la versión `safety` creada."
  },

  "GET /api/projects/:id/env": {
    resumen: "Listar las variables de un entorno",
    detalle: "Nunca devuelve valores: ver uno es una acción explícita y queda en el historial.",
    acceso: "dueño",
    consulta: [TEXTO("environment", "desarrollo, produccion o prueba", true)],
    exito: "`variables` con nombre, entorno y fecha."
  },
  "PUT /api/projects/:id/env": {
    resumen: "Guardar una variable",
    detalle: "Crea o sustituye la clave del entorno. El valor se cifra al almacenarlo en la Fase 9; hoy se guarda sin cifrar y por eso no se recomiendan secretos reales.",
    acceso: "dueño",
    cuerpo: [
      TEXTO("environment", "desarrollo, produccion o prueba", true),
      TEXTO("key", "nombre de la variable", true),
      TEXTO("value", "contenido; admite el texto vacío", true)
    ],
    exito: "`variable` sin su valor."
  },
  "POST /api/projects/:id/env/:variableId/reveal": {
    resumen: "Ver el valor de una variable",
    detalle: "Es una mutación: exige la cabecera de la aplicación y anota qué clave se miró, nunca lo que valía.",
    acceso: "dueño",
    exito: "`variable` con el valor."
  },
  "DELETE /api/projects/:id/env/:variableId": {
    resumen: "Borrar una variable",
    detalle: "Deja de existir para las ejecuciones que la pedían.",
    acceso: "dueño",
    estado: "204",
    exito: "Respuesta vacía."
  },

  "GET /api/projects/:id/seo": {
    resumen: "Ajustes de SEO del proyecto",
    detalle: "Dominio, plantilla de título, descripción, idioma, imagen social, tipo de Schema.org y qué se publica en robots.txt. Sin fila guardada devuelve los valores de partida con `updatedAt: null`.",
    acceso: "dueño",
    exito: "`seo` con los ajustes del proyecto."
  },
  "PUT /api/projects/:id/seo": {
    resumen: "Guardar los ajustes de SEO",
    detalle: "Se aplica lo que llega sobre lo anterior. El dominio es un origen https sin ruta, la plantilla de título lleva `%s`, la descripción no pasa de 160 caracteres y robots no admite etiquetas. Un sitemap exige dominio, y cada guardado queda en el historial del proyecto.",
    acceso: "dueño",
    cuerpo: [
      TEXTO("siteUrl", "origen https del sitio, sin ruta"),
      TEXTO("titleTemplate", "plantilla con %s para el título de cada página"),
      TEXTO("description", "descripción de hasta 160 caracteres"),
      TEXTO("language", "código BCP 47, por ejemplo es-ES"),
      TEXTO("ogImage", "ruta del sitio (/og.png) o URL https"),
      TEXTO("schemaType", "WebSite, Organization, LocalBusiness, Store, Restaurant o ProfessionalService"),
      { nombre: "noindex", tipo: "booleano", descripcion: "pedir a los buscadores que no indexen el sitio" },
      { nombre: "sitemap", tipo: "booleano", descripcion: "publicar sitemap.xml; exige dominio" },
      TEXTO("robotsExtra", "directivas extra para robots.txt")
    ],
    exito: "`seo` con lo guardado y su fecha."
  },
  "POST /api/projects/:id/seo/generar": {
    resumen: "Escribir los archivos de SEO",
    detalle: "Genera el bloque de cabecera (título, descripción, canonical, Open Graph, Twitter y JSON-LD) en cada página HTML y escribe sitemap.xml y robots.txt cuando los ajustes lo permiten. Reemplaza su propio bloque marcado, nunca el resto de la página, y deja el cambio en el historial.",
    acceso: "dueño",
    exito: "`generated` con los archivos escritos y cuántas páginas se tocaron."
  },
  "GET /api/projects/:id/seo/analisis": {
    resumen: "Auditoría estática de SEO",
    detalle: "Lee los archivos del proyecto y revisa títulos, descripciones, encabezados, enlaces internos, imágenes, JSON-LD y peso. Son señales calculadas sobre el código: no es una medición de campo ni Lighthouse, y el informe no promete posiciones en Google.",
    acceso: "dueño",
    exito: "`analisis` con páginas, problemas por nivel, duplicados, enlaces rotos y pesos."
  },
  "GET /api/projects/:id/analitica": {
    resumen: "Configuración de analítica del proyecto",
    detalle: "Solo GA4, y solo se carga con consentimiento explícito del visitante. Sin fila guardada devuelve la analítica apagada.",
    acceso: "dueño",
    exito: "`analytics` con el identificador, los interruptores y las páginas de agradecimiento."
  },
  "PUT /api/projects/:id/analitica": {
    resumen: "Guardar la analítica",
    detalle: "El identificador de medición es el de GA4 (G-…). Activarla lo exige; las rutas de agradecimiento son rutas del propio sitio.",
    acceso: "dueño",
    cuerpo: [
      { nombre: "enabled", tipo: "booleano", descripcion: "activar la analítica" },
      TEXTO("measurementId", "identificador de medición G-…"),
      { nombre: "trackCta", tipo: "booleano", descripcion: "medir clics en a[data-cta]" },
      { nombre: "trackForms", tipo: "booleano", descripcion: "medir envíos de formulario" },
      TEXTO("thankYouPaths", "rutas de agradecimiento separadas por comas")
    ],
    exito: "`analytics` guardada."
  },
  "POST /api/projects/:id/analitica/generar": {
    resumen: "Escribir el cargador de analítica",
    detalle: "Escribe analytics.js (que no pide nada a Google hasta que el visitante acepta) y lo engancha en cada página con un bloque marcado. Al apagarla retira el bloque y borra el archivo.",
    acceso: "dueño",
    exito: "`generated` con los archivos, las páginas tocadas y si quedó activa."
  },

  "GET /api/components": {
    resumen: "Bloques guardados de la cuenta",
    detalle: "La biblioteca del constructor, con las reglas de estilo que llevaba cada bloque.",
    acceso: "sesión",
    exito: "`components`."
  },
  "POST /api/components": {
    resumen: "Guardar un bloque",
    detalle: "Guarda el HTML tal como está escrito en el fuente.",
    acceso: "sesión",
    estado: "201",
    cuerpo: [
      TEXTO("name", "nombre del bloque", true),
      TEXTO("html", "fragmento HTML", true),
      { nombre: "reglas", tipo: "registro", descripcion: "reglas CSS de sus clases" }
    ],
    exito: "`component` guardado."
  },
  "GET /api/components/:componentId": {
    resumen: "Leer un bloque",
    detalle: "Un bloque de la cuenta; los ajenos no existen.",
    acceso: "sesión",
    exito: "`component`."
  },
  "PUT /api/components/:componentId": {
    resumen: "Sobrescribir un bloque",
    detalle: "Se puede renombrar sin reescribir el contenido, o al revés.",
    acceso: "sesión",
    cuerpo: [
      TEXTO("name", "nombre del bloque"),
      TEXTO("html", "fragmento HTML"),
      { nombre: "reglas", tipo: "registro", descripcion: "reglas CSS de sus clases" }
    ],
    exito: "`component` actualizado."
  },
  "DELETE /api/components/:componentId": {
    resumen: "Borrar un bloque",
    detalle: "Deja de estar disponible en la paleta.",
    acceso: "sesión",
    estado: "204",
    exito: "Respuesta vacía."
  },

  "GET /api/runs": {
    resumen: "Ejecuciones de toda la cuenta",
    detalle: "Lo último que corrió en cualquier proyecto de la cuenta, con su nombre. Los registros no salen en la lista.",
    acceso: "sesión",
    exito: "`runs` con `nombreProyecto`, de la más nueva a la más antigua."
  },
  "GET /api/runs/estado": {
    resumen: "Qué aislamiento tiene el servidor",
    detalle: "El ejecutable de la jaula, si está disponible, sus topes y las recetas admitidas. No destapa rutas del host.",
    acceso: "sesión",
    exito: "`jaula` con `disponible`, `binario`, `red`, `tipos` y `limites`."
  },
  "GET /api/projects/:id/runs": {
    resumen: "Historial de ejecuciones del proyecto",
    detalle: "Las últimas filas cerradas; el registro comprimido se pide aparte.",
    acceso: "dueño",
    exito: "`runs` sin campo `log`."
  },
  "GET /api/projects/:id/runs/:runId": {
    resumen: "Leer el registro de una ejecución",
    detalle: "La salida tal como la produjo el proceso, descomprimida en el servidor.",
    acceso: "dueño",
    exito: "`run` y `log`."
  },
  "POST /api/projects/:id/runs": {
    resumen: "Lanzar una receta",
    detalle: "Copia el proyecto, lo ejecuta dentro de la jaula y espera su cierre: la respuesta trae el resultado, no un id que consultar. El comando no lo manda el cliente.",
    acceso: "dueño",
    cuerpo: [
      TEXTO("tipo", "script o comprobar", true),
      TEXTO("archivo", "destino cuando el tipo es script"),
      TEXTO("entorno", "variables que se inyectan, si se piden")
    ],
    exito: "`run` cerrada y su `log`."
  },

  "GET /api/admin/metrics": {
    resumen: "Métricas de la plataforma",
    detalle: "Cuentas, proyectos, archivos y bytes del conjunto. Solo administración.",
    acceso: "administración",
    exito: "`metrics`."
  },
  "GET /api/admin/services": {
    resumen: "Estado de las piezas del servidor",
    detalle: "Prueba de escritura real sobre la base de datos y el pending del outbox. El correo aparece como `sin-proveedor` porque no hay ninguno integrado.",
    acceso: "administración",
    exito: "`services` con base de datos, correo, outbox y aplicación."
  },
  "GET /api/admin/users": {
    resumen: "Listar las cuentas",
    detalle: "Rol, estado y uso de cada cuenta.",
    acceso: "administración",
    exito: "`users`."
  },
  "GET /api/admin/activity": {
    resumen: "Últimas acciones de administración",
    detalle: "Quién cambió qué, sin contenido de los datos tocados.",
    acceso: "administración",
    consulta: [{ nombre: "limit", tipo: "entero", descripcion: "cuántos eventos, 100 por defecto" }],
    exito: "`events`."
  },
  "GET /api/admin/settings": {
    resumen: "Leer la configuración",
    detalle: "El registro abierto o cerrado y los límites por cuenta.",
    acceso: "administración",
    exito: "`settings`."
  },
  "PATCH /api/admin/settings": {
    resumen: "Cambiar la configuración",
    detalle: "Solo los campos que llegan; el cambio queda anotado en la actividad.",
    acceso: "administración",
    cuerpo: [
      { nombre: "allowRegistration", tipo: "booleano", descripcion: "permitir auto-registro" },
      { nombre: "maxProjectsPerUser", tipo: "entero", descripcion: "proyectos por cuenta" },
      { nombre: "maxBytesPerProject", tipo: "entero", descripcion: "bytes por proyecto" }
    ],
    exito: "`settings` actualizadas."
  },
  "PATCH /api/admin/users/:id": {
    resumen: "Cambiar rol o estado de una cuenta",
    detalle: "Un rol nuevo o suspender la cuenta; la administración no puede dejarse sin sí misma.",
    acceso: "administración",
    cuerpo: [
      TEXTO("role", "admin o user"),
      TEXTO("status", "activa o suspendida")
    ],
    exito: "La cuenta resultante."
  },
  "GET /api/admin/outbox": {
    resumen: "Bandeja de correo del servidor",
    detalle: "Los mensajes con su estado: enviados, pendientes y el último error de entrega si lo hubo. Solo administración.",
    acceso: "administración",
    exito: "`messages` con destinatario, asunto, fechas y error."
  },
  "POST /api/admin/outbox/reintentar": {
    resumen: "Reintentar los envíos pendientes",
    detalle: "Usa el SMTP configurado en `WEBFORGE_SMTP_URL`. Sin proveedor responde 409 en vez de fingir entregas.",
    acceso: "administración",
    exito: "`delivered` y `failed`."
  },
  "GET /api/admin/users/:id/activity": {
    resumen: "Sesiones, IPs y accesos de una cuenta",
    detalle: "Sesiones abiertas, IPs desde las que se intentó entrar y los últimos accesos con su resultado (éxito, fallo, bloqueo, segundo factor).",
    acceso: "administración",
    exito: "`sessions`, `ips` y `events`."
  },
  "POST /api/admin/users/:id/revoke-sessions": {
    resumen: "Cerrar todas las sesiones de una cuenta",
    detalle: "Cierra toda sesión abierta de esa cuenta, incluida la que esté usando en ese momento. Queda en la actividad administrativa.",
    acceso: "administración",
    exito: "`revoked` con el número de sesiones cerradas."
  },
  "POST /api/admin/users/:id/unblock": {
    resumen: "Levantar el bloqueo de intentos fallidos",
    detalle: "Borra el contador de la cuenta, que se lleva por correo, sin tocar la contraseña. Es la salida cuando alguien se queda fuera por error durante las 24 horas de bloqueo.",
    acceso: "administración",
    cuerpo: [],
    exito: "La cuenta resultante, ya sin `lockedUntil`."
  },
  "DELETE /api/admin/users/:id": {
    resumen: "Eliminar una cuenta",
    detalle: "Pide escribir el correo exacto como confirmación. Se lleva sus proyectos y no se puede eliminar la cuenta propia.",
    acceso: "administración",
    estado: "204",
    cuerpo: [TEXTO("confirm", "correo exacto de la cuenta", true)],
    exito: "Respuesta vacía."
  }
};

export function claveDeRuta(ruta: RutaApi): string {
  return `${ruta.method} ${ruta.url}`;
}

const ESQUEMAS: Record<TipoCampo, Record<string, unknown>> = {
  texto: { type: "string" },
  entero: { type: "integer" },
  booleano: { type: "boolean" },
  lista: { type: "array", items: { type: "string" } },
  mapa: { type: "object", additionalProperties: { type: "string" } },
  registro: { type: "array", items: { type: "object" } },
  binario: { type: "string", format: "binary" }
};

function tagDe(url: string): string {
  if (url.startsWith("/api/auth")) return "autenticación";
  if (url.startsWith("/api/admin")) return "administración";
  if (url.startsWith("/api/projects/:id/files")) return "archivos";
  if (url.startsWith("/api/projects/:id/versions")) return "versiones";
  if (url.startsWith("/api/projects/:id/env")) return "entorno";
  if (url.startsWith("/api/projects/:id/seo")) return "seo";
  if (url.includes("/runs")) return "ejecuciones";
  if (url.startsWith("/api/components")) return "bloques";
  if (url.startsWith("/api/projects")) return "proyectos";
  if (url.startsWith("/api/account")) return "cuenta";
  if (url.startsWith("/api/search")) return "búsqueda";
  return "general";
}

/** Los `:param` de la ruta Fastify, declarados como parámetros de OpenAPI. */
function parametrosDe(url: string): ParametroDoc[] {
  const salida: ParametroDoc[] = [];
  for (const segmento of url.split("/").slice(1)) {
    if (!segmento.startsWith(":")) continue;
    const nombre = segmento.slice(1);
    salida.push({
      name: nombre,
      in: "path",
      required: true,
      schema: { type: "string" },
      description: nombre === "id" ? "identificador del proyecto" : `identificador de ${nombre}`
    });
  }
  return salida;
}

export function documentoDeRutas(rutas: readonly RutaApi[]): DocumentoApi {
  const paths: Record<string, Record<string, OperacionDoc>> = {};
  for (const ruta of rutas) {
    const fin = FINES[claveDeRuta(ruta)];
    const abierta = ruta.url.replace(/:([A-Za-z_]+)/g, "{$1}");
    const operacion: OperacionDoc = {
      summary: fin?.resumen ?? "",
      description: fin?.detalle ?? "",
      operationId: `${ruta.method.toLowerCase()}-${abierta.replace(/[^\w-]+/g, "-")}`,
      tags: [tagDe(ruta.url)],
      security: fin && fin.acceso !== "pública" ? [{ sesion: [] }] : [],
      "x-acceso": fin?.acceso ?? "sin documentar",
      parameters: [...parametrosDe(ruta.url), ...(fin?.consulta ?? []).map(campoDe)],
      responses: { [fin?.estado ?? "200"]: { description: fin?.exito ?? "La documentación de esta ruta falta." } }
    };
    if (!fin) operacion["x-sin-documentar"] = true;
    if (fin?.cuerpo) {
      const propiedades: Record<string, unknown> = {};
      const obligados: string[] = [];
      for (const campo of fin.cuerpo) {
        propiedades[campo.nombre] = { ...ESQUEMAS[campo.tipo], description: campo.descripcion };
        if (campo.requerido) obligados.push(campo.nombre);
      }
      operacion.requestBody = {
        required: obligados.length > 0,
        content: {
          [fin.content ?? "application/json"]: {
            schema: {
              type: "object",
              properties: propiedades,
              ...(obligados.length > 0 ? { required: obligados } : {})
            }
          }
        }
      };
    }
    (paths[abierta] ??= {})[ruta.method.toLowerCase()] = operacion;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "API de WebForge",
      version: "1",
      description:
        "Los datos de cada cuenta están en la base del servidor: ninguna ruta acepta comandos ni rutas fuera del proyecto. " +
        "Todo error se responde como `{ error: texto }` con su estado HTTP: 400 validación, 401 sin sesión, 403 sin cabecera " +
        "propia o sin rol, 404 lo que no es tuyo, 409 conflicto, 429 demasiados intentos y 503 cuando el servidor no tiene aislamiento. " +
        "Toda mutación (POST, PUT, PATCH, DELETE) exige la cabecera `x-requested-with` y un origen de confianza."
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        sesion: { type: "apiKey", in: "cookie", name: "wf_session", description: "Cookie firmada que devuelve el inicio de sesión." }
      }
    },
    paths
  };
}

function campoDe(campo: Campo): ParametroDoc {
  return {
    name: campo.nombre,
    in: "query",
    ...(campo.requerido ? { required: true } : {}),
    schema: ESQUEMAS[campo.tipo],
    description: campo.descripcion
  };
}
