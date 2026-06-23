import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "group/snaptext-button inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-[background-color,border-color,box-shadow,color,filter] duration-[var(--motion-base)] ease-[var(--ease-out-quart)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-xs",
        secondary: "border border-border bg-secondary text-foreground hover:bg-secondary/80 hover:shadow-xs",
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        quiet: "bg-transparent text-foreground hover:bg-secondary",
        destructive: "bg-destructive text-white hover:bg-destructive/90 hover:shadow-xs",
      },
      size: {
        sm: "h-8 px-2.5 text-xs",
        md: "h-9 px-3",
        lg: "h-10 px-4",
        icon: "h-9 w-9 px-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
