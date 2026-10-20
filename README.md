# WebForge

[Español](README.md) · [English](README.en.md)

WebForge es una plataforma para desarrollar sitios web desde el navegador: editor de código, constructor visual, vista previa, plantillas, SEO, analítica con consentimiento y administración de cuentas. Todo corre sobre un único servidor Node con una base SQLite, sin servicios externos obligatorios.

Creado por [Kuraykka](https://github.com/Kuraykka). Repositorio: [github.com/Kuraykka/webforge](https://github.com/Kuraykka/webforge).

## Índice

1. [Qué incluye](#qué-incluye)
2. [Tecnología](#tecnología)
3. [Requisitos](#requisitos)
4. [Instalación paso a paso en Linux o macOS](#instalación-paso-a-paso-en-linux-o-macos)
5. [Instalación paso a paso en Windows](#instalación-paso-a-paso-en-windows)
6. [Configuración](#configuración)
7. [Crear tu cuenta](#crear-tu-cuenta)
8. [Activar la verificación en dos pasos](#activar-la-verificación-en-dos-pasos)
9. [Enviar correo de verdad (SMTP)](#enviar-correo-de-verdad-smtp)
10. [Ejecutar en desarrollo](#ejecutar-en-desarrollo)
11. [Compilar y ejecutar en producción](#compilar-y-ejecutar-en-producción)
12. [Copias de seguridad](#copias-de-seguridad)
13. [Pruebas y verificación](#pruebas-y-verificación)
14. [Estructura del proyecto](#estructura-del-proyecto)
15. [API](#api)
16. [Seguridad](#seguridad)
17. [Límites conocidos](#límites-conocidos)
18. [Créditos y licencia](#créditos-y-licencia)

## Qué incluye

- **Cuentas reales**: registro con correo y nombre de usuario, verificación de correo obligatoria, sesiones, roles, recuperación de contraseña, bloqueo de 24 horas tras tres intentos fallidos, 2FA TOTP y códigos de recuperación.
- **Proyectos y archivos** en base de datos: crear, duplicar, renombrar, etiquetar, historial de cambios, versiones recuperables, exportar e importar en ZIP.
- **Editor** con resaltado para HTML, CSS, JavaScript, TypeScript, JSON y Markdown, autoguardado, consola de la vista previa y deshacer/rehacer.
- **Constructor visual** que escribe HTML real: paleta de bloques accesibles, arrastrar y soltar, edición de texto, clases y variables de diseño, biblioteca de bloques reutilizables por cuenta.
- **Plantillas** comerciales completas (negocio local, tienda, restaurante, blog, etc.) con estructura SEO.
- **Seo por proyecto**: dominio, plantilla de título, descripción, idioma, imagen social, Schema.org, `sitemap.xml`, `robots.txt` y análisis estático con enlaces rotos, encabezados, pesos y JSON-LD.
- **Analítica opcional**: GA4 con consentimiento previo; no se carga nada hasta que el visitante acepta.
- **Ejecución aislada** de scripts del proyecto con `bwrap` y límites de CPU, memoria, procesos, descriptores y tamaño de salida (solo Linux con bubblewrap).
- **Administración**: métricas, cuentas, sesiones e IPs, actividad, bloqueos, cuotas, correo pendiente, estado de servicios y documentación de la API.

## Tecnología

| Pieza | Uso |
| --- | --- |
| Vite + React 19 + TypeScript estricto | Interfaz completa con tipado en cliente y servidor. |
| Fastify 5 + `node:sqlite` | API y base de datos en un único proceso Node; la base es un fichero. |
| `@node-rs/argon2` | Hash de contraseñas con coste configurable. |
| `nodemailer` | Envío real de correo por SMTP. |
| `fflate` | Exportación e importación de proyectos en ZIP. |
| `bubblewrap` (bwrap) | Aislamiento de los scripts del proyecto en Linux. |

## Requisitos

- **Node.js 24 o superior** (`node:sqlite` estable). Comprueba con `node -v`.
- **npm 10 o superior** (viene con Node).
- **Git** para clonar el repositorio.
- **Opcional, Linux**: `bubblewrap` para ejecutar los scripts del proyecto con aislamiento. En Debian/Ubuntu/Kali: `sudo apt install bubblewrap`.
- **Opcional**: un proveedor SMTP si quieres que los correos salgan de verdad.

En macOS y Windows todo funciona excepto la ejecución aislada de scripts (la pantalla de Construcción lo dice y responde 503; no simula resultados). Para tener aislamiento, usa Linux o WSL2 con `bubblewrap`.

## Instalación paso a paso en Linux o macOS

### 1. Instala Node.js 24

Con [nvm](https://github.com/nvm-sh/nvm) (recomendado):

```bash
nvm install 24
nvm use 24
node -v
```

O descárgalo de [nodejs.org](https://nodejs.org/). Debe mostrar `v24.x.x` o superior.

### 2. Clona el repositorio

```bash
git clone https://github.com/Kuraykka/webforge.git
cd webforge
```

### 3. Instala las dependencias

```bash
npm install
```

### 4. Crea el archivo de entorno

```bash
cp .env.example .env
```

Genera un secreto largo y pégalo en `WEBFORGE_SESSION_SECRET` y en `WEBFORGE_ENV_KEY` dentro de `.env`:

```bash
openssl rand -base64 48
```

Si no defines `WEBFORGE_SESSION_SECRET`, cada reinicio invalida las sesiones y la clave de cifrado. En producción es obligatorio.

### 5. Crea la cuenta de administración

Sustituye el correo y la contraseña por los tuyos. La contraseña debe tener al menos 12 caracteres, con letras y números, y no puede ser igual al correo.

```bash
WEBFORGE_ADMIN_EMAIL="tu@correo.com" WEBFORGE_ADMIN_PASSWORD="UnaClaveLarga123" npm run seed:admin
```

Si omites `WEBFORGE_ADMIN_PASSWORD`, el comando genera una y la muestra **una sola vez**. La cuenta queda verificada: no necesita correo para entrar.

### 6. Arranca la aplicación

```bash
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) y entra con el correo y la contraseña del paso 5. La API escucha en `http://127.0.0.1:8787`; Vite hace de proxy para que todo sea un mismo origen.

### 7. Instala bubblewrap si quieres ejecuciones aisladas

```bash
sudo apt install bubblewrap      # Debian, Ubuntu, Kali
bwrap --version
```

Sin `bwrap`, la pantalla de Construcción mostrará «No hay aislamiento» y las ejecuciones responderán 503. Es intencionado: la plataforma no simula ejecuciones.

## Instalación paso a paso en Windows

Se usan PowerShell y Node.js 24. La ejecución aislada de scripts no está disponible en Windows; el resto de la plataforma sí.

### 1. Instala Node.js 24

Descárgalo de [nodejs.org](https://nodejs.org/) y comprueba en PowerShell:

```powershell
node -v
```

### 2. Clona el repositorio

```powershell
git clone https://github.com/Kuraykka/webforge.git
cd webforge
```

### 3. Instala las dependencias

```powershell
npm install
```

### 4. Crea el archivo de entorno

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Abre `.env` con el Bloc de notas y pega el valor generado en `WEBFORGE_SESSION_SECRET` y `WEBFORGE_ENV_KEY`.

### 5. Crea la cuenta de administración

```powershell
$env:WEBFORGE_ADMIN_EMAIL="tu@correo.com"
$env:WEBFORGE_ADMIN_PASSWORD="UnaClaveLarga123"
npm run seed:admin
```

La contraseña debe tener 12 caracteres o más, con letras y números. La cuenta queda verificada.

### 6. Arranca la aplicación

```powershell
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173). Para detener la aplicación, pulsa `Ctrl+C`.

### 7. Si quieres aislamiento real

Instala WSL2 con una distribución Linux y repite los pasos de Linux dentro de WSL, incluyendo `sudo apt install bubblewrap`. La carpeta del proyecto puede vivir en el sistema de archivos de Linux para ir más rápido.

## Configuración

Todas las variables se leen de `.env` (o del entorno del proceso). `.env` no se sube al repositorio.

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` o `test`. |
| `WEBFORGE_SESSION_SECRET` | temporal en desarrollo | Firma la cookie de sesión. Obligatoria en producción (mínimo 32 caracteres). |
| `WEBFORGE_ENV_KEY` | derivada de la sesión | Cifra en reposo las variables de entorno y el secreto TOTP. Usa una propia y fija. |
| `WEBFORGE_HOST` | `127.0.0.1` | Interfaz donde escucha la API. |
| `WEBFORGE_PORT` | `8787` | Puerto de la API. |
| `WEBFORGE_DB_PATH` | `data/webforge.sqlite` | Fichero SQLite. La carpeta se crea sola. |
| `WEBFORGE_SESSION_TTL_HOURS` | `12` | Duración de la sesión. |
| `WEBFORGE_SECURE_COOKIES` | `1` en producción | Fuerza cookies `Secure` (hace falta HTTPS). |
| `WEBFORGE_ALLOWED_ORIGINS` | vacío | Orígenes adicionales aceptados en mutaciones, separados por comas. |
| `WEBFORGE_ALLOW_REGISTRATION` | `1` en desarrollo | Valor inicial del auto-registro; se cambia desde el panel. |
| `WEBFORGE_ADMIN_EMAIL` / `WEBFORGE_ADMIN_PASSWORD` | vacío | Solo para `npm run seed:admin`. |
| `WEBFORGE_SMTP_URL` | vacío | URL SMTP con credenciales para enviar correo. |
| `WEBFORGE_MAIL_FROM` | `WebForge <no-reply@localhost>` | Remitente de los correos. |
| `WEBFORGE_PUBLIC_URL` | `http://localhost:5173` en desarrollo | Base de los enlaces de los correos. |
| `WEBFORGE_RUN_*` | valores discretos | Topes de la jaula: CPU, fichero, `/tmp`, tiempo real, salida, procesos, memoria y descriptores. |
| `WEBFORGE_JAULA_BIN` / `WEBFORGE_JAULA_RAIZ` | `bwrap` / carpeta temporal | Ejecutable y directorio de trabajo de las ejecuciones. |

## Crear tu cuenta

Ya tienes la cuenta de administración del paso 5. Para crear otra cuenta concreta (por ejemplo, la tuya con nombre de usuario):

```bash
WEBFORGE_USER_EMAIL="tu@correo.com" \
WEBFORGE_USER_PASSWORD="OtraClaveLarga123" \
WEBFORGE_USER_ROLE="admin" \
WEBFORGE_USER_USERNAME="tu-usuario" \
npm run create:user
```

- `WEBFORGE_USER_ROLE`: `user` o `admin`.
- `WEBFORGE_USER_USERNAME` es opcional; si no se indica, se deriva del correo.
- Si la cuenta ya existe, se asegura su rol y su correo verificado, pero **no se cambia la contraseña**. Para cambiarla desde el comando, añade `WEBFORGE_USER_RESET_PASSWORD=1` (decisión explícita).
- El comando nunca imprime la contraseña.

Después entra con el correo **o** con el nombre de usuario. Ambos sirven.

## Activar la verificación en dos pasos

1. Entra y abre **Ajustes**.
2. En «Verificación en dos pasos», pulsa **Configurar**.
3. Copia el secreto en tu aplicación de autenticación (Google Authenticator, Authy, 1Password…) o abre el enlace `otpauth://` que se muestra.
4. Escribe el código de 6 dígitos y pulsa **Activar**.
5. Guarda los **8 códigos de recuperación**: solo se muestran una vez. Cada uno sirve una sola vez si pierdes el teléfono.

Con el 2FA activo, el acceso pide la contraseña y después el código. Para desactivarlo hacen falta la contraseña y un código vigente. Si eres administrador, el panel muestra «sin 2FA» mientras no lo actives.

## Enviar correo de verdad (SMTP)

Sin SMTP, los correos no salen del servidor: los enlaces de verificación y recuperación quedan en **Administración → Bandeja de correo**, con su estado y la opción de reintentar cuando configures el proveedor. La aplicación nunca marca un mensaje como enviado si no lo está.

### Ejemplo con Gmail

1. Activa la verificación en dos pasos en tu cuenta de Google.
2. Crea una **contraseña de aplicación** (Cuenta de Google → Seguridad → Contraseñas de aplicaciones). No uses la contraseña normal de la cuenta.
3. En `.env`:

```env
WEBFORGE_SMTP_URL=smtps://tu-correo@gmail.com:la-contraseña-de-aplicación@smtp.gmail.com:465
WEBFORGE_MAIL_FROM=WebForge <tu-correo@gmail.com>
WEBFORGE_PUBLIC_URL=http://localhost:5173
```

Quita los espacios de la contraseña de aplicación. Si tu proveedor usa caracteres especiales en la contraseña (`@`, `:`, `/`), codifícalos en la URL (`@` → `%40`).

4. Reinicia la API (`npm run dev` no está en modo watch para el servidor).
5. Prueba con un registro o con «¿No recuerdas la contraseña?». El mensaje debe pasar a «enviado»; si falla, la bandeja muestra el error del proveedor.

## Ejecutar en desarrollo

```bash
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://127.0.0.1:8787](http://127.0.0.1:8787) (Vite la proxya en `/api`).
- La API **no está en modo watch**: si cambias algo en `server/`, reinicia el comando.

Comandos útiles:

```bash
npm run typecheck    # TypeScript estricto en cliente y servidor
npm test             # pruebas
npm run build        # typecheck + bundle de producción en dist/
```

## Compilar y ejecutar en producción

```bash
npm run build
```

En producción el mismo proceso sirve la API y el contenido de `dist/`:

```bash
NODE_ENV=production \
WEBFORGE_SESSION_SECRET="..." \
WEBFORGE_ENV_KEY="..." \
WEBFORGE_DB_PATH="/var/lib/webforge/webforge.sqlite" \
WEBFORGE_PUBLIC_URL="https://tu-dominio.example" \
npm start
```

Pon un proxy HTTPS delante (Caddy, nginx, Traefik) y no expongas el puerto 8787 directamente. Ejemplo mínimo con Caddy:

```caddyfile
tu-dominio.example {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy obtiene el certificado TLS automáticamente. La aplicación no integra ningún proveedor de hosting ni botón de despliegue: no existe un destino real al que publicar, así que no se simula.

## Copias de seguridad

La base de datos es un fichero. Para una copia consistente, detén la aplicación y copia `data/webforge.sqlite` (junto con `-wal` y `-shm` si existen). También puedes usar:

```bash
sqlite3 data/webforge.sqlite ".backup 'copia-webforge.sqlite'"
```

El archivo `.env` y la base de datos nunca deben subirse al repositorio: `.gitignore` ya los excluye.

## Pruebas y verificación

```bash
npm test
npm run typecheck
npm run build
```

La suite cubre reglas de negocio, rutas HTTP, seguridad, componentes y flujos del editor. Última pasada: **95 ficheros, 1244 pruebas superadas y 1 omitida** (la prueba real de aislamiento se salta donde no hay `bwrap`).

## Estructura del proyecto

```
shared/                  reglas compartidas (rutas de archivo, plantillas, SEO, analítica, usuario)
src/                     interfaz React
  features/auth/         acceso, registro, verificación, 2FA
  features/editor/       editor, vista previa, consola
  features/builder/      constructor visual y biblioteca de bloques
  features/projects/     proyectos, versiones, variables, SEO, analítica
  features/admin/        panel de administración
  pages/                 pantallas
server/                  API Fastify
  auth/                  argon2, sesiones, intentos, tokens, TOTP, SMTP
  repositories/          acceso a datos SQL
  routes/                endpoints
  run/                   jaula de ejecución con bwrap
  db.ts                  migraciones y SQLite
data/                    base de datos local (no se sube)
```

## API

La documentación completa está en la propia aplicación: `/api/docs/openapi` y la pantalla **Documentación**. Resumen:

- `POST /api/auth/register|login|login/2fa|logout|password|verify-email|password/reset...`, `GET /api/auth/session|2fa`, `POST /api/auth/2fa/setup|confirm|disable`.
- `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id`, duplicar, historial.
- Archivos, versiones recuperables, variables de entorno, exportar/importar ZIP.
- `GET|PUT /api/projects/:id/seo`, `POST /api/projects/:id/seo/generar|.../analisis`.
- `GET|PUT /api/projects/:id/analitica`, `POST /api/projects/:id/analitica/generar`.
- Bloques reutilizables, búsqueda global, ejecuciones aisladas.
- Administración: cuentas, cuotas, métricas, actividad, bandeja de correo, estado de servicios.

## Seguridad

- Contraseñas con Argon2id; nunca se guardan ni se registran en claro.
- Cookie de sesión firmada, `HttpOnly`, `SameSite=Strict`; mutaciones con cabecera anti-CSRF y comprobación de origen.
- Roles y permisos comprobados en el servidor; ocultar un botón no autoriza nada.
- Verificación de correo obligatoria (enlace de tres minutos con reenvío) y bloqueo de 24 horas tras tres intentos fallidos.
- 2FA TOTP con secreto cifrado y códigos de recuperación de un solo uso.
- Variables de entorno y secretos TOTP cifrados en reposo con AES-256-GCM.
- Ejecución de scripts en `bwrap` sin red, sin acceso al host y con límites de CPU, memoria, procesos, descriptores, ficheros y tiempo.
- Registro de IP, agente y resultado de cada intento de acceso, visible para administración.
- Sin secretos en el repositorio: `.env`, `data/`, `node_modules/` y `dist/` están excluidos.

## Límites conocidos

- **No hay hosting ni despliegue integrado**: no existen destinos reales, dominios ni proveedores configurados, y no se simulan.
- **No se pueden instalar dependencias** dentro del proyecto: la jaula va sin red y no hay almacén de paquetes propio.
- **No hay terminal arbitrario ni backend desplegado**: solo se ejecutan las recetas declaradas por el servidor y la vista previa es estática.
- **Aislamiento**: `bwrap` en Linux. En macOS/Windows no hay ejecución aislada; la interfaz lo indica. No se usa Docker porque este entorno no ofrece demonio/cgroups sin privilegios.
- **Correo externo**: requiere configurar SMTP. Sin proveedor, los enlaces quedan en la bandeja local.
- **2FA**: disponible y exigido al entrar en cuanto se activa, pero no obligatorio por política; el panel marca las cuentas de administración sin 2FA.
- **Bundle del editor**: CodeMirror viaja en un módulo aparte de ~672 kB (229 kB gzip) que solo se descarga al abrir el editor.

## Créditos y licencia

Creado por **Kuraykka** — [github.com/Kuraykka](https://github.com/Kuraykka).

Puedes usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y vender el software, incluso con fines comerciales, siempre que **conserves el aviso de copyright y la licencia** en las copias o partes sustanciales. Es decir: úsalo libremente y mantén el crédito.

Licencia **MIT**: consulta [LICENSE](LICENSE). Si construyes algo sobre WebForge, se agradece un enlace al [repositorio](https://github.com/Kuraykka/webforge).
