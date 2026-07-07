import { Building2, DatabaseBackup, KeyRound, UserPlus, Users } from "lucide-react";
import { APP_NAME, APP_TAGLINE, DEVELOPER } from "@/lib/branding";
import { db } from "@/db";
import { requireAuthContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permissions";
import { listOrganizationMembers } from "@/lib/settings/settings-service";
import { getBackupSettings, listBackupRuns } from "@/lib/backup/backup-service";
import {
  BackupSettings,
  type BackupRunView,
  type BackupSettingsView,
} from "@/components/settings/backup-settings";
import {
  changePasswordAction,
  createStaffAccountAction,
  updateOrganizationAction,
  updateProfileAction,
} from "@/app/(dashboard)/settings/actions";
import { SettingsForm } from "@/components/settings/settings-form";
import { DataCard, DataCardList, DataCardRow } from "@/components/data-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roleVariant: Record<string, "default" | "secondary" | "success" | "warning"> = {
  owner: "default",
  admin: "success",
  tabulator: "secondary",
  judge: "secondary",
  viewer: "secondary",
  auditor: "warning",
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatWhen(date: Date | null): string | null {
  if (!date) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SettingsPage() {
  const context = await requireAuthContext();
  const canManageOrg = hasPermission(context.authorization, "organization.manage");
  const canManageMembers = hasPermission(context.authorization, "member.manage");

  const members = canManageMembers
    ? await listOrganizationMembers({
        database: db,
        organizationId: context.organization.id,
      })
    : [];

  let backupView: BackupSettingsView | null = null;
  let backupRuns: BackupRunView[] = [];
  if (canManageOrg) {
    const [settings, runs] = await Promise.all([
      getBackupSettings({ database: db, organizationId: context.organization.id }),
      listBackupRuns({ database: db, organizationId: context.organization.id, limit: 20 }),
    ]);
    backupView = {
      enabled: settings.enabled,
      intervalHours: settings.intervalHours,
      retentionCount: settings.retentionCount,
      directory: settings.directory,
      pgDumpPath: settings.pgDumpPath,
      dockerContainer: settings.dockerContainer,
      lastStatus: settings.lastStatus,
      lastError: settings.lastError,
      lastRunLabel: formatWhen(settings.lastRunAt),
    };
    backupRuns = runs.map((run) => ({
      id: run.id,
      filename: run.filename,
      sizeLabel: formatBytes(run.sizeBytes),
      status: run.status,
      trigger: run.trigger,
      whenLabel: formatWhen(run.createdAt) ?? "",
      downloadable: run.status === "success",
    }));
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-muted-foreground">
          Manage your profile, organization, security, and team.
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            How you appear across the workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            key={String(context.profile.updatedAt)}
            action={updateProfileAction}
            submitLabel="Save profile"
          >
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                name="displayName"
                defaultValue={context.profile.displayName ?? ""}
                required
                maxLength={160}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={context.email} disabled readOnly />
              <p className="text-xs text-muted-foreground">
                Your sign-in email cannot be changed here.
              </p>
            </div>
          </SettingsForm>
        </CardContent>
      </Card>

      {/* Organization */}
      {canManageMembers && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5" />
            Organization
          </CardTitle>
          <CardDescription>
            {canManageOrg
              ? "Rename your organization. Visible to all members."
              : "Only owners can change organization details."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManageOrg ? (
            <SettingsForm
              key={String(context.organization.updatedAt)}
              action={updateOrganizationAction}
              submitLabel="Save organization"
            >
              <div className="grid gap-2">
                <Label htmlFor="name">Organization name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={context.organization.name}
                  required
                  minLength={2}
                  maxLength={160}
                />
              </div>
              <div className="grid gap-2">
                <Label>Workspace URL slug</Label>
                <Input value={context.organization.slug} disabled readOnly />
              </div>
            </SettingsForm>
          ) : (
            <div className="grid gap-1">
              <p className="text-lg font-medium">{context.organization.name}</p>
              <p className="text-sm text-muted-foreground">
                {context.organization.slug}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Backups */}
      {canManageOrg && backupView && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseBackup className="size-5" />
              Database backups
            </CardTitle>
            <CardDescription>
              Automatic <code>pg_dump</code> snapshots of the whole database, run
              on a schedule and stored locally. Download any snapshot to keep an
              off-machine copy between rounds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BackupSettings settings={backupView} runs={backupRuns} />
          </CardContent>
        </Card>
      )}

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Password
          </CardTitle>
          <CardDescription>
            Choose a strong password with at least 8 characters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            action={changePasswordAction}
            submitLabel="Change password"
            resetOnSuccess
          >
            <div className="grid gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
            </div>
          </SettingsForm>
        </CardContent>
      </Card>

      {/* Team */}
      {canManageMembers && (
      <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="size-5" />
            Add tabulator account
          </CardTitle>
          <CardDescription>
            Creates a staff login that can only view the Tabulator dashboard
            and their own profile/password — no access to Events or
            Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm
            action={createStaffAccountAction}
            submitLabel="Create tabulator account"
            resetOnSuccess
          >
            <div className="grid gap-2">
              <Label htmlFor="staffDisplayName">Display name</Label>
              <Input id="staffDisplayName" name="displayName" maxLength={160} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staffEmail">Email</Label>
              <Input id="staffEmail" name="email" type="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staffPassword">Temporary password</Label>
              <Input
                id="staffPassword"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="text-xs text-muted-foreground">
                Share this with them directly — they can change it later from
                their own Settings.
              </p>
            </div>
          </SettingsForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5" />
            Team members
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {members.length}
            </span>
          </CardTitle>
          <CardDescription>
            People with access to {context.organization.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-medium">
                      {member.displayName ?? "—"}
                      {member.userId === context.userId && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {member.roles.map((role) => (
                          <Badge
                            key={role}
                            variant={roleVariant[role] ?? "secondary"}
                          >
                            {role}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <DataCardList>
            {members.map((member) => (
              <DataCard
                key={member.userId}
                title={
                  <>
                    {member.displayName ?? "—"}
                    {member.userId === context.userId && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </>
                }
                meta={
                  <span className="text-muted-foreground">{member.email}</span>
                }
              >
                <DataCardRow label="Roles">
                  <div className="flex flex-wrap justify-end gap-1">
                    {member.roles.map((role) => (
                      <Badge
                        key={role}
                        variant={roleVariant[role] ?? "secondary"}
                      >
                        {role}
                      </Badge>
                    ))}
                  </div>
                </DataCardRow>
              </DataCard>
            ))}
          </DataCardList>
        </CardContent>
      </Card>
      </>
      )}

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>{APP_TAGLINE}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Application</dt>
              <dd className="font-medium">{APP_NAME}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Developed by</dt>
              <dd className="font-medium">{DEVELOPER}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
