import type * as React from "react";
import { cn } from "@/lib/cn";

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-control px-3 text-sm text-foreground transition-[background-color,border-color,box-shadow,color] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] hover:border-primary/40 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}
