import { cn } from "@/lib/utils";

/**
 * Centrale button-primitive (Fase 13): één consistente stijl voor
 * primary / secondary / success / destructive / ghost, met vaste
 * focus-ring, hover- en disabled-states. Puur visueel.
 */

type ButtonVariant = "primary" | "secondary" | "success" | "destructive" | "ghost";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-indigo-600 text-zinc-50 hover:bg-indigo-500",
  secondary:
    "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100",
  success:
    "border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60",
  destructive:
    "border-red-500/30 bg-red-950/40 text-red-300 hover:bg-red-950/70",
  ghost:
    "border-transparent bg-transparent text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100",
};

export function buttonClasses(variant: ButtonVariant, className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50",
    variantClasses[variant],
    className
  );
}

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type="button" className={buttonClasses(variant, className)} {...props}>
      {children}
    </button>
  );
}
