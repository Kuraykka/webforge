import type { Sql } from "../db.ts";
import { lockStates } from "../auth/attempts.ts";
import { enabledAnalyticsProjects } from "./analytics.ts";
import type { ProjectStatus } from "./projects.ts";
import { normalizeEmail, type UserRole, type UserStatus, type UserSummary } from "./users.ts";

export interface AccountUsage {
  projects: number;
  files: number;
  bytes: number;
}

export interface AdminAccount extends UserSummary {
  projects: number;
  files: number;
  bytes: number;
  /** Hasta cuándo está cerrada la cuenta por intentos fallidos; nulo si puede intentar entrar. */
  lockedUntil: string | null;
  /** Fallos contados en la ventana vigente. */
  failedAttempts: number;
}

export interface PlatformMetrics {
  accounts: { total: number; admins: number; suspended: number; verified: number };
  projects: { total: number; byStatus: Record<ProjectStatus, number> };
  files: { total: number; bytes: number };
  sessions: { active: number };
  activity: { events: number };
  analytics: { enabledProjects: number };
}

const LIVE = "deleted_at is null";
const STATUSES: ProjectStatus[] = ["borrador", "en_desarrollo", "listo"];

function total(db: Sql, sql: string, ...params: (string | number)[]): number {
  return Number(db.get<{ total: number | bigint }>(sql, ...params)?.total ?? 0);
}

interface UserRowLite {
  id: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  password_updated_at: string;
  last_login_at: string | null;
  totp: number;
}

/** Uso agregado de una cuenta: solo cuenta los proyectos que siguen vivos. */
export function accountUsage(db: Sql, userId: string): AccountUsage {
  const projects = total(db, `select count(*) as total from projects where owner_user_id = ? and ${LIVE}`, userId);
  const content = db.get<{ files: number | bigint; bytes: number | bigint }>(
    `select count(f.path) as files, coalesce(sum(f.bytes), 0) as bytes
       from project_files f join projects p on p.id = f.project_id
      where p.owner_user_id = ? and p.${LIVE}`,
    userId
  );
  return { projects, files: Number(content?.files ?? 0), bytes: Number(content?.bytes ?? 0) };
}

export function listAccountsWithUsage(db: Sql, now = Date.now()): AdminAccount[] {
  const locks = lockStates(db, now);
  return db
    .all<UserRowLite>(
      `select users.*, (select count(*) from user_totp t where t.user_id = users.id and t.confirmed_at is not null) as totp
         from users order by created_at desc, rowid desc`
    )
    .map((row) => {
      const lock = locks.get(normalizeEmail(row.email));
      return {
        id: row.id,
        email: row.email,
        username: row.username,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        verifiedAt: row.verified_at,
        lastLoginAt: row.last_login_at,
        lockedUntil: lock?.lockedUntil ?? null,
        failedAttempts: lock?.failures ?? 0,
        twoFactorEnabled: Number(row.totp) > 0,
        ...accountUsage(db, row.id)
      };
    });
}

export function platformMetrics(db: Sql, now = new Date().toISOString()): PlatformMetrics {
  const counts = new Map(
    db
      .all<{ status: ProjectStatus; total: number | bigint }>(
        `select status, count(*) as total from projects where ${LIVE} group by status`
      )
      .map((row) => [row.status, Number(row.total)] as const)
  );
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, counts.get(status) ?? 0])) as Record<
    ProjectStatus,
    number
  >;

  return {
    accounts: {
      total: total(db, "select count(*) as total from users"),
      admins: total(db, "select count(*) as total from users where role = 'admin'"),
      suspended: total(db, "select count(*) as total from users where status = 'suspendida'"),
      verified: total(db, "select count(*) as total from users where verified_at is not null")
    },
    projects: {
      total: total(db, `select count(*) as total from projects where ${LIVE}`),
      byStatus
    },
    files: {
      total: total(
        db,
        `select count(*) as total from project_files f join projects p on p.id = f.project_id where p.${LIVE}`
      ),
      bytes: Number(
        db.get<{ total: number | bigint }>(
          `select coalesce(sum(f.bytes), 0) as total
             from project_files f join projects p on p.id = f.project_id
            where p.${LIVE}`
        )?.total ?? 0
      )
    },
    sessions: {
      active: total(db, "select count(*) as total from sessions where revoked_at is null and expires_at > ?", now)
    },
    activity: { events: total(db, "select count(*) as total from admin_events") },
    analytics: { enabledProjects: enabledAnalyticsProjects(db) }
  };
}
