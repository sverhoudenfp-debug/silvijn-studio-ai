export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function scoreVariant(score: number): "success" | "warning" | "neutral" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "neutral";
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
