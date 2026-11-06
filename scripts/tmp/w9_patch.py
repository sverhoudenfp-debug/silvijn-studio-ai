from pathlib import Path

p = Path("lib/websites/theme-zip/theme-builder.ts")
s = p.read_text()

# 1) Layout: SEO-overrides per paginatype
old_title = """    <title>
      {{ page_title | default: shop.name }}
      {%- if page_title != blank and page_title != shop.name and shop.name != blank %} &middot; {{ shop.name }}{% endif -%}
    </title>"""
new_title = """    {%- render 'seo-overrides' -%}
    <title>
      {{ seo_page_title | default: page_title | default: shop.name }}
      {%- if seo_page_title == blank and page_title != blank and page_title != shop.name and shop.name != blank %} &middot; {{ shop.name }}{% endif -%}
    </title>"""
assert old_title in s, "titellokatie niet gevonden"
s = s.replace(old_title, new_title, 1)

old_desc = """    {% assign fallback_description = page_description | default: settings.seo_description %}"""
new_desc = """    {% assign fallback_description = seo_page_description | default: page_description | default: settings.seo_description %}"""
assert old_desc in s, "description-regel niet gevonden"
s = s.replace(old_desc, new_desc, 1)

# 2) Body-klasse met template-suffix zodat CSS per paginatype kan verschillen
old_body = '<body class="template-{{ template.name }}'
new_body = '<body class="template-{{ template.name }}{% if template.suffix %} template-{{ template.suffix }}{% endif %}'
assert old_body in s, "body-regel niet gevonden"
s = s.replace(old_body, new_body, 1)

# 3) Paginakop: kleinere, per paginatype verschillende schaal
old_ph = """.page-header__title {
  font-size: var(--h1-size);"""
new_ph = """.page-header__title {
  /* W10: een paginakop is geen hero. De maat blijft bescheiden en de
     introductie leest als tekst, niet als propositie. */
  font-size: clamp(1.85rem, 1.25rem + 2.1vw, 2.9rem);"""
assert old_ph in s, "page-header__title niet gevonden"
s = s.replace(old_ph, new_ph, 1)

old_intro = """.page-header__intro {
  max-width: 56ch;"""
new_intro = """.page-header__intro {
  font-size: clamp(1rem, 0.96rem + 0.25vw, 1.12rem);
  max-width: 56ch;"""
if old_intro in s:
    s = s.replace(old_intro, new_intro, 1)

# 4) Beeldvlak nooit als leeg wit vlak: achtergrond + minimale vulling
old_media = """.d3-media img, .d3-item-media img, .d3-project img"""
if old_media in s:
    s = s.replace(
        old_media,
        """.d3-media, .d3-item-media, .d3-project, .theme-media { background: var(--color-surface, #f2efe9); }
.d3-media img, .d3-item-media img, .d3-project img""",
        1,
    )

p.write_text(s)
print("theme-builder aangepast")
