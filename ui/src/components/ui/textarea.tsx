import type * as React from "react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/** Renders the shared textarea while forwarding its DOM ref for OCR text selection. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full resize-vertical rounded-md border border-input bg-control px-3 py-2 text-sm leading-6 text-foreground transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] placeholder:text-muted-foreground hover:border-primary/40 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
});
