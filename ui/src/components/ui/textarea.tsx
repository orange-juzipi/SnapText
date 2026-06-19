import type * as React from "react";
import { cn } from "@/lib/cn";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-vertical rounded-md border border-input bg-control px-3 py-2 text-sm leading-6 text-foreground shadow-xs transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] placeholder:text-muted-foreground hover:border-primary/40 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}
