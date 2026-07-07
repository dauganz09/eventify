import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "@/db";
import { getAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { resolveBackupFile } from "@/lib/backup/backup-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a completed backup dump file for download. Guarded by
 * `organization.manage`; the file must belong to the caller's org and resolve
 * inside the configured backup directory (checked in resolveBackupFile).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await getAuthContext();
  if (!context || !hasPermission(context.authorization, "organization.manage")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const resolved = await resolveBackupFile({
    database: db,
    organizationId: context.organization.id,
    runId: id,
  });
  if (!resolved) return new Response("Not found", { status: 404 });

  const info = await stat(resolved.absolutePath);
  const nodeStream = createReadStream(resolved.absolutePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${resolved.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
