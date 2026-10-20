# WebForge

Plataforma de desarrollo web con dashboard integral: proyectos, editor de código, explorador de
archivos, vista previa aislada, versiones recuperables, exportación/importación en ZIP, variables
de entorno por proyecto, ejecuciones aisladas en el servidor, documentación viva de la API,
autenticación con roles y panel de administración.

Estado: Fases 1–6 completadas y verificadas. Las fases 7–10 (plantillas comerciales y SEO,
analítica, endurecimiento y guía de despliegue) están pendientes; las pantallas sin función real se
marcan como tales y **no simulan** operaciones de servidor.

## Puesta en marcha

```bash
npm install
cp .env.example .env      # el .env real nunca se commitea
npm run seed:admin        # crea la cuenta de administración (WEBFORGE_ADMIN_*)
npm run create:user       # cuenta concreta (WEBFORGE_USER_EMAIL/PASSWORD/ROLE/USERNAME)
npm run dev               # API en http://127.0.0.1:8787 + web en http://localhost:5173
npm run typecheck         # tsc estricto, cliente y servidor
npm test                  # vitest: pruebas unitarias y de rutas HTTP
npm run build             # typecheck + bundle en dist/
```

`scripts/dev.mjs` levanta los dos procesos. La API **no está en modo watch**: al tocar `server/`
hay que reiniciar el script. Las variables de entorno están documentadas en `.env.example`.

Para que el correo salga de verdad define `WEBFORGE_SMTP_URL` (credenciales SMTP; en Gmail, una
contraseña de aplicación, no la de la cuenta) y `WEBFORGE_PUBLIC_URL`. Sin SMTP la aplicación no
finge envíos: los enlaces quedan en la bandeja del servidor y el panel permite reintentarlos cuando
se configure. El envío SMTP está probado contra un servidor local (`smtp-server`) en las pruebas.

## Decisiones

| Decisión | Motivo |
| --- | --- |
| Vite + React 19 + TypeScript estricto | Tipado completo en cliente y servidor (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). |
| Fastify 5 + `node:sqlite` | Un único binario Node, sin dependencias de servicio externo; la base es un fichero. |
| `@node-rs/argon2` para contraseñas | Hash con coste ajustable; nunca se guarda texto plano ni se compara con `===`. |
| Cookie de sesión firmada, `HttpOnly`, `SameSite=Strict` | La sesión no es legible desde JS; el CSRF se refuerza con la cabecera `x-requested-with`. |
| Roles comprobados en el servidor | Ocultar botones no autoriza nada: cada ruta de `/api/admin` exige `requireAdmin`. |
| `fflate` para los ZIP | Crear y leer archivos deterministas en servidor y navegador, con límites de tamaño por entrada. |
| Vista previa solo estática en `iframe sandbox` | El código del usuario no se ejecuta dentro del proceso de la aplicación. |
| Correo local y SMTP opcional | Sin `WEBFORGE_SMTP_URL` los enlaces se quedan en `outbox_messages` y se dice; con SMTP salen por nodemailer y se anota entrega o error. |
| Verificación obligatoria y bloqueo por intentos | Registrarse no abre sesión: sin confirmar el correo no se entra. El enlace caduca a los tres minutos y se puede pedir otro (`POST /api/auth/verify-email/resend`). Tres contraseñas fallidas cierran la cuenta 24 horas (429 con `retry-after`); el restablecimiento por correo o `POST /api/admin/users/:id/unblock` levantan el bloqueo. |
| Correo real por SMTP | Con `WEBFORGE_SMTP_URL` los mensajes salen con nodemailer y se anota el resultado; sin proveedor quedan pendientes en la bandeja del servidor, con su error y un reintento manual desde administración. |
| Usuario además del correo | El alta acepta un nombre de usuario único (o lo deriva del correo) y el acceso funciona con correo o usuario. |
| 2FA TOTP | Cualquier cuenta, y en especial las de administración, puede activar un segundo factor de seis dígitos con códigos de recuperación de un solo uso. El secreto se guarda cifrado y los códigos, como digesto. |
| Variables cifradas en reposo | `project_env` se guarda con AES-256-GCM; la clave se deriva de `WEBFORGE_ENV_KEY` o del secreto de sesión. |
| Actividad con IPs | Cada intento de acceso guarda IP, agente y resultado; administración puede revisarlos y cerrar todas las sesiones de una cuenta. |

## Estructura

```
shared/paths.ts                reglas de ruta de archivo, compartidas cliente/servidor
shared/seo.ts y seoFiles.ts    reglas de SEO y generador puro de cabecera, sitemap y robots
src/
  main.tsx                     composición de providers (tema, avisos, API, stores, sesión, admin)
  lib/api.ts                   cliente HTTP: JSON, `download` y `upload` binarios, errores del servidor
  lib/ApiContext.tsx           el mismo cliente para lo que no cabe en un almacén (ZIP)
  lib/stores.tsx               almacenes HTTP sustituyendo a localStorage
  features/projects/           modelo, ProjectStore, contexto, tarjetas, formulario, versiones
    archive.ts                 exportar/importar ZIP y entrega al navegador
    env.ts                     EnvStore sobre /api/projects/:id/env (lista sin valores)
    httpStorage.ts             proyectos sobre /api/projects
    versions.ts                versiones sobre /api/projects/:id/versions
    ImportBanner.tsx           importación única de lo que había en localStorage
    ProjectEnv.tsx             panel de variables por entorno, con revelar y borrar
    runs.ts                    RunStore sobre /api/projects/:id/runs (tipos, estados, registros, lista de la cuenta y estado de la jaula)
  features/docs/               documentacion.ts: lectura del documento OpenAPI que devuelve el servidor
  features/files/              explorador y FileStore HTTP
  features/editor/             CodeMirror, autoguardado, histórico compartido, consola y documento de vista previa
    RunsPanel.tsx              panel de ejecuciones: tipo, entorno, archivo, historial y registro
  features/builder/            constructor visual: fuente HTML, paleta de bloques, inspector, biblioteca reutilizable y ediciones de fuente
  features/search/             SearchStore sobre /api/search (la barra superior pregunta al servidor)
  features/auth/               sesión, rutas protegidas, alta, verificación y recuperación
  features/admin/              panel de usuarios, métricas, actividad y ajustes
  pages/ layout/ components/   panel, proyectos, detalle, construcción, documentación, ajustes y primitivas de UI
                               (el editor se importa con `import()` y `AppShell` avisa mientras llega)
server/
  app.ts                       fábrica Fastify: cabeceras, CSRF, sesión, errores, límites e inventario de rutas (`rutasApi`)
  config.ts                    lectura y validación de WEBFORGE_*
  db.ts                        apertura de SQLite y migraciones versionadas (MIGRATIONS)
  auth/                        argon2, sesiones, intentos de acceso, tokens de correo, outbox
  docs/api.ts                  la prosa de cada endpoint y el generador OpenAPI sobre las rutas registradas
  run/                         ejecuciones aisladas: jail.ts (bwrap + ulimit), runner.ts (supervisión y
                                 reloj), preparar.ts (copia del proyecto), recetas.ts (lo que se puede
                                 correr), comprobar.mjs (comprobador) y servicio.ts (el recorrido entero)
  repositories/                usuarios, proyectos, archivos, versiones, variables, seo, analítica, bloques guardados, búsqueda, ejecuciones, eventos, métricas y zip.ts
  routes/                      auth, account, projects, versions, env, seo, analítica, components, search, runs, admin, docs (`index.ts` los monta todas en orden)
  quotas.ts                    límites por cuenta aplicados en el servidor
  testing.ts                   inyección de peticiones con cookie y cuerpo JSON o binario
```

## API

- `POST /api/auth/register|login|login/2fa|logout|password|verify-email|verify-email/resend|password/reset|password/reset/confirm`, `GET /api/auth/session|sessions|config|2fa`, `POST /api/auth/2fa/setup|confirm|disable`
- `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id`, `POST /api/projects/:id/duplicate`, `GET /api/projects/:id/history`
- `GET /api/projects/:id/files` (lista), `GET|PUT /api/projects/:id/files/content`, `POST|PATCH|DELETE /api/projects/:id/files`
- `GET|POST /api/projects/:id/versions`, `GET /api/projects/:id/versions/:versionId`, `POST /api/projects/:id/versions/:versionId/restore`
- `GET /api/projects/:id/export` (ZIP) y `POST /api/projects/import` (ZIP con `.webforge.json`)
- `GET /api/projects/:id/env?environment=desarrollo|produccion` (lista **sin valores**), `PUT /api/projects/:id/env` (crear o actualizar), `POST /api/projects/:id/env/:variableId/reveal` (leer un valor, queda anotado) y `DELETE /api/projects/:id/env/:variableId`
- `GET|PUT /api/projects/:id/seo` (dominio, plantilla de título, descripción, idioma, imagen social, schema y robots) y `POST /api/projects/:id/seo/generar` (escribe `sitemap.xml`, `robots.txt` y el bloque de cabecera con Open Graph y JSON-LD en cada página)
- `GET|PUT /api/projects/:id/analitica` (GA4 opcional: identificador G-, CTA, formularios y páginas de agradecimiento) y `POST /api/projects/:id/analitica/generar` (escribe `analytics.js`, que no carga nada hasta que el visitante acepta, y lo engancha en cada página; al apagarla retira el bloque y borra el archivo)
- `GET /api/account/usage`
- `GET|POST /api/components` y `GET|PUT|DELETE /api/components/:id`: biblioteca de bloques de la
  cuenta. Cada bloque guarda su HTML y las reglas de sus clases `wf-eN`; el servidor pone el nombre
  a `2..80` caracteres, el HTML a 32 KB, hasta 20 reglas y 8 KB de estilos, y rechaza cualquier
  selector que no sea una clase del constructor.
- `GET /api/search?q=` (proyectos y archivos propios, con línea y fragmento; nunca valores de entorno)
- `GET /api/projects/:id/runs` (historial **sin registros**), `GET /api/projects/:id/runs/:runId` (una
  ejecución con su registro), `POST /api/projects/:id/runs` con cuerpo `{tipo, archivo?, entorno?}`.
  `tipo` solo puede ser `script` o `comprobar`: el cliente no manda comandos, las recetas viven en el
  servidor. Un proyecto no puede tener dos ejecuciones abiertas y, si el servidor no tiene aislamiento,
  responde 503 en vez de fingir un resultado.
- `GET /api/runs` (las ejecuciones de toda la cuenta, con el nombre de su proyecto) y
  `GET /api/runs/estado` (qué aislamiento tiene el servidor: ejecutable, red y topes reales; jamás
  la ruta de trabajo). Ambos piden sesión.
- `GET /api/docs/openapi` —el contrato de la API en OpenAPI 3.1, construido con el inventario de
  rutas de Fastify, no con una lista a mano. Es público porque no contiene datos de ninguna cuenta.
- `GET|PATCH /api/admin/users[/:id]`, `POST /api/admin/users/:id/unblock|revoke-sessions`, `GET /api/admin/users/:id/activity`, `GET /api/admin/metrics|activity|services|outbox`, `POST /api/admin/outbox/reintentar`, `GET|PATCH /api/admin/settings`, `DELETE /api/admin/users/:id`

Toda mutación exige la cabecera `x-requested-with`; el origen se contrasta con el `Host` salvo
que esté declarado en `WEBFORGE_ALLOWED_ORIGINS`. Un recurso de otro usuario responde 404, no 403,
para no revelar si existe.

## Qué funciona hoy

- Cuentas reales: alta sin sesión hasta verificar el correo (enlace de tres minutos, con reenvío),
  nombre de usuario único además del correo, acceso con cualquiera de los dos, sesiones activas y
  revocación, cambio y recuperación de contraseña, bloqueo de 24 horas tras tres intentos fallidos y
  2FA TOTP con códigos de recuperación. Correo por SMTP cuando se configura (nodemailer) y bandeja
  local honesta cuando no; cada intento deja IP, agente y resultado visibles para administración.
- Proyectos en base de datos: crear (con plantilla de archivos), listar, filtrar, renombrar,
  duplicar, cambiar estado, editar detalles y eliminar con confirmación.
- SEO por proyecto con base real: ajustes validados (dominio https sin ruta, plantilla con `%s`,
  descripción de 160 caracteres, idioma BCP 47, imagen social y tipo de Schema.org), generación que
  escribe `sitemap.xml`, `robots.txt` y la cabecera de cada página con canonical, Open Graph, Twitter
  y JSON-LD (un solo título y una sola descripción por página, conservando el título y la descripción
  propios entre pasadas), y una pantalla con el análisis estático: títulos, descripciones, encabezados,
  enlaces rotos, imágenes sin alt, JSON-LD y pesos. El generador no inventa direcciones, precios ni
  fechas, y el informe avisa de que no es una medición de campo ni promete posiciones.
- Analítica opcional por proyecto: GA4 con identificador validado, clics en CTA, envíos de formulario y
  páginas de agradecimiento. El `analytics.js` generado pinta un aviso de consentimiento propio y no
  pide nada a Google hasta que el visitante acepta; quien rechaza no recibe medición. Sin credenciales
  de la API de datos de GA4 la plataforma no descarga métricas y lo dice en la pantalla, en vez de
  inventar un panel. La administración ve cuántos proyectos la tienen activa y el estado real de
  correo, hosting y aislamiento en «Integraciones».
- Editor con autoguardado, explorador de archivos, consola y vista previa en `iframe sandbox`;
  constructor visual que escribe HTML real sobre el mismo documento.
- Paleta de 22 bloques (estructura, contenido, formulario y medio: cabecera con menú, hero, secciones,
  columnas, rejillas de 3 y 4, tabla, tarjeta, cita, botón, enlace, diálogo accesible, separador, imagen,
  icono SVG, vídeo, formulario y campo). Cada bloque declara el hueco donde se inserta (`Antes` /
  `Después` / `Dentro`), usa clases que existen de verdad en la hoja de estilos del proyecto y sale con
  atributos accesibles. La prueba `components.test.ts` falla si una plantilla del paleta emplea una clase
  que la hoja de estilos no define.
- Sistema de diseño en la plantilla inicial: variables (`--accent`, `--ink`, `--surface`, `--ancho`…) en
  `:root`, variante `[data-theme="oscuro"]` que las redefine, y dos puntos de ruptura (40 rem y 64 rem)
  que abren columnas y rejillas. La vista previa respeta el tamaño de pantalla elegido en la barra.
- La vista previa bloquea navegación y envíos, pero deja funcionar `<dialog>`: un `form method="dialog"`
  cierra el diálogo en vez de avisar del bloqueo, así que los modales que genera el constructor son
  usable desde la propia vista previa.
- Arrastrar y soltar: un bloque de la paleta se arrastra hasta la vista previa y se coloca en el hueco
  marcado. Durante el arrastre un escudo propio cubre el `iframe` (el documento previsualizado es de
  origen opaco y no puede coordinar el suelto), pregunta al tiempo de ejecución qué hay bajo el puntero
  y él responde con su `path` y su franja —quinto superior `Antes`, inferior `Después`, resto `Dentro`,
  pinta la marca—; sin respuesta no se inserta nada. El identificador viaja en un MIME propio
  (`application/x-webforge-component`): como `text/plain` CodeMirror lo escribiría en el HTML. La
  paleta se arrastra aunque no haya selección; para colocar con un clic hay que seleccionar antes.
- Editar estilos en la vista: el inspector escribe color, fondo, tamaño de letra, interlineado,
  margen interior y exterior, borde, redondeo, sombra y espaciado del elemento seleccionado, y las
  variables del tema (`--accent`, `--ink`, `--surface`, `--line`, `--radio`) en sus dos bloques
  (`:root` y `[data-theme="oscuro"]`). Todo va a la hoja de estilos real del proyecto bajo una clase
  propia (`wf-e1`, `wf-e2`…) numerada sobre las clases ya existentes: no se toca `.card` ni ninguna
  clase compartida, y el HTML solo gana —o pierde— esa clase. El CSS se parchea por rangos, así que
  comentarios, sangría y orden de las reglas siguen siendo legibles. Si el documento no cargaba su
  hoja, se añade el `<link>` en el mismo paso (enlazarlo al final del contenedor, porque las rutas
  del constructor son índices y renumerarlas mataría la selección). Un `Ctrl+Z` revierte a la vez
  HTML y CSS.
- Biblioteca de bloques por cuenta (`Tu biblioteca`, en el inspector del constructor): con un elemento
  seleccionado se guarda su HTML —sin las marcas `data-wf-*`, que son índices entre hermanos y en otro
  documento señalarían una ruta inexistente— junto con las reglas de las clases `wf-eN` que usa, leídas
  de la hoja de estilos del proyecto de origen. Al reutilizarlo, el nombre de clase ya ocupado en el
  destino se renueva (`wf-e1` → `wf-e2`) a la vez en el HTML y en sus reglas, así que el bloque no
  reestiliza a un elemento ajeno; el marcado y la hoja se escriben en **un solo paso de histórico** y
  el `<link>` se añade si el documento no lo tenía. Si el proyecto no tiene hoja de estilos, el aviso
  lo dice en vez de callarse que el bloque llega sin pintar nada. La biblioteca es de la cuenta, no del
  proyecto: el bloque sigue disponible aunque se borre, y quitarlo de la paleta no toca lo ya insertado.
- Deshacer y rehacer (`Ctrl+Z` / `Ctrl+Mayús+Z` o los botones de la barra) sobre **un solo histórico
  por proyecto**: comparte pila entre el editor y el constructor, agrupa lo tecleado de golpe en un
  paso, puede deshacer cambios que afectan a varios archivos a la vez y escribe el resultado en el
  servidor en el momento, sin esperar al autoguardado. Se vacía al renombrar, borrar o cambiar de
  proyecto, porque sus pasos apuntarían a rutas que ya no existen.
- Versiones: guardar hitos, leer su contenido y recuperarlos creando antes una copia de seguridad.
- Exportar un proyecto a ZIP y volver a importarlo, con manifiesto `.webforge.json`.
- Variables de entorno separadas por proyecto y entorno (desarrollo / producción): la lista y el ZIP
  nunca llevan valores, cada valor se pide explícitamente y esa lectura queda en el historial; el
  servidor rechaza saltos de línea y limita clave, valor y cantidad.
- Ejecuciones reales en el servidor, dentro de `bwrap` (`--unshare-all --unshare-pid --cap-drop ALL`,
  `/` y `/etc` de solo lectura, solo la copia del proyecto escribible, tmpfs con tope y red cortada) con
  `ulimit -t/-f/-c` por proceso y reloj máximo que corta y marca `cancelada`. El modo **Ejecuciones** del
  editor lanza un `.js`/`.mjs`/`.cjs` del proyecto o la **comprobación**, deja elegir si entran las
  variables de desarrollo o de producción, y enseña el registro guardado (gzip en la base de datos, las
  25 últimas por proyecto). La copia se borra al terminar: lo que el script escribe no vuelve al proyecto.
- El comprobador (`server/run/comprobar.mjs`) es Node puro dentro de la jaula, sin dependencias: sintaxis
  JavaScript con el propio `node --check`, JSON que parsea, llaves que cuadran en CSS, y en HTML el
  `alt` que falta, los `id` repetidos, las referencias a archivos que no están en el proyecto y los
  avisos de `lang`/`title`/`<!doctype>`. Sale con errores → la ejecución queda **Fallida** y el registro
  dice cuál; sin errores → **Terminada** con `0 errores`.
- Pantalla **Construcción** (`/builds`): lee del servidor el estado del aislamiento —ejecutable, si
  hay red, recetas y cada tope en bytes legibles— y enseña las ejecuciones de toda la cuenta, no solo
  del proyecto abierto. Cada fila enlaza con el editor de su proyecto y su botón vuelve a pedir el
  registro guardado. Cuando `bwrap` no está, la pantalla lo dice y el servidor responde 503; no hay
  botón de compilar que haga creer que algo se compiló.
- Pantalla **Documentación** (`/documentacion`): renderiza el documento OpenAPI que el propio servidor
  genera sobre sus rutas registradas, con acceso exigido, parámetros, campos del cuerpo (y si son
  obligatorios) y qué devuelve cada una. Si una ruta se queda sin documentar, aparece marcada en la
  pantalla y la prueba `server/routes/docs.test.ts` falla, así que el texto no puede separarse del
  código ni inventar un endpoint que no existe.
- Panel de administración con usuarios, roles, cuotas, métricas, actividad y ajustes; los permisos
  los decide el servidor.
- Importación única de los datos que quedaron en `localStorage` de la fase anterior.
- Tema claro/oscuro y layout responsive.
- Barra superior con paleta de comandos (`Ctrl+K`): acciones rápidas, proyectos y archivos por su
  contenido. Busca el servidor —solo lo que es tuyo—, enseña la línea y un fragmento, y abre el
  destino: la ficha del proyecto, el editor en `…/editor?file=<ruta>` o el formulario con
  `/projects?nuevo=1`. Las flechas y `Enter` funcionan sin ratón.

## Despliegue

La aplicación es un único proceso Node que sirve la API y, en producción, el bundle de `dist/`:

```bash
npm ci
npm run build
NODE_ENV=production \
WEBFORGE_SESSION_SECRET=... WEBFORGE_ENV_KEY=... WEBFORGE_DB_PATH=/var/lib/webforge/webforge.sqlite \
WEBFORGE_PUBLIC_URL=https://tu-dominio.example npm start
```

Detrás de un proxy HTTPS (Caddy, nginx, Traefik) que termine TLS; la app no abre puertos públicos por
sí sola (`WEBFORGE_HOST` es `127.0.0.1` por defecto). Guarda el fichero SQLite en un volumen con
copias. No hay proveedor de hosting integrado: no existe botón de «desplegar» porque no hay destino
real al que publicar.

## Pendiente y límites conocidos

- Instalar dependencias de un proyecto **no es posible**: la jaula va sin red y no hay almacén propio.
  Se dice en el panel en vez de simular un `npm install`.
- Terminal arbitrario, backend desplegado, dominios y hosting: siguen sin existir. Solo corren las
  recetas declaradas por el servidor, la vista previa es estática y no se inventan despliegues.
- La jaula es `bwrap`, no Docker: aquí no hay demonio ni cgroups accesibles sin root. Los límites
  aplicados son CPU, tamaño de fichero, procesos, descriptores, heap de Node, tamaño de `/tmp` y reloj
  real; `RLIMIT_NPROC` cuenta por usuario y el PID 1 del espacio de pids queda fuera, así que el tope
  efectivo de procesos depende del host.
- El 2FA está disponible para todas las cuentas y se exige en el acceso en cuanto se activa; no se
  fuerza a los administradores a tenerlo. El panel marca «sin 2FA» en las cuentas de administración
  para que la ausencia se vea.
- SMTP necesita un proveedor real: sin `WEBFORGE_SMTP_URL` no hay entrega externa, solo bandeja local.
- El editor viaja en su propio módulo (`import()`): abrir el panel descarga ~482 kB (146 kB gzip) y
  CodeMirror con el constructor —672 kB, 229 kB gzip— solo se pide al entrar en `…/editor`. Partir
  CodeMirror por lenguajes sigue pendiente; no bloquea la primera pantalla.
- Los topes de subida son los del servidor (512 KB por archivo, 200 archivos por proyecto).

## Verificación

Cada bloque se cierra con `npm run typecheck`, `npm test`, `npm run build` y los flujos principales
ejecutados en Chromium (registro, proyectos, editor con guardado real, vista previa, deshacer y
rehacer por teclado y botón, paleta con sus rejillas responsivas según el tamaño de pantalla,
arrastre de bloques hasta las tres franjas de la vista previa, estilos del elemento y variables del
tema escritos en `styles.css` con su deshacer conjunto, biblioteca de bloques —guardar un titular con
su regla, reutilizarlo en otro proyecto donde `wf-e1` ya estaba ocupado y ver que el bloque entra como
`wf-e2` con su color, seguir teniéndolo tras recargar y que quitarlo no borre lo insertado—,
tabla y diálogo accesibles, versiones,
ZIP, variables de entorno con su aislamiento entre cuentas, paleta de búsqueda con sus enlaces
profundos, pantalla de construcción con los topes leídos del servidor y su enlace al editor,
documento de la API renderizado con su filtro y permisos de administración, alta con nombre de
usuario y acceso con él, 2FA TOTP de extremo a extremo —activar, ver los códigos de recuperación,
salir, entrar con el código y desactivar—, bandeja de correo con reintento deshabilitado sin SMTP,
actividad de una cuenta con sus IPs y sesiones, SEO con generación real de sitemap/robots/cabecera,
analítica con consentimiento que no carga nada al rechazar, y un envío SMTP real contra un servidor
local en las pruebas) comprobando además que la consola y la red quedan limpias.

Vitest da 20 s por prueba (`testTimeout`) y limita el jornal a 5 obreros (`maxWorkers`), ambos en
`vite.config.ts`: cada fichero monta su propio entorno jsdom y con todos los núcleos ocupados a la vez
la máquina se queda sin margen. La última pasada completa dio **95 ficheros, 1244 pruebas superadas y
1 omitida** (la prueba real de `bwrap`, que se salta donde no hay jaula) en unos 200 s. Los ficheros
que dependen del reloj llevan márgenes explícitos y reintentos de la interacción, no solo timeouts.
