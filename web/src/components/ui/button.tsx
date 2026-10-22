import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

// Variants follow docs/design.md section 5: one amber primary per screen,
// green only for "I'm home", red only for SOS / Call 999.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[16px] font-bold transition-[transform,background-color,opacity] outline-none select-none focus-visible:ring-3 focus-visible:ring-amber/60 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        primary: "bg-amber text-amber-ink font-extrabold active:bg-amber/85",
        secondary: "border border-line-strong bg-transparent text-text active:bg-surface-2",
        text: "bg-transparent text-muted font-semibold underline-offset-4 active:text-text",
        safe: "bg-safe text-safe-ink font-extrabold active:bg-safe/85",
        danger: "bg-danger text-white font-extrabold active:bg-danger/85",
        redOutline: "border-2 border-text bg-transparent text-text active:bg-danger-surface",
        chip: "bg-surface-2 text-text active:bg-line",
      },
      size: {
        lg: "h-[54px] w-full px-5 text-[16px]",
        md: "h-12 px-4 text-[15px]",
        sm: "h-11 px-4 text-[14px] rounded-[14px]",
        icon: "size-11 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "lg" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
