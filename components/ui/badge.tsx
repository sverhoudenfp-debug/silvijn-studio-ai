import type { BadgeVariant } from "@/lib/types";
import { cn } from "@/lib/utils";

const variantClasses: Record<BadgeVariant, string> = {
  neutral: "bg-zinc-800 text-zinc-300 border-zinc-700",
  success: "bg-emerald-950 text-emerald-300 border-emerald-900",
  warning: "bg-amber-950 text-amber-300 border-amber-900",
  danger: "bg-red-950 text-red-300 border-red-900",
  info: "bg-indigo-950 text-indigo-300 border-indigo-900",
};

export function Badge({
  variant = "neutral",
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
