import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand hover:bg-brand-hover text-white shadow-md shadow-brand/20",
  secondary:
    "bg-bg-muted hover:bg-border text-fg",
  ghost: "hover:bg-bg-muted text-fg-muted hover:text-fg",
  danger:
    "bg-priority-urgent/90 hover:bg-priority-urgent text-white shadow-md shadow-red-500/20",
  outline:
    "border border-border hover:border-border-strong hover:bg-bg-muted text-fg"
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-4 text-sm"
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand/30",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
