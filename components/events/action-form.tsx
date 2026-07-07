"use client";

import { toast } from "sonner";
import { useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ActionFormProps {
  action: (formData: FormData) => Promise<void>;
  successMessage?: string;
  className?: string;
  children: ReactNode;
}

export function ActionForm({
  action,
  successMessage = "Saved successfully.",
  className,
  children,
}: ActionFormProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className={cn(className)}
      action={(formData) => {
        startTransition(async () => {
          try {
            await action(formData);
            toast.success(successMessage);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Something went wrong.",
            );
          }
        });
      }}
    >
      <fieldset className="contents" disabled={isPending}>
        {children}
      </fieldset>
    </form>
  );
}
