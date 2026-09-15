export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function scoreVariant(score: number): "success" | "warning" | "neutral" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "neutral";
}
