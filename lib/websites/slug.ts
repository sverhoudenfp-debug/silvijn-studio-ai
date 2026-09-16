/**
 * Slug-helpers voor gegenereerde websites (Fase 9/10).
 * Centraal zodat de generator (service) én de QC (security-check)
 * dezelfde definitie van een veilige slug delen.
 */

/** Slugify: veilige URL-segmenten zonder path traversal of speciale tekens. */
export function slugifyBusinessName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "website"
  );
}

/** Path traversal/onzin in slugs detecteren (security-check Fase 10). */
export function slugContainsPathTraversal(slug: string): boolean {
  return /[/\\]|\.\.|%2e|%2f/i.test(slug) || slug.includes("..");
}
