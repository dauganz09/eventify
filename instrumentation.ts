// Runs once when a Next.js server instance starts (Node runtime only). We use
// it to boot the automatic database-backup scheduler so scheduled `pg_dump`
// runs happen without any external cron. See lib/backup/scheduler.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackupScheduler } = await import("@/lib/backup/scheduler");
  startBackupScheduler();
}
