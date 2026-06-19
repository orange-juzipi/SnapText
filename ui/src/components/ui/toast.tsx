import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

type ToastProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "destructive";
};

function Toast({ className, variant = "default", ...props }: ToastProps) {
  return (
    <div
      className={cn(
        "grid min-w-72 max-w-[min(42rem,calc(100vw-2rem))] gap-1 rounded-lg border border-border bg-card p-3 text-sm shadow-lg",
        variant === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
        variant === "destructive" && "border-red-200 bg-red-50 text-red-950",
        className,
      )}
      role="status"
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-semibold", className)} {...props} />;
}

function ToastDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("leading-5 text-muted-foreground", className)} {...props} />;
}

function ToastClose({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button aria-label="关闭通知" className={cn("absolute right-2 top-2", className)} size="icon" variant="ghost" {...props}>
      <X size={14} />
    </Button>
  );
}

function ToastViewport({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("fixed left-1/2 top-4 z-50 grid -translate-x-1/2 gap-2", className)}
      {...props}
    />
  );
}

export { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport };
