import type * as React from "react";
import { cn } from "@/lib/cn";

export function Field({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // Field 是布局容器，不承担 label 行为，避免嵌套 label 时把点击错误代理到内部控件。
  return <div className={cn("grid gap-1.5", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-sm font-semibold text-muted-foreground", className)} {...props} />;
}

export function FieldHint({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
