from pathlib import Path

p = Path("lib/websites/theme-zip/theme-builder.ts")
s = p.read_text()

# 1) Builder vervangen door inline assign-blok (geen render-isolatie nodig)
start = s.index("function buildSeoOverrideSnippets(")
end = s.index("function buildMetaTagsSnippet(): ThemeFile {")
new_builder = '''/**
 * W10: SEO per paginatype. De waarden staan als Liquid-assigns IN de layout,
 * niet in een gerenderde snippet: `render` heeft in Liquid een geïsoleerde
 * scope, dus assigns daaruit bereiken het <title> nooit.
 */
function buildSeoAssignmentBlock(
  pages: ReadonlyArray<{ suffix: string; title: string | null; description: string | null }>,
  kind: "title" | "description",
): string {
  const variable = kind === "title" ? "seo_page_title" : "seo_page_description";
  const pick = (page: { title: string | null; description: string | null }) =>
    kind === "title" ? page.title : page.description;
  const esc = (value: string): string => value.replace(/"/g, '\\\\"');
  const home = pages.find((page) => page.suffix === "home" || page.suffix === "index") ?? null;
  const subpages = pages.filter((page) => page !== home && pick(page));
  const lines: string[] = [`{%- assign ${variable} = "" -%}`];
  if (home && pick(home)) {
    lines.push(
      `{%- if template.name == 'index' -%}{%- assign ${variable} = "${esc(pick(home)!)}" -%}{%- endif -%}`,
    );
  }
  if (subpages.length > 0) {
    lines.push("{%- case template.suffix -%}");
    for (const page of subpages) {
      lines.push(`{%- when '${page.suffix}' -%}{%- assign ${variable} = "${esc(pick(page)!)}" -%}`);
    }
    lines.push("{%- endcase -%}");
  }
  return lines.join("");
}

'''
s = s[:start] + new_builder + s[end:]

# 2) Layout: capture-block vervangen door de assign-blokken
old_layout = """    {%- capture seo_page_title -%}{%- render 'seo-title' -%}{%- endcapture -%}
    {%- capture seo_page_description -%}{%- render 'seo-description' -%}{%- endcapture -%}
    {%- assign seo_page_title = seo_page_title | strip -%}
    {%- assign seo_page_description = seo_page_description | strip -%}
    <title>"""
new_layout = """    {{ seo_assignments }}
    <title>"""
assert old_layout in s
s = s.replace(old_layout, new_layout, 1)

# 3) Aanroep: snippets niet meer in de bestandenset; assignments in de layout
old_call_start = s.index("  files.push(\n    ...buildSeoOverrideSnippets(")
old_call_end = s.index("  );\n", old_call_start) + len("  );\n")
s = s[:old_call_start] + s[old_call_end:]

# 4) Na het bouwen van de layout de assignments invullen
anchor = "  files.push(buildThemeLayout(spec, tokens));"
replacement = """  const layoutFile = buildThemeLayout(spec, tokens);
  const seoPages = (sanitizedContentPlan?.pages ?? []).map((page) => ({
    suffix: page.key,
    title: page.seo?.title ?? null,
    description: page.seo?.metaDescription ?? null,
  }));
  layoutFile.content = layoutFile.content.replace(
    "{{ seo_assignments }}",
    buildSeoAssignmentBlock(seoPages, "title") + buildSeoAssignmentBlock(seoPages, "description"),
  );
  files.push(layoutFile);"""
assert anchor in s
s = s.replace(anchor, replacement, 1)

p.write_text(s)
print("SEO inline in de layout")
