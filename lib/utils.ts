import type { BadgeVariant, ScoreCategory } from "@/lib/types";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function scoreCategory(score: number): ScoreCategory {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

export function scoreVariant(score: number): BadgeVariant {
  if (score >= 90) return "success";
  if (score >= 75) return "info";
  if (score >= 50) return "warning";
  return "neutral";
}
