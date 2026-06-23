import { Link } from "@tanstack/react-router";
import type * as React from "react";
import { cn } from "@/lib/cn";

export function TabsNav({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        "flex min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-secondary p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsLink({
  className,
  to,
  children,
}: {
  className?: string;
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold text-muted-foreground transition-[background-color,box-shadow,color] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring [&_svg]:shrink-0",
        className,
      )}
      activeProps={{
        className: "bg-card text-foreground shadow-xs",
      }}
    >
      {children}
    </Link>
  );
}
