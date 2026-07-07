"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { db } from "@/db";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { requireAuthContext, requirePermission } from "@/lib/auth/context";
import {
  changePassword,
  createStaffAccount,
  updateOrganizationName,
  updateProfile,
} from "@/lib/settings/settings-service";
import { restoreBackup, runBackup, updateBackupSettings } from "@/lib/backup/backup-service";

export interface FormResult {
  ok: boolean;
  message: string;
}

function errorResult(error: unknown): FormResult {
  if (error instanceof ZodError) {
    return {
      ok: false,
      message: error.issues[0]?.message ?? "Please check your input.",
    };
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : "Something went wrong.",
  };
}

export async function updateProfileAction(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const context = await requireAuthContext();
  try {
    await updateProfile({
      database: db,
      userId: context.userId,
      input: { displayName: formData.get("displayName") },
    });
  } catch (error) {
    return errorResult(error);
  }

  revalidatePath("/settings");
  return { ok: true, message: "Profile updated." };
}

export async function updateOrganizationAction(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const context = await requirePermission("organization.manage");
  let organizationName: string | undefined;
  try {
    const organization = await updateOrganizationName({
      database: db,
      organizationId: context.organization.id,
      input: { name: formData.get("name") },
    });
    organizationName = organization?.name;
  } catch (error) {
    return errorResult(error);
  }

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    actorUserId: context.userId,
    action: "organization.updated",
    entityType: "organization",
    entityId: context.organization.id,
    metadata: { name: organizationName },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Organization updated." };
}

export async function changePasswordAction(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const context = await requireAuthContext();
  try {
    await changePassword({
      database: db,
      userId: context.userId,
      input: {
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword"),
        confirmPassword: formData.get("confirmPassword"),
      },
    });
  } catch (error) {
    return errorResult(error);
  }

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    actorUserId: context.userId,
    action: "auth.password_changed",
    entityType: "user",
    entityId: context.userId,
  });

  revalidatePath("/settings");
  return { ok: true, message: "Password changed." };
}

export async function createStaffAccountAction(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const context = await requirePermission("member.manage");
  let staffUserId: string | undefined;
  let staffEmail: string | undefined;
  try {
    const staff = await createStaffAccount({
      database: db,
      organizationId: context.organization.id,
      input: {
        displayName: formData.get("displayName"),
        email: formData.get("email"),
        password: formData.get("password"),
      },
    });
    staffUserId = staff.userId;
    staffEmail = staff.email;
  } catch (error) {
    return errorResult(error);
  }

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    actorUserId: context.userId,
    action: "member.staff_account_created",
    entityType: "user",
    entityId: staffUserId,
    metadata: { email: staffEmail, role: "tabulator" },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Tabulator account created." };
}

export async function updateBackupSettingsAction(
  _prev: FormResult | null,
  formData: FormData,
): Promise<FormResult> {
  const context = await requirePermission("organization.manage");
  try {
    await updateBackupSettings({
      database: db,
      organizationId: context.organization.id,
      input: {
        enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
        intervalHours: formData.get("intervalHours"),
        retentionCount: formData.get("retentionCount"),
        directory: formData.get("directory"),
        pgDumpPath: formData.get("pgDumpPath") || undefined,
        dockerContainer: formData.get("dockerContainer") || undefined,
      },
    });
  } catch (error) {
    return errorResult(error);
  }

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    actorUserId: context.userId,
    action: "backup.settings_updated",
    entityType: "backup",
  });

  revalidatePath("/settings");
  return { ok: true, message: "Backup settings saved." };
}

export async function runBackupNowAction(): Promise<FormResult> {
  const context = await requirePermission("organization.manage");
  try {
    const run = await runBackup({
      database: db,
      organizationId: context.organization.id,
      trigger: "manual",
      actorUserId: context.userId,
    });
    revalidatePath("/settings");
    if (run.status === "success") {
      return { ok: true, message: "Backup created." };
    }
    return { ok: false, message: run.error ?? "Backup failed." };
  } catch (error) {
    return errorResult(error);
  }
}

export async function restoreBackupAction(runId: string): Promise<FormResult> {
  const context = await requirePermission("organization.manage");
  try {
    const result = await restoreBackup({
      database: db,
      organizationId: context.organization.id,
      runId,
      actorUserId: context.userId,
    });
    revalidatePath("/settings");
    if (result.ok) {
      return {
        ok: true,
        message: `Database restored. A safety backup was saved first${
          result.safetyBackupFilename ? ` (${result.safetyBackupFilename})` : ""
        }. You may need to sign in again.`,
      };
    }
    return { ok: false, message: result.error ?? "Restore failed." };
  } catch (error) {
    return errorResult(error);
  }
}
