"use client";

import { toast } from "sonner";
import { useTransition, type ReactNode } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

interface ActionButtonProps extends VariantProps<typeof buttonVariants> {
  action: () => Promise<void>;
  successMessage?: string;
  /** When set, a browser confirm() with this message must be accepted first. */
  confirm?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function ActionButton({
  action,
  successMessage = "Updated successfully.",
  confirm,
  children,
  variant,
  size,
  disabled,
  className,
}: ActionButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      className={className}
      disabled={isPending || disabled}
      size={size}
      type="button"
      variant={variant}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        startTransition(async () => {
          try {
            await action();
            toast.success(successMessage);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Something went wrong.",
            );
          }
        });
      }}
    >
      {children}
    </Button>
  );
}
