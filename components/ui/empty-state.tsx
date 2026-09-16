import { cn } from "@/lib/utils";

/**
 * Centrale EmptyState-primitive (Fase 13): één consistente, rustige
 * lege-status over alle modules. Puur visueel — geen logica.
 */
export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">{description}</p>
      ) : null}
    </div>
  );
}
