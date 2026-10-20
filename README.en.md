# WebForge

[Español](README.md) · [English](README.en.md)

WebForge is a platform for building websites from the browser: code editor, visual builder, live preview, templates, SEO, consent-based analytics and account administration. Everything runs on a single Node server with a SQLite database and no mandatory external services.

Created by [Kuraykka](https://github.com/Kuraykka). Repository: [github.com/Kuraykka/webforge](https://github.com/Kuraykka/webforge).

## Contents

1. [What's included](#whats-included)
2. [Tech stack](#tech-stack)
3. [Requirements](#requirements)
4. [Step-by-step install on Linux or macOS](#step-by-step-install-on-linux-or-macos)
5. [Step-by-step install on Windows](#step-by-step-install-on-windows)
6. [Configuration](#configuration)
7. [Create your account](#create-your-account)
8. [Enable two-factor authentication](#enable-two-factor-authentication)
9. [Send real email (SMTP)](#send-real-email-smtp)
10. [Run in development](#run-in-development)
11. [Build and run in production](#build-and-run-in-production)
12. [Backups](#backups)
13. [Tests and verification](#tests-and-verification)
14. [Project structure](#project-structure)
15. [API](#api)
16. [Security](#security)
17. [Known limits](#known-limits)
18. [Credits and license](#credits-and-license)

## What's included

- **Real accounts**: sign-up with email and username, mandatory email verification, sessions, roles, password recovery, a 24-hour lock after three failed attempts, TOTP 2FA and recovery codes.
- **Projects and files** in a database: create, duplicate, rename, tag, change history, restorable versions, export and import as ZIP.
- **Editor** with syntax highlighting for HTML, CSS, JavaScript, TypeScript, JSON and Markdown, autosave, preview console and undo/redo.
- **Visual builder** that writes real HTML: accessible block palette, drag and drop, text editing, classes and design tokens, per-account reusable block library.
- **Templates**: complete commercial templates (local business, store, restaurant, blog…) with SEO structure.
- **Per-project SEO**: domain, title template, description, language, social image, Schema.org, `sitemap.xml`, `robots.txt` and a static analysis with broken links, headings, weights and JSON-LD.
- **Optional analytics**: GA4 with prior consent; nothing loads until the visitor accepts.
- **Isolated execution** of project scripts with `bwrap` and limits on CPU, memory, processes, file descriptors and output size (Linux with bubblewrap only).
- **Administration**: metrics, accounts, sessions and IPs, activity, account locks, quotas, pending email, service status and API docs.

## Tech stack

| Piece | Purpose |
| --- | --- |
| Vite + React 19 + strict TypeScript | Full UI with typed client and server. |
| Fastify 5 + `node:sqlite` | API and database in a single Node process; the database is a file. |
| `@node-rs/argon2` | Password hashing with configurable cost. |
| `nodemailer` | Real email delivery over SMTP. |
| `fflate` | Project export and import as ZIP. |
| `bubblewrap` (bwrap) | Isolation for project scripts on Linux. |

## Requirements

- **Node.js 24 or newer** (`node:sqlite` stable). Check with `node -v`.
- **npm 10 or newer** (bundled with Node).
- **Git** to clone the repository.
- **Optional, Linux**: `bubblewrap` to run project scripts with isolation. On Debian/Ubuntu/Kali: `sudo apt install bubblewrap`.
- **Optional**: an SMTP provider if you want email to actually leave the server.

On macOS and Windows everything works except isolated script execution (the Builds screen says so and returns 503; it never fakes results). For isolation, use Linux or WSL2 with `bubblewrap`.

## Step-by-step install on Linux or macOS

### 1. Install Node.js 24

With [nvm](https://github.com/nvm-sh/nvm) (recommended):

```bash
nvm install 24
nvm use 24
node -v
```

Or download it from [nodejs.org](https://nodejs.org/). It must print `v24.x.x` or newer.

### 2. Clone the repository

```bash
git clone https://github.com/Kuraykka/webforge.git
cd webforge
```

### 3. Install dependencies

```bash
npm install
```

### 4. Create the environment file

```bash
cp .env.example .env
```

Generate a long secret and paste it into `WEBFORGE_SESSION_SECRET` and `WEBFORGE_ENV_KEY` inside `.env`:

```bash
openssl rand -base64 48
```

If you leave `WEBFORGE_SESSION_SECRET` unset, every restart invalidates sessions and the encryption key. In production it is mandatory.

### 5. Create the administrator account

Replace the email and password with your own. The password needs at least 12 characters, letters and numbers, and cannot equal the email.

```bash
WEBFORGE_ADMIN_EMAIL="you@example.com" WEBFORGE_ADMIN_PASSWORD="ALongPassword123" npm run seed:admin
```

If you omit `WEBFORGE_ADMIN_PASSWORD`, the command generates one and prints it **once**. The account is created verified: no email is needed to sign in.

### 6. Start the application

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and sign in with the email and password from step 5. The API listens on `http://127.0.0.1:8787`; Vite proxies it so everything shares one origin.

### 7. Install bubblewrap if you want isolated runs

```bash
sudo apt install bubblewrap      # Debian, Ubuntu, Kali
bwrap --version
```

Without `bwrap`, the Builds screen shows "No isolation" and runs return 503. That is intentional: the platform never fakes execution.

## Step-by-step install on Windows

PowerShell and Node.js 24 are used. Isolated script execution is not available on Windows; the rest of the platform is.

### 1. Install Node.js 24

Download it from [nodejs.org](https://nodejs.org/) and check in PowerShell:

```powershell
node -v
```

### 2. Clone the repository

```powershell
git clone https://github.com/Kuraykka/webforge.git
cd webforge
```

### 3. Install dependencies

```powershell
npm install
```

### 4. Create the environment file

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Open `.env` in Notepad and paste the generated value into `WEBFORGE_SESSION_SECRET` and `WEBFORGE_ENV_KEY`.

### 5. Create the administrator account

```powershell
$env:WEBFORGE_ADMIN_EMAIL="you@example.com"
$env:WEBFORGE_ADMIN_PASSWORD="ALongPassword123"
npm run seed:admin
```

The password needs 12 characters or more, with letters and numbers. The account is created verified.

### 6. Start the application

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Press `Ctrl+C` to stop it.

### 7. If you want real isolation

Install WSL2 with a Linux distribution and repeat the Linux steps inside WSL, including `sudo apt install bubblewrap`. Keeping the project folder on the Linux filesystem is faster.

## Configuration

Every variable is read from `.env` (or the process environment). `.env` is never pushed to the repository.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` or `test`. |
| `WEBFORGE_SESSION_SECRET` | temporary in development | Signs the session cookie. Required in production (32+ characters). |
| `WEBFORGE_ENV_KEY` | derived from the session secret | Encrypts environment variables and the TOTP secret at rest. Use a fixed key of your own. |
| `WEBFORGE_HOST` | `127.0.0.1` | Interface the API listens on. |
| `WEBFORGE_PORT` | `8787` | API port. |
| `WEBFORGE_DB_PATH` | `data/webforge.sqlite` | SQLite file. Its folder is created automatically. |
| `WEBFORGE_SESSION_TTL_HOURS` | `12` | Session lifetime. |
| `WEBFORGE_SECURE_COOKIES` | `1` in production | Forces `Secure` cookies (HTTPS required). |
| `WEBFORGE_ALLOWED_ORIGINS` | empty | Extra origins accepted for mutations, comma-separated. |
| `WEBFORGE_ALLOW_REGISTRATION` | `1` in development | Initial self-registration value; change it from the admin panel. |
| `WEBFORGE_ADMIN_EMAIL` / `WEBFORGE_ADMIN_PASSWORD` | empty | Only for `npm run seed:admin`. |
| `WEBFORGE_SMTP_URL` | empty | SMTP URL with credentials for sending email. |
| `WEBFORGE_MAIL_FROM` | `WebForge <no-reply@localhost>` | Sender address. |
| `WEBFORGE_PUBLIC_URL` | `http://localhost:5173` in development | Base URL for links inside emails. |
| `WEBFORGE_RUN_*` | conservative values | Sandbox limits: CPU, file size, `/tmp`, wall clock, output, processes, memory and file descriptors. |
| `WEBFORGE_JAULA_BIN` / `WEBFORGE_JAULA_RAIZ` | `bwrap` / temp folder | Execution binary and working directory. |

## Create your account

You already have the administrator account from step 5. To create another specific account (for example, yours with a username):

```bash
WEBFORGE_USER_EMAIL="you@example.com" \
WEBFORGE_USER_PASSWORD="AnotherLongPassword123" \
WEBFORGE_USER_ROLE="admin" \
WEBFORGE_USER_USERNAME="your-username" \
npm run create:user
```

- `WEBFORGE_USER_ROLE`: `user` or `admin`.
- `WEBFORGE_USER_USERNAME` is optional; if omitted, it is derived from the email.
- If the account already exists, its role and verified email are enforced, but **its password is not changed**. To change it from the command, add `WEBFORGE_USER_RESET_PASSWORD=1` (an explicit decision).
- The command never prints the password.

You can then sign in with the email **or** the username. Both work.

## Enable two-factor authentication

1. Sign in and open **Settings**.
2. In "Two-factor authentication", press **Set up**.
3. Copy the secret into your authenticator app (Google Authenticator, Authy, 1Password…) or open the `otpauth://` link shown.
4. Enter the 6-digit code and press **Enable**.
5. Save the **8 recovery codes**: they are shown only once, and each one works only once if you lose your phone.

With 2FA enabled, sign-in asks for the password and then the code. Disabling it requires the password and a valid code. For administrators, the panel shows "no 2FA" until it is enabled.

## Send real email (SMTP)

Without SMTP, email does not leave the server: verification and recovery links stay in **Administration → Mailbox**, with their status and a retry option once the provider is configured. The app never marks a message as sent when it is not.

### Gmail example

1. Turn on two-step verification for your Google account.
2. Create an **app password** (Google Account → Security → App passwords). Do not use the account password.
3. In `.env`:

```env
WEBFORGE_SMTP_URL=smtps://your-address@gmail.com:the-app-password@smtp.gmail.com:465
WEBFORGE_MAIL_FROM=WebForge <your-address@gmail.com>
WEBFORGE_PUBLIC_URL=http://localhost:5173
```

Remove the spaces from the app password. If your provider uses special characters in the password (`@`, `:`, `/`), URL-encode them (`@` → `%40`).

4. Restart the API (`npm run dev` does not watch the server).
5. Test with a sign-up or with "Forgot your password?". The message should become "sent"; if it fails, the mailbox shows the provider error.

## Run in development

```bash
npm run dev
```

- Web: [http://localhost:5173](http://localhost:5173)
- API: [http://127.0.0.1:8787](http://127.0.0.1:8787) (Vite proxies it under `/api`).
- The API is **not in watch mode**: if you change anything under `server/`, restart the command.

Useful commands:

```bash
npm run typecheck    # strict TypeScript for client and server
npm test             # tests
npm run build        # typecheck + production bundle in dist/
```

## Build and run in production

```bash
npm run build
```

In production the same process serves the API and the contents of `dist/`:

```bash
NODE_ENV=production \
WEBFORGE_SESSION_SECRET="..." \
WEBFORGE_ENV_KEY="..." \
WEBFORGE_DB_PATH="/var/lib/webforge/webforge.sqlite" \
WEBFORGE_PUBLIC_URL="https://your-domain.example" \
npm start
```

Put an HTTPS reverse proxy in front (Caddy, nginx, Traefik) and do not expose port 8787 directly. Minimal Caddy example:

```caddyfile
your-domain.example {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy obtains the TLS certificate automatically. The app does not integrate any hosting provider or deploy button: there is no real destination to publish to, so it is not simulated.

## Backups

The database is a single file. For a consistent backup, stop the app and copy `data/webforge.sqlite` (together with `-wal` and `-shm` if present). You can also use:

```bash
sqlite3 data/webforge.sqlite ".backup 'webforge-backup.sqlite'"
```

The `.env` file and the database must never be pushed to the repository: `.gitignore` already excludes them.

## Tests and verification

```bash
npm test
npm run typecheck
npm run build
```

The suite covers business rules, HTTP routes, security, components and editor flows. Last run: **95 files, 1244 passing tests and 1 skipped** (the real isolation test is skipped where `bwrap` is unavailable).

## Project structure

```
shared/                  shared rules (file paths, templates, SEO, analytics, usernames)
src/                     React interface
  features/auth/         sign-in, sign-up, verification, 2FA
  features/editor/       editor, preview, console
  features/builder/      visual builder and block library
  features/projects/     projects, versions, environment, SEO, analytics
  features/admin/        administration panel
  pages/                 screens
server/                  Fastify API
  auth/                  argon2, sessions, attempts, tokens, TOTP, SMTP
  repositories/          SQL data access
  routes/                endpoints
  run/                   bwrap execution sandbox
  db.ts                  migrations and SQLite
data/                    local database (not committed)
```

## API

Full documentation ships with the app: `/api/docs/openapi` and the **Documentation** screen. Summary:

- `POST /api/auth/register|login|login/2fa|logout|password|verify-email|password/reset...`, `GET /api/auth/session|2fa`, `POST /api/auth/2fa/setup|confirm|disable`.
- `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id`, duplicate, history.
- Files, restorable versions, environment variables, ZIP export/import.
- `GET|PUT /api/projects/:id/seo`, `POST /api/projects/:id/seo/generar|.../analisis`.
- `GET|PUT /api/projects/:id/analitica`, `POST /api/projects/:id/analitica/generar`.
- Reusable blocks, global search, isolated runs.
- Administration: accounts, quotas, metrics, activity, mailbox, service status.

## Security

- Argon2id password hashing; passwords are never stored or logged in plain text.
- Signed, `HttpOnly`, `SameSite=Strict` session cookie; mutations require an anti-CSRF header and an origin check.
- Roles and permissions enforced on the server; hiding a button authorizes nothing.
- Mandatory email verification (three-minute link with resend) and a 24-hour lock after three failed attempts.
- TOTP 2FA with an encrypted secret and single-use recovery codes.
- Environment variables and TOTP secrets encrypted at rest with AES-256-GCM.
- Scripts run in `bwrap` without network or host access, with CPU, memory, process, descriptor, file and time limits.
- IP, user agent and result recorded for every sign-in attempt, visible to administrators.
- No secrets in the repository: `.env`, `data/`, `node_modules/` and `dist/` are excluded.

## Known limits

- **No built-in hosting or deployment**: there are no real destinations, domains or configured providers, and none are simulated.
- **Dependencies cannot be installed** inside the project: the sandbox has no network and there is no package store.
- **No arbitrary terminal or deployed backend**: only server-declared recipes run, and the preview is static.
- **Isolation**: `bwrap` on Linux. macOS/Windows have no isolated execution; the UI says so. Docker is not used because this environment offers no daemon/cgroups without privileges.
- **External email**: requires SMTP. Without a provider, links stay in the local mailbox.
- **2FA**: available and required at sign-in as soon as it is enabled, but not mandatory by policy; the panel flags administrator accounts without it.
- **Editor bundle**: CodeMirror ships in a separate ~672 kB module (229 kB gzip) only downloaded when the editor opens.

## Credits and license

Created by **Kuraykka** — [github.com/Kuraykka](https://github.com/Kuraykka).

You may use, copy, modify, merge, publish, distribute, sublicense and sell the software, including commercially, as long as you **keep the copyright notice and license** in copies or substantial portions. In short: use it freely and keep the credit.

**MIT License**: see [LICENSE](LICENSE). If you build on WebForge, a link to the [repository](https://github.com/Kuraykka/webforge) is appreciated.
