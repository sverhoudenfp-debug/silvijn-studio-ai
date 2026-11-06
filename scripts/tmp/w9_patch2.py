from pathlib import Path

p = Path("lib/websites/theme-zip/theme-builder.ts")
s = p.read_text()

# 1) Titel + meta description per paginatype
old_title = """    <title>
      {{ page_title | default: shop.name }}
      {%- if page_title != blank and page_title != shop.name and shop.name != blank %} &middot; {{ shop.name }}{% endif -%}
    </title>"""
new_title = """    {%- render 'seo-overrides' -%}
    <title>
      {{ seo_page_title | default: page_title | default: shop.name }}
      {%- if seo_page_title == blank and page_title != blank and page_title != shop.name and shop.name != blank %} &middot; {{ shop.name }}{% endif -%}
    </title>"""
if old_title in s:
    s = s.replace(old_title, new_title, 1)
    print("titel aangepast")

old_desc = """    {% assign fallback_description = page_description | default: settings.seo_description %}"""
new_desc = """    {% assign fallback_description = seo_page_description | default: page_description | default: settings.seo_description %}"""
if old_desc in s:
    s = s.replace(old_desc, new_desc, 1)
    print("description aangepast")

# 2) Paginakop bescheiden schalen
old_ph = """.page-header__title {
  font-size: var(--h1-size);"""
new_ph = """.page-header__title {
  /* W10: een paginakop is geen hero. Bescheiden maat, per paginatype gelijk. */
  font-size: clamp(1.85rem, 1.25rem + 2.1vw, 2.9rem);"""
if old_ph in s:
    s = s.replace(old_ph, new_ph, 1)
    print("paginakop aangepast")

# 3) Introductie leest als tekst
old_intro = """.page-header__intro {
  max-width: 56ch;"""
new_intro = """.page-header__intro {
  font-size: clamp(1rem, 0.96rem + 0.25vw, 1.12rem);
  max-width: 56ch;"""
if old_intro in s:
    s = s.replace(old_intro, new_intro, 1)
    print("intro aangepast")

# 4) Beeldvlak nooit leeg wit: achtergrondvlak als fallback
old_media = """.d3-media, .d3-project{margin:0}"""
if old_media in s:
    s = s.replace(
        old_media,
        """.d3-media, .d3-project{margin:0}
.d3-media,.d3-item-media,.d3-project,.theme-media{background:var(--color-surface,#f2efe9)}""",
        1,
    )
    print("media-achtergrond toegevoegd")

# 5) SEO-overrides-snippet bouwen
anchor = "function buildMetaTagsSnippet(): ThemeFile {"
if "function buildSeoOverridesSnippet" not in s:
    builder = '''/**
 * W10: per-pagina SEO. De contentplan-SEO is uniek per pagina (titel +
 * meta-omschrijving) en mag niet als één sitebrede titel eindigen. Het thema
 * kent geen per-template <title>, dus deze snippet vertaalt het template naar
 * de juiste waarden. Homepage via template.name, subpagina's via de suffix.
 */
function buildSeoOverridesSnippet(
  pages: ReadonlyArray<{ suffix: string; title: string | null; description: string | null }>,
): ThemeFile {
  const esc = (value: string): string => value.replace(/"/g, '\\\\"');
  const home = pages.find((page) => page.suffix === "home" || page.suffix === "index") ?? null;
  const subpages = pages.filter((page) => page !== home);
  const lines: string[] = ["{%- liquid", "  assign seo_page_title = blank", "  assign seo_page_description = blank"];
  if (home) {
    lines.push("  if template.name == 'index'");
    if (home.title) lines.push(`    assign seo_page_title = "${esc(home.title)}"`);
    if (home.description) lines.push(`    assign seo_page_description = "${esc(home.description)}"`);
    lines.push("  endif");
  }
  if (subpages.length > 0) {
    lines.push("  case template.suffix");
    for (const page of subpages) {
      lines.push(`    when '${page.suffix}'`);
      if (page.title) lines.push(`      assign seo_page_title = "${esc(page.title)}"`);
      if (page.description) lines.push(`      assign seo_page_description = "${esc(page.description)}"`);
    }
    lines.push("  endcase");
  }
  lines.push("-%}");
  return { path: "snippets/seo-overrides.liquid", content: lines.join("\\n") };
}

''' + anchor
    s = s.replace(anchor, builder, 1)
    print("seo-builder toegevoegd")

# 6) Snippet in de bestandenset opnemen
old_files = """  files.push(buildMetaTagsSnippet());"""
new_files = """  files.push(buildMetaTagsSnippet());
  files.push(
    buildSeoOverridesSnippet(
      (sanitizedContentPlan?.pages ?? []).map((page) => ({
        suffix: page.key,
        title: page.seo?.title ?? null,
        description: page.seo?.metaDescription ?? null,
      })),
    ),
  );"""
if old_files in s and "buildSeoOverridesSnippet(\n      (sanitizedContentPlan" not in s:
    s = s.replace(old_files, new_files, 1)
    print("snippet gekoppeld")

p.write_text(s)
print("klaar")
