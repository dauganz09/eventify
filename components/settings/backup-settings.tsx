"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Download, Loader2, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  restoreBackupAction,
  runBackupNowAction,
  updateBackupSettingsAction,
  type FormResult,
} from "@/app/(dashboard)/settings/actions";

export type BackupRunView = {
  id: string;
  filename: string;
  sizeLabel: string;
  status: string;
  trigger: string;
  whenLabel: string;
  downloadable: boolean;
};

export type BackupSettingsView = {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  directory: string;
  pgDumpPath: string | null;
  dockerContainer: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRunLabel: string | null;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save backup settings"}
    </Button>
  );
}

export function BackupSettings({
  settings,
  runs,
}: {
  settings: BackupSettingsView;
  runs: BackupRunView[];
}) {
  const [state, formAction] = useActionState(updateBackupSettingsAction, null);
  const lastHandled = useRef<FormResult | null>(null);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [isRunning, startRun] = useTransition();
  const [restoreTarget, setRestoreTarget] = useState<BackupRunView | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [isRestoring, startRestore] = useTransition();

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  function handleBackupNow() {
    startRun(async () => {
      const result = await runBackupNowAction();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  function handleRestore() {
    if (!restoreTarget) return;
    const target = restoreTarget;
    startRestore(async () => {
      const result = await restoreBackupAction(target.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setRestoreTarget(null);
      setConfirmText("");
    });
  }

  return (
    <div className="grid gap-6">
      <form action={formAction} className="grid gap-4">
        {/* Enable toggle */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="backup-enabled" className="text-base">
              Automatic backups
            </Label>
            <p className="text-sm text-muted-foreground">
              Periodically run <code>pg_dump</code> to a local file so scores are
              recoverable between rounds.
            </p>
          </div>
          <Switch
            id="backup-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <input type="hidden" name="enabled" value={enabled ? "true" : "false"} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="intervalHours">Backup every (hours)</Label>
            <Input
              id="intervalHours"
              name="intervalHours"
              type="number"
              min={1}
              max={720}
              defaultValue={settings.intervalHours}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="retentionCount">Keep last (files)</Label>
            <Input
              id="retentionCount"
              name="retentionCount"
              type="number"
              min={1}
              max={365}
              defaultValue={settings.retentionCount}
              required
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="directory">Backup folder</Label>
          <Input
            id="directory"
            name="directory"
            defaultValue={settings.directory}
            required
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Absolute path on the machine running the app. Created if it
            doesn&apos;t exist.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="pgDumpPath">
            pg_dump path <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="pgDumpPath"
            name="pgDumpPath"
            defaultValue={settings.pgDumpPath ?? ""}
            placeholder="pg_dump"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Set this only if <code>pg_dump</code> isn&apos;t on the server&apos;s
            PATH (e.g. <code>/opt/homebrew/opt/postgresql@15/bin/pg_dump</code>).
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="dockerContainer">
            Docker container{" "}
            <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="dockerContainer"
            name="dockerContainer"
            defaultValue={settings.dockerContainer ?? ""}
            placeholder="e.g. tabulate-postgres"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            If your database runs in Docker, set the container name and the dump
            runs <code>pg_dump</code> inside it — this sidesteps host/server
            version mismatches. Leave blank to use a local <code>pg_dump</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleBackupNow}
            disabled={isRunning}
            className="gap-1.5"
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Back up now
          </Button>
          <SaveButton />
        </div>
      </form>

      {/* Last run status */}
      {settings.lastRunLabel && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Last run: </span>
          <span className="font-medium">{settings.lastRunLabel}</span>
          {settings.lastStatus && (
            <Badge
              variant={settings.lastStatus === "success" ? "success" : "warning"}
              className="ml-2"
            >
              {settings.lastStatus}
            </Badge>
          )}
          {settings.lastStatus !== "success" && settings.lastError && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {settings.lastError}
            </p>
          )}
        </div>
      )}

      {/* Recent runs */}
      {runs.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Recent backups</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap">{run.whenLabel}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {run.trigger}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {run.sizeLabel}
                    </TableCell>
                    <TableCell>
                      <Badge variant={run.status === "success" ? "success" : "warning"}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {run.downloadable ? (
                        <div className="flex items-center justify-end gap-3">
                          <a
                            href={`/api/backups/${run.id}/download`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                          >
                            <Download className="size-3.5" />
                            Download
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmText("");
                              setRestoreTarget(run);
                            }}
                            className="inline-flex items-center gap-1 text-sm font-medium text-destructive hover:underline"
                          >
                            <RotateCcw className="size-3.5" />
                            Restore
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Restore confirmation — destructive, so require typing RESTORE. */}
      <Dialog
        open={restoreTarget != null}
        onOpenChange={(open) => {
          if (!open && !isRestoring) {
            setRestoreTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" />
              Restore database from this backup?
            </DialogTitle>
            <DialogDescription>
              This overwrites the entire database with the contents of{" "}
              <code>{restoreTarget?.filename}</code> ({restoreTarget?.whenLabel}).
              Everything recorded since then — scores, rounds, judges, settings —
              is permanently replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>A safety backup of the current data is taken first.</li>
              <li>You&apos;ll be signed out and need to log in again.</li>
              <li>Do this only when no judges are actively scoring.</li>
            </ul>
            <div className="grid gap-1.5">
              <Label htmlFor="restore-confirm">
                Type <span className="font-mono font-semibold">RESTORE</span> to
                confirm
              </Label>
              <Input
                id="restore-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                disabled={isRestoring}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button variant="outline" disabled={isRestoring}>
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={isRestoring || confirmText !== "RESTORE"}
              className="gap-1.5"
            >
              {isRestoring ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Restore database
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
