"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { writeAuditLog } from "@/lib/audit/audit-service";
import { requirePermission } from "@/lib/auth/context";
import {
  createCustomPrintReport,
  deleteCustomPrintReport,
  updateCustomPrintReport,
} from "@/lib/scoring/custom-print-report-service";
import {
  customPrintReportDeleteSchema,
  customPrintReportUpsertSchema,
} from "@/lib/validation/domain";

function revalidateTabulator(eventId: string) {
  revalidatePath(`/tabulator/${eventId}`);
  revalidatePath(`/tabulator/${eventId}/print`);
  revalidatePath(`/tabulator/${eventId}/print/custom`);
}

export async function saveCustomPrintReportAction(formData: FormData) {
  const context = await requirePermission("score.adjust");

  const parsed = customPrintReportUpsertSchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
    reportId: formData.get("reportId")
      ? String(formData.get("reportId"))
      : undefined,
    name: String(formData.get("name") ?? ""),
    description: formData.get("description")
      ? String(formData.get("description"))
      : undefined,
    setIds: formData.getAll("setIds").map(String),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const { eventId, reportId, name, description, setIds } = parsed.data;
  const descriptionValue =
    description === "" || description === undefined ? null : description;

  const report = reportId
    ? await updateCustomPrintReport({
        database: db,
        organizationId: context.organization.id,
        eventId,
        reportId,
        name,
        description: descriptionValue,
        setIds,
      })
    : await createCustomPrintReport({
        database: db,
        organizationId: context.organization.id,
        eventId,
        name,
        description: descriptionValue,
        setIds,
      });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: reportId ? "custom_print_report.updated" : "custom_print_report.created",
    entityType: "custom_print_report",
    entityId: report.id,
    metadata: { name: report.name, setIds: report.setIds },
  });

  revalidateTabulator(eventId);
  return { id: report.id };
}

export async function deleteCustomPrintReportAction(formData: FormData) {
  const context = await requirePermission("score.adjust");

  const parsed = customPrintReportDeleteSchema.safeParse({
    eventId: String(formData.get("eventId") ?? ""),
    reportId: String(formData.get("reportId") ?? ""),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const { eventId, reportId } = parsed.data;

  await deleteCustomPrintReport({
    database: db,
    organizationId: context.organization.id,
    eventId,
    reportId,
  });

  await writeAuditLog({
    database: db,
    organizationId: context.organization.id,
    eventId,
    actorUserId: context.userId,
    action: "custom_print_report.deleted",
    entityType: "custom_print_report",
    entityId: reportId,
    metadata: {},
  });

  revalidateTabulator(eventId);
}
