import { DatabaseSync } from "node:sqlite";

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Única puerta a node:sqlite. El resto del servidor solo conoce esta interfaz,
 * así que cambiar de conductor (o cifrar el almacén) afecta a un solo fichero.
 */
export interface Sql {
  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined;
  run(sql: string, ...params: SqlParam[]): RunResult;
  exec(sql: string): void;
  transaction<T>(work: () => T): T;
  close(): void;
}

interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "identidad",
    sql: `
      create table users (
        id text primary key,
        email text not null,
        password_hash text not null,
        role text not null check (role in ('admin', 'user')),
        status text not null check (status in ('activa', 'suspendida')),
        created_at text not null,
        updated_at text not null,
        verified_at text,
        password_updated_at text not null,
        last_login_at text
      );
      create unique index users_email_lower on users (lower(email));

      create table sessions (
        id text primary key,
        token_hash text not null unique,
        user_id text not null references users (id) on delete cascade,
        created_at text not null,
        last_seen_at text not null,
        expires_at text not null,
        revoked_at text,
        user_agent text not null,
        ip text not null
      );
      create index sessions_user on sessions (user_id, revoked_at);

      create table login_attempts (
        key text primary key,
        failures integer not null,
        window_started_at text not null,
        locked_until text,
        updated_at text not null
      );

      create table email_tokens (
        id text primary key,
        user_id text not null references users (id) on delete cascade,
        purpose text not null check (purpose in ('verificacion', 'restablecimiento')),
        token_hash text not null unique,
        created_at text not null,
        expires_at text not null,
        used_at text
      );

      create table outbox_messages (
        id text primary key,
        recipient text not null,
        subject text not null,
        body text not null,
        action_url text not null,
        created_at text not null,
        sent_at text
      );

      create table settings (
        key text primary key,
        value text not null,
        updated_at text not null
      );

      create table auth_factors (
        id text primary key,
        user_id text not null references users (id) on delete cascade,
        kind text not null check (kind in ('totp')),
        secret_ciphertext text not null,
        created_at text not null,
        verified_at text,
        revoked_at text
      );
      create index auth_factors_user on auth_factors (user_id);
    `
  },
  {
    id: 2,
    name: "proyectos",
    sql: `
      create table projects (
        id text primary key,
        owner_user_id text not null references users (id) on delete cascade,
        name text not null,
        description text not null default '',
        folder text not null default '',
        tags text not null default '[]',
        stack text not null,
        status text not null check (status in ('borrador', 'en_desarrollo', 'listo')),
        created_at text not null,
        updated_at text not null,
        deleted_at text
      );
      create index projects_owner on projects (owner_user_id, deleted_at);

      create table project_files (
        project_id text not null references projects (id) on delete cascade,
        path text not null,
        content text not null,
        bytes integer not null,
        updated_at text not null,
        primary key (project_id, path)
      );

      create table project_history (
        id text primary key,
        project_id text not null references projects (id) on delete cascade,
        action text not null,
        at text not null
      );
      create index project_history_project on project_history (project_id, at);
    `
  },
  {
    id: 3,
    name: "administracion",
    // admin_events se queda sin clave foránea a propósito: el rastro de lo que hizo la
    // administración tiene que poder leerse aunque el actor o el objetivo ya no existan.
    sql: `
      create table admin_events (
        id text primary key,
        actor_user_id text not null,
        actor_email text not null,
        action text not null,
        target_user_id text,
        detail text,
        at text not null
      );
      create index admin_events_at on admin_events (at desc);
    `
  },
  {
    id: 4,
    name: "versiones",
    // El contenido va en la propia fila: una versión es un estado recuperable del proyecto,
    // no un puntero a los archivos de hoy, que seguirían cambiando.
    sql: `
      create table project_versions (
        id text primary key,
        project_id text not null references projects (id) on delete cascade,
        label text not null,
        files text not null,
        bytes integer not null,
        file_count integer not null,
        created_at text not null
      );
      create index project_versions_project on project_versions (project_id, created_at desc);
    `
  },
  {
    id: 5,
    name: "variables",
    // El valor se guarda en claro y nunca sale por la lista: cifrarlo en reposo queda en la
    // Fase 9, donde la clave puede venir de un almacén persistente y no de la sesión.
    sql: `
      create table project_env (
        id text primary key,
        project_id text not null references projects (id) on delete cascade,
        environment text not null check (environment in ('desarrollo', 'produccion')),
        key text not null,
        value text not null,
        bytes integer not null,
        created_at text not null,
        updated_at text not null
      );
      create unique index project_env_slot on project_env (project_id, environment, key);
    `
  },
  {
    id: 6,
    name: "componentes",
    // La biblioteca es por cuenta, no por proyecto: reutilizar el mismo bloque en varios
    // proyectos es precisamente el caso de uso. El índice único va sobre `lower(name)`
    // porque «Tarjeta» y «tarjeta» son el mismo bloque para quien lo busca en la paleta.
    sql: `
      create table user_components (
        id text primary key,
        owner_user_id text not null references users (id) on delete cascade,
        name text not null,
        html text not null,
        bytes integer not null,
        created_at text not null,
        updated_at text not null
      );
      create unique index user_components_nombre on user_components (owner_user_id, lower(name));
      create index user_components_owner on user_components (owner_user_id);
    `
  },
  {
    id: 7,
    name: "bloque_estilos",
    // Un bloque reutilizable sin sus reglas solo trae las clases puestas: en otro proyecto el
    // `<h1 class="wf-e1">` saldría negro. Se guardan las declaraciones de las clases de estilo
    // del constructor, nunca un CSS crudo, para que insertarlo no pueda reescribir otra regla.
    sql: `
      alter table user_components add column styles text not null default '[]';
    `
  },
  {
    id: 8,
    name: "ejecuciones",
    // El registro de una ejecución es salida de un proceso ajeno: puede ser enorme y repetitivo,
    // así que se guarda comprimido y con un tope de filas por proyecto. `estado` deja claro si
    // sigue corriendo: un proyecto solo admite una abierta, y eso es lo que revisa la ruta.
    sql: `
      create table project_runs (
        id text primary key,
        project_id text not null references projects (id) on delete cascade,
        owner_user_id text not null references users (id) on delete cascade,
        tipo text not null,
        archivo text,
        estado text not null check (estado in ('corriendo', 'terminada', 'fallida', 'cancelada')),
        codigo integer,
        senal text,
        ms integer,
        salida_bytes integer not null default 0,
        truncado integer not null default 0,
        log blob,
        creada_en text not null,
        terminada_en text
      );
      create index project_runs_proyecto on project_runs (project_id, creada_en desc);
      create unique index project_runs_abierta on project_runs (project_id) where estado = 'corriendo';
    `
  },
  {
    id: 9,
    name: "verificacion_previas",
    // A partir de aquí ninguna cuenta entra sin confirmar su correo. Las cuentas que ya existían se
    // dan por verificadas: nunca recibieron un enlace y dejarlas fuera habría cerrado la plataforma
    // para quien ya trabajaba. Es un pase único; las cuentas nuevas nacen sin verificar.
    sql: `
      update users set verified_at = created_at where verified_at is null;
    `
  },
  {
    id: 10,
    name: "seo",
    // Una fila por proyecto, escrita solo cuando alguien guarda ajustes: sin fila, `readSeo`
    // devuelve los valores de partida y la base no acumula configuraciones vacías.
    sql: `
      create table project_seo (
        project_id text primary key references projects (id) on delete cascade,
        site_url text not null default '',
        title_template text not null default '%s',
        description text not null default '',
        language text not null default 'es',
        og_image text not null default '',
        schema_type text not null default 'WebSite',
        noindex integer not null default 0,
        sitemap integer not null default 1,
        robots_extra text not null default '',
        created_at text not null,
        updated_at text not null
      );
    `
  },
  {
    id: 11,
    name: "analitica",
    // Solo GA4 y solo con consentimiento: la tabla guarda la configuración, nunca datos de visitas
    // (no hay credenciales de la API de datos y la plataforma no los inventa).
    sql: `
      create table project_analytics (
        project_id text primary key references projects (id) on delete cascade,
        enabled integer not null default 0,
        measurement_id text not null default '',
        track_cta integer not null default 1,
        track_forms integer not null default 1,
        thank_you_paths text not null default '',
        updated_at text not null
      );
    `
  },
  {
    id: 12,
    name: "usuario_2fa_actividad",
    // Nombre de usuario, segundo factor TOTP, desafíos de acceso y registro de IPs/resultados.
    // El secreto TOTP se guarda cifrado; los códigos de recuperación, solo como digesto.
    sql: `
      alter table users add column username text;
      create unique index users_username_lower on users (lower(username)) where username is not null;

      create table user_totp (
        user_id text primary key references users (id) on delete cascade,
        secret text not null,
        confirmed_at text,
        created_at text not null
      );

      create table user_recovery_codes (
        user_id text not null references users (id) on delete cascade,
        code_hash text not null,
        used_at text,
        primary key (user_id, code_hash)
      );

      create table login_challenges (
        id text primary key,
        user_id text not null references users (id) on delete cascade,
        token_hash text not null unique,
        created_at text not null,
        expires_at text not null,
        used_at text
      );

      create table login_events (
        id text primary key,
        user_id text references users (id) on delete set null,
        identifier text not null,
        ip text not null,
        user_agent text not null,
        result text not null,
        at text not null
      );
      create index login_events_user on login_events (user_id, at desc);

      alter table outbox_messages add column attempted_at text;
      alter table outbox_messages add column error text;
    `
  }
];

class Sqlite implements Sql {
  private readonly database: DatabaseSync;
  private readonly statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  private depth = 0;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  private statement(sql: string): ReturnType<DatabaseSync["prepare"]> {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.database.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  all<T>(sql: string, ...params: SqlParam[]): T[] {
    return this.statement(sql).all(...params) as T[];
  }

  get<T>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const result = this.statement(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  transaction<T>(work: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return work();
      } finally {
        this.depth -= 1;
      }
    }
    this.database.exec("begin");
    this.depth = 1;
    try {
      const result = work();
      this.database.exec("commit");
      return result;
    } catch (cause) {
      this.database.exec("rollback");
      throw cause;
    } finally {
      this.depth = 0;
    }
  }

  close(): void {
    this.statements.clear();
    this.database.close();
  }
}

export function openDatabase(path: string): Sql {
  const database = new DatabaseSync(path);
  database.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  return new Sqlite(database);
}

export function appliedMigrations(db: Sql): number[] {
  return db
    .all<{ id: number }>("select id from schema_migrations order by id")
    .map((row) => Number(row.id));
}

/** Aplica las migraciones pendientes. Cada una va en su propia transacción. */
export function migrate(db: Sql): number[] {
  db.exec(
    "create table if not exists schema_migrations (id integer primary key, name text not null, applied_at text not null)"
  );
  const done = new Set(appliedMigrations(db).map((id) => String(id)));
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(String(migration.id))) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.run(
        "insert into schema_migrations (id, name, applied_at) values (?, ?, ?)",
        migration.id,
        migration.name,
        new Date().toISOString()
      );
    });
    applied.push(migration.id);
  }
  return applied;
}

export function readSetting(db: Sql, key: string): string | undefined {
  return db.get<{ value: string }>("select value from settings where key = ?", key)?.value;
}

export function writeSetting(db: Sql, key: string, value: string, now = new Date().toISOString()): void {
  db.run(
    `insert into settings (key, value, updated_at) values (?, ?, ?)
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    now
  );
}

/** Escribe los valores iniciales solo si la clave aún no existe. */
export function seedSetting(db: Sql, key: string, value: string, now = new Date().toISOString()): void {
  db.run("insert or ignore into settings (key, value, updated_at) values (?, ?, ?)", key, value, now);
}
