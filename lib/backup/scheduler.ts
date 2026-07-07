import { eq } from "drizzle-orm";
import { db } from "@/db";
import { backupSettings } from "@/db/schema";
import { runBackup } from "@/lib/backup/backup-service";

// How often the scheduler wakes up to check whether any org is due for a backup.
// A backup is "due" when interval hours have elapsed since its last run; the
// tick cadence just bounds how late a due backup can fire.
const TICK_MS = 5 * 60 * 1000;

// Survive HMR / multiple imports in dev: keep one scheduler per process.
const globalForScheduler = globalThis as unknown as {
  __tabulateBackupScheduler?: { timer: NodeJS.Timeout; running: boolean };
};

async function tick() {
  const state = globalForScheduler.__tabulateBackupScheduler;
  if (!state || state.running) return; // don't overlap slow dumps with a new tick
  state.running = true;
  try {
    const rows = await db
      .select()
      .from(backupSettings)
      .where(eq(backupSettings.enabled, true));

    const now = Date.now();
    for (const row of rows) {
      const dueAfter = row.intervalHours * 60 * 60 * 1000;
      const lastRun = row.lastRunAt ? row.lastRunAt.getTime() : 0;
      if (now - lastRun < dueAfter) continue;
      try {
        await runBackup({
          database: db,
          organizationId: row.organizationId,
          trigger: "scheduled",
        });
      } catch (err) {
        // runBackup already records expected failures; this catches the truly
        // unexpected so one org can't kill the whole scheduler.
        console.error("[backup-scheduler] run failed", row.organizationId, err);
      }
    }
  } catch (err) {
    console.error("[backup-scheduler] tick failed", err);
  } finally {
    if (globalForScheduler.__tabulateBackupScheduler) {
      globalForScheduler.__tabulateBackupScheduler.running = false;
    }
  }
}

/** Starts the interval scheduler once per process. Safe to call repeatedly. */
export function startBackupScheduler() {
  if (globalForScheduler.__tabulateBackupScheduler) return;
  const timer = setInterval(() => void tick(), TICK_MS);
  // Don't hold the event loop open on shutdown.
  if (typeof timer.unref === "function") timer.unref();
  globalForScheduler.__tabulateBackupScheduler = { timer, running: false };
  // Run an initial check shortly after boot so a long-overdue backup fires
  // without waiting a full tick.
  setTimeout(() => void tick(), 15 * 1000).unref?.();
}
