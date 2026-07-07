"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, PlusIcon, X } from "lucide-react";
import {
  archiveContestantAction,
  deleteContestantAction,
  saveContestantAction,
} from "@/app/(dashboard)/events/[eventId]/builder/actions";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ContestantRow = {
  id: string;
  displayNumber: string | null;
  displayName: string;
  category: string | null;
  division: string | null;
  photoUrl: string | null;
  position: number;
};

export function ContestantsManager({
  eventId,
  contestants,
}: {
  eventId: string;
  contestants: ContestantRow[];
}) {
  // Unique categories and divisions for filter dropdowns
  const categories = [...new Set(contestants.map((c) => c.category).filter(Boolean))] as string[];
  const divisions = [...new Set(contestants.map((c) => c.division).filter(Boolean))] as string[];

  const columns: ColumnDef<ContestantRow, unknown>[] = [
    {
      accessorKey: "position",
      header: "#",
      cell: ({ row }) => row.original.position + 1,
      size: 48,
    },
    {
      id: "photo",
      header: () => <span className="sr-only">Photo</span>,
      cell: ({ row }) => (
        <div className="size-10 overflow-hidden rounded-full bg-muted">
          {row.original.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.original.photoUrl}
              alt={row.original.displayName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs font-semibold text-muted-foreground">
              {row.original.displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      ),
      size: 56,
    },
    {
      accessorKey: "displayNumber",
      header: "Number",
      cell: ({ row }) => row.original.displayNumber ?? "—",
      size: 80,
    },
    {
      accessorKey: "displayName",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.displayName}</span>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => row.original.category ?? "—",
      filterFn: "equals",
    },
    {
      accessorKey: "division",
      header: "Division",
      cell: ({ row }) => row.original.division ?? "—",
      filterFn: "equals",
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <ContestantFormDialog
            eventId={eventId}
            totalContestants={contestants.length}
            contestant={row.original}
            trigger={<Button size="sm" variant="ghost">Edit</Button>}
          />
          <ArchiveContestantButton
            eventId={eventId}
            contestantId={row.original.id}
            contestantName={row.original.displayName}
          />
          <DeleteContestantButton
            eventId={eventId}
            contestantId={row.original.id}
            contestantName={row.original.displayName}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Contestants</h2>
          <p className="text-sm text-muted-foreground">
            Manage contestants for this event.
          </p>
        </div>
        <ContestantFormDialog
          eventId={eventId}
          totalContestants={contestants.length}
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Add contestant
            </Button>
          }
        />
      </div>

      <DataTable
        columns={columns}
        data={contestants}
        searchColumn="displayName"
        searchPlaceholder="Search by name…"
        filters={[
          ...(categories.length > 0
            ? [{ columnId: "category", label: "All categories", options: categories.map((c) => ({ label: c, value: c })) }]
            : []),
          ...(divisions.length > 0
            ? [{ columnId: "division", label: "All divisions", options: divisions.map((d) => ({ label: d, value: d })) }]
            : []),
        ]}
        emptyMessage="No contestants found."
      />
    </div>
  );
}

// ── Form dialog ───────────────────────────────────────────────────────────────

function ContestantFormDialog({
  eventId,
  totalContestants,
  contestant,
  trigger,
}: {
  eventId: string;
  totalContestants: number;
  contestant?: ContestantRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [photoUrl, setPhotoUrl] = useState(contestant?.photoUrl ?? "");
  const isEdit = !!contestant;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveContestantAction(eventId, formData);
        toast.success(isEdit ? "Contestant updated." : "Contestant added.");
        if (!isEdit) setPhotoUrl("");
        setOpen(false);
      } catch {
        toast.error(isEdit ? "Failed to update contestant." : "Failed to add contestant.");
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit contestant" : "Add contestant"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleSubmit}
            className="grid gap-4 sm:grid-cols-2"
            key={contestant?.id ?? "new"}
          >
            {isEdit && (
              <input type="hidden" name="contestantId" value={contestant.id} />
            )}
            <input type="hidden" name="photoUrl" value={photoUrl} />
            <div className="sm:col-span-2">
              <PhotoField
                value={photoUrl}
                onChange={setPhotoUrl}
                name={contestant?.displayName ?? "contestant"}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cd-displayNumber">Display number</Label>
              <Input id="cd-displayNumber" name="displayNumber" defaultValue={contestant?.displayNumber ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cd-displayName">Display name</Label>
              <Input id="cd-displayName" name="displayName" required defaultValue={contestant?.displayName ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cd-category">Category</Label>
              <Input id="cd-category" name="category" defaultValue={contestant?.category ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cd-division">Division</Label>
              <Input id="cd-division" name="division" defaultValue={contestant?.division ?? ""} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="cd-position">Position</Label>
              <Input id="cd-position" name="position" type="number" min={0} defaultValue={contestant?.position ?? totalContestants} />
            </div>
            <DialogFooter className="sm:col-span-2" showCloseButton>
              <Button type="submit" disabled={isPending}>
                {isPending ? (isEdit ? "Saving…" : "Adding…") : (isEdit ? "Save changes" : "Add contestant")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Photo upload field ──────────────────────────────────────────────────────────

function PhotoField({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (url: string) => void;
  name: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload/contestant-photo", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      onChange(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <Label>Photo</Label>
      <div className="flex items-center gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-full border bg-muted">
          {value ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={value} alt={name} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => onChange("")}
                className="absolute right-0 top-0 rounded-full bg-destructive p-0.5 text-white shadow"
                aria-label="Remove photo"
              >
                <X className="size-3" />
              </button>
            </>
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImagePlus className="size-6" />
            </div>
          )}
        </div>
        <div className="grid gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Uploading…
              </>
            ) : value ? (
              "Change photo"
            ) : (
              "Upload photo"
            )}
          </Button>
          <p className="text-xs text-muted-foreground">JPG, PNG, WebP up to 5 MB.</p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}

// ── Action buttons ────────────────────────────────────────────────────────────

function ArchiveContestantButton({ eventId, contestantId, contestantName }: { eventId: string; contestantId: string; contestantName: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={isPending}
      onClick={() => startTransition(async () => {
        try {
          await archiveContestantAction(eventId, contestantId);
          toast.success(`"${contestantName}" archived.`);
        } catch {
          toast.error("Failed to archive contestant.");
        }
      })}>
      {isPending ? "Archiving…" : "Archive"}
    </Button>
  );
}

function DeleteContestantButton({ eventId, contestantId, contestantName }: { eventId: string; contestantId: string; contestantName: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending}
      onClick={() => startTransition(async () => {
        try {
          await deleteContestantAction(eventId, contestantId);
          toast.success(`"${contestantName}" deleted.`);
        } catch {
          toast.error("Failed to delete contestant.");
        }
      })}>
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
