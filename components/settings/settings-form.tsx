"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FormResult } from "@/app/(dashboard)/settings/actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function SettingsForm({
  action,
  children,
  submitLabel,
  resetOnSuccess,
}: {
  action: (
    prev: FormResult | null,
    formData: FormData,
  ) => Promise<FormResult>;
  children: ReactNode;
  submitLabel: string;
  /** Clears the form fields after a successful submit (e.g. password form). */
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const lastHandled = useRef<FormResult | null>(null);

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) {
      toast.success(state.message);
      if (resetOnSuccess) formRef.current?.reset();
    } else {
      toast.error(state.message);
    }
  }, [state, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4">
      {children}
      <div className="flex justify-end">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}
