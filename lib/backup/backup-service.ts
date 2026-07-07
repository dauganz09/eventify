import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import type { db } from "@/db";
import { backupRuns, backupSettings } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { backupSettingsUpdateSchema } from "@/lib/validation/domain";

const execFileAsync = promisify(execFile);

/** Default place dumps are written when the org hasn't set a directory. */
function defaultBackupDir() {
  return path.join(process.cwd(), "backups");
}

export type BackupSettings = typeof backupSettings.$inferSelect;
export type BackupRun = typeof backupRuns.$inferSelect;

/**
 * Reads the org's backup settings, lazily creating a disabled default row the
 * first time (so the Settings UI always has something to render).
 */
export async function getBackupSettings(params: {
  database: typeof db;
  organizationId: string;
}): Promise<BackupSettings> {
  const { database, organizationId } = params;
  const [existing] = await database
    .select()
    .from(backupSettings)
    .where(eq(backupSettings.organizationId, organizationId))
    .limit(1);
  if (existing) return existing;

  const [created] = await database
    .insert(backupSettings)
    .values({ organizationId, directory: defaultBackupDir() })
    .onConflictDoNothing({ target: backupSettings.organizationId })
    .returning();
  if (created) return created;

  // Lost the insert race — read the row the other writer created.
  const [row] = await database
    .select()
    .from(backupSettings)
    .where(eq(backupSettings.organizationId, organizationId))
    .limit(1);
  return row;
}

export async function updateBackupSettings(params: {
  database: typeof db;
  organizationId: string;
  input: unknown;
}): Promise<BackupSettings> {
  const input = backupSettingsUpdateSchema.parse(params.input);
  await getBackupSettings(params); // ensure a row exists

  const [updated] = await params.database
    .update(backupSettings)
    .set({
      enabled: input.enabled,
      intervalHours: input.intervalHours,
      retentionCount: input.retentionCount,
      directory: input.directory.trim(),
      pgDumpPath: input.pgDumpPath?.trim() ? input.pgDumpPath.trim() : null,
      dockerContainer: input.dockerContainer?.trim() ? input.dockerContainer.trim() : null,
      updatedAt: new Date(),
    })
    .where(eq(backupSettings.organizationId, params.organizationId))
    .returning();
  return updated;
}

export async function listBackupRuns(params: {
  database: typeof db;
  organizationId: string;
  limit?: number;
}): Promise<BackupRun[]> {
  return params.database
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.organizationId, params.organizationId))
    .orderBy(desc(backupRuns.createdAt))
    .limit(params.limit ?? 20);
}

/** Parses DATABASE_URL into the pieces pg_dump needs. */
function parseDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const url = new URL(raw);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL has no database name.");
  return {
    host: url.hostname || "localhost",
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

/**
 * Runs pg_dump inside a Docker container and streams the custom-format dump to
 * a host file. Uses the container's local socket (trust auth in the official
 * postgres image), with PGPASSWORD supplied as a fallback.
 */
function dockerDump(params: {
  container: string;
  conn: ReturnType<typeof parseDatabaseUrl>;
  filePath: string;
}): Promise<void> {
  const { container, conn, filePath } = params;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-e", `PGPASSWORD=${conn.password}`,
        container,
        "pg_dump",
        "-U", conn.user,
        "-d", conn.database,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const out = createWriteStream(filePath);
    let stderr = "";
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      reject(err);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("pg_dump timed out after 10 minutes."));
    }, 10 * 60 * 1000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.stdout.pipe(out);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) fail(new Error(`docker pg_dump exited ${code}: ${stderr.trim()}`));
    });
    out.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    out.on("finish", () => {
      if (!failed) resolve();
    });
  });
}

function timestampSlug(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Runs a single `pg_dump` into the configured directory, records the result,
 * prunes old files past the retention count, and audits the run. Never throws
 * for an expected failure (missing pg_dump, bad dir) — the failure is captured
 * on the returned run row and mirrored onto the settings' lastStatus/lastError.
 */
export async function runBackup(params: {
  database: typeof db;
  organizationId: string;
  trigger: "manual" | "scheduled" | "pre-restore";
  actorUserId?: string;
}): Promise<BackupRun> {
  const { database, organizationId, trigger, actorUserId } = params;
  const settings = await getBackupSettings({ database, organizationId });
  const directory = settings.directory || defaultBackupDir();
  const pgDump = settings.pgDumpPath?.trim() || process.env.PG_DUMP_PATH || "pg_dump";
  const filename = `tabulate-${timestampSlug(new Date())}.dump`;
  const filePath = path.join(directory, filename);

  let status: "success" | "failed" = "success";
  let error: string | null = null;
  let sizeBytes: number | null = null;

  try {
    await mkdir(directory, { recursive: true });
    const conn = parseDatabaseUrl();
    const container = settings.dockerContainer?.trim();
    if (container) {
      // Dump from inside the container (its pg_dump matches the server version)
      // and stream stdout to the host file — avoids host/server version skew.
      await dockerDump({ container, conn, filePath });
    } else {
      await execFileAsync(
        pgDump,
        [
          "-h", conn.host,
          "-p", conn.port,
          "-U", conn.user,
          "-d", conn.database,
          "--format=custom",
          "--no-owner",
          "--no-privileges",
          "-f", filePath,
        ],
        {
          env: { ...process.env, PGPASSWORD: conn.password },
          timeout: 10 * 60 * 1000,
          maxBuffer: 1024 * 1024,
        },
      );
    }
    const info = await stat(filePath);
    sizeBytes = info.size;
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
    // The most common local failure is a host/server pg_dump version skew.
    // Point the operator at the Docker-container option that fixes it.
    if (!settings.dockerContainer?.trim() && /server version mismatch/i.test(error)) {
      error +=
        "\n\nFix: your database runs a newer Postgres than the host's pg_dump. " +
        "Set the \"Docker container\" field to your DB container name (e.g. " +
        "tabulate-postgres) and Save — the dump will then run inside the container.";
    }
    // Best-effort cleanup of a partial/empty dump.
    await rm(filePath, { force: true }).catch(() => {});
  }

  const [run] = await database
    .insert(backupRuns)
    .values({ organizationId, filename, sizeBytes, status, trigger, error })
    .returning();

  await database
    .update(backupSettings)
    .set({ lastRunAt: new Date(), lastStatus: status, lastError: error })
    .where(eq(backupSettings.organizationId, organizationId));

  if (status === "success") {
    await pruneOldBackups({ database, organizationId, directory, keep: settings.retentionCount });
  }

  await writeAuditLog({
    database,
    organizationId,
    actorUserId,
    action: status === "success" ? "backup.created" : "backup.failed",
    entityType: "backup",
    entityId: run.id,
    metadata: { trigger, filename, sizeBytes, error },
  });

  return run;
}

/** Keeps only the newest `keep` successful dump files on disk and in the log. */
async function pruneOldBackups(params: {
  database: typeof db;
  organizationId: string;
  directory: string;
  keep: number;
}) {
  const { database, organizationId, directory, keep } = params;
  if (keep <= 0) return;

  const successful = await database
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.organizationId, organizationId), eq(backupRuns.status, "success")))
    .orderBy(desc(backupRuns.createdAt));

  const stale = successful.slice(keep);
  for (const run of stale) {
    await rm(path.join(directory, run.filename), { force: true }).catch(() => {});
    await database.delete(backupRuns).where(eq(backupRuns.id, run.id));
  }
}

/**
 * Resolves a backup run to an on-disk file for download, guarding against path
 * traversal (the resolved file must live inside the configured directory).
 */
export async function resolveBackupFile(params: {
  database: typeof db;
  organizationId: string;
  runId: string;
}): Promise<{ absolutePath: string; filename: string } | null> {
  const { database, organizationId, runId } = params;
  const [run] = await database
    .select()
    .from(backupRuns)
    .where(and(eq(backupRuns.id, runId), eq(backupRuns.organizationId, organizationId)))
    .limit(1);
  if (!run || run.status !== "success") return null;

  const settings = await getBackupSettings({ database, organizationId });
  const directory = path.resolve(settings.directory || defaultBackupDir());
  const absolutePath = path.resolve(directory, run.filename);
  // Reject anything that escapes the backup directory.
  if (absolutePath !== path.join(directory, path.basename(run.filename))) return null;
  try {
    await stat(absolutePath);
  } catch {
    return null;
  }
  return { absolutePath, filename: run.filename };
}

/**
 * Streams a dump file into `pg_restore` inside a Docker container (stdin), with
 * --clean --if-exists so existing objects are dropped and recreated.
 */
function dockerRestore(params: {
  container: string;
  conn: ReturnType<typeof parseDatabaseUrl>;
  filePath: string;
}): Promise<void> {
  const { container, conn, filePath } = params;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec", "-i",
        "-e", `PGPASSWORD=${conn.password}`,
        container,
        "pg_restore",
        "--clean", "--if-exists",
        "--no-owner", "--no-privileges",
        "-U", conn.user,
        "-d", conn.database,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let stderr = "";
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      reject(err);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("pg_restore timed out after 10 minutes."));
    }, 10 * 60 * 1000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16384) stderr = stderr.slice(-16384);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });

    const source = createReadStream(filePath);
    source.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    source.pipe(child.stdin);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else fail(new Error(`pg_restore exited ${code}: ${stderr.trim()}`));
    });
  });
}

export interface RestoreResult {
  ok: boolean;
  /** The pre-restore safety backup filename, so the operator can find it after. */
  safetyBackupFilename: string | null;
  error: string | null;
}

/**
 * Restores the whole database from a previous backup. DESTRUCTIVE: every table
 * is dropped and recreated from the dump, so all data written since that backup
 * is lost and the current login session is invalidated.
 *
 * Safeguards: a fresh "pre-restore" backup is taken first (and re-registered
 * after the restore so it survives the overwrite); the restore aborts if that
 * safety backup fails. Runs through the Docker container when configured, so the
 * pg_restore version matches the server.
 */
export async function restoreBackup(params: {
  database: typeof db;
  organizationId: string;
  runId: string;
  actorUserId?: string;
}): Promise<RestoreResult> {
  const { database, organizationId, runId, actorUserId } = params;

  const resolved = await resolveBackupFile({ database, organizationId, runId });
  if (!resolved) {
    return { ok: false, safetyBackupFilename: null, error: "Backup file not found on disk." };
  }
  const settings = await getBackupSettings({ database, organizationId });

  // Copy the target dump somewhere neutral first, so the safety backup's
  // retention prune can't delete the very file we're about to restore from.
  const tempFile = path.join(os.tmpdir(), `tabulate-restore-${Date.now()}.dump`);
  await copyFile(resolved.absolutePath, tempFile);

  try {
    // 1) Safety net — bail out if we can't capture the current state first.
    const safety = await runBackup({ database, organizationId, trigger: "pre-restore", actorUserId });
    if (safety.status !== "success") {
      return {
        ok: false,
        safetyBackupFilename: null,
        error: `Aborted: could not create a safety backup first (${safety.error ?? "unknown error"}).`,
      };
    }

    // 2) Restore.
    const conn = parseDatabaseUrl();
    const container = settings.dockerContainer?.trim();
    if (container) {
      await dockerRestore({ container, conn, filePath: tempFile });
    } else {
      const pgRestore = process.env.PG_RESTORE_PATH || "pg_restore";
      await execFileAsync(
        pgRestore,
        [
          "-h", conn.host,
          "-p", conn.port,
          "-U", conn.user,
          "-d", conn.database,
          "--clean", "--if-exists",
          "--no-owner", "--no-privileges",
          tempFile,
        ],
        { env: { ...process.env, PGPASSWORD: conn.password }, timeout: 10 * 60 * 1000 },
      );
    }

    // 3) The restore overwrote backup bookkeeping too, so re-register the safety
    //    backup, refresh the "last run" status (otherwise it reverts to whatever
    //    stale value was frozen in the snapshot — often an older failure), and
    //    log the restore. Best-effort: the restore itself already succeeded.
    try {
      await database.insert(backupRuns).values({
        organizationId,
        filename: safety.filename,
        sizeBytes: safety.sizeBytes,
        status: "success",
        trigger: "pre-restore",
        error: null,
      });
      await database
        .update(backupSettings)
        .set({ lastRunAt: new Date(), lastStatus: "success", lastError: null })
        .where(eq(backupSettings.organizationId, organizationId));
      await writeAuditLog({
        database,
        organizationId,
        action: "backup.restored",
        entityType: "backup",
        entityId: runId,
        metadata: { restoredFrom: resolved.filename, safetyBackup: safety.filename },
      });
    } catch {
      // Ignore — bookkeeping only.
    }

    return { ok: true, safetyBackupFilename: safety.filename, error: null };
  } catch (err) {
    return {
      ok: false,
      safetyBackupFilename: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(tempFile, { force: true }).catch(() => {});
  }
}
