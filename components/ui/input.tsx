import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const baseInput =
  "w-full px-3 py-2 rounded-lg bg-bg border border-border focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 transition text-sm placeholder:text-fg-subtle";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(baseInput, className)} {...props} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(baseInput, "min-h-[80px] resize-y", className)}
        {...props}
      />
    );
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(baseInput, "appearance-none pr-8", className)} {...props}>
        {children}
      </select>
    );
  }
);

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("text-xs font-medium text-fg-muted mb-1.5 block", className)}>
      {children}
    </label>
  );
}

export function FormField({
  label,
  children,
  hint
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-fg-subtle mt-1">{hint}</p>}
    </div>
  );
}
