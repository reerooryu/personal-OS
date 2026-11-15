import * as React from "react";
import { cn } from "@/lib/utils";

const field = "w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(field, "h-9", className)} {...props} />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(field, "select-chevron h-9 cursor-pointer appearance-none pr-8", className)} {...props} />
));
Select.displayName = "Select";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-20 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({ children, hint, className }: { children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cn("mb-1.5 block text-xs font-medium text-muted", className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-faint">{hint}</span>}
    </label>
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-bad">{children}</p>;
}
