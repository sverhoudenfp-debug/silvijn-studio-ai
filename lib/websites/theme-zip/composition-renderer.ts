import type { ThemeFile } from "./theme-structure";
import type { BlueprintSectionType } from "../blueprint/section-registry";
import { D3_COMPOSITIONS } from "../blueprint/composition-registry";

const heading = `{% if section.settings.heading != blank %}<h2>{{ section.settings.heading | escape }}</h2>{% endif %}{% if section.settings.subheading != blank %}<p>{{ section.settings.subheading | escape }}</p>{% endif %}`;
const media = `{% if section.settings.image != blank %}<figure class="d3-media">{% render 'theme-media', image: section.settings.image, image_mobile: section.settings.image_mobile, alt: section.settings.image_alt, aspect: 'landscape', sizes: '(min-width: 990px) 50vw, 100vw', loading: 'lazy' %}</figure>{% endif %}`;
const body = `{% if section.settings.body != blank %}<div class="d3-prose rte">{{ section.settings.body }}</div>{% endif %}`;
const action = `{% if section.settings.cta_label != blank and section.settings.cta_link != blank %}<div class="d3-action"><a class="btn btn--primary" href="{{ section.settings.cta_link }}">{{ section.settings.cta_label | escape }}</a></div>{% endif %}`;
const details = `<address class="d3-details">{% if section.settings.phone != blank %}<p><a href="tel:{{ section.settings.phone | remove: ' ' }}">{{ section.settings.phone | escape }}</a></p>{% endif %}{% if section.settings.email != blank %}<p><a href="mailto:{{ section.settings.email }}">{{ section.settings.email | escape }}</a></p>{% endif %}{% if section.settings.address != blank %}<p>{{ section.settings.address | escape }}</p>{% endif %}</address>`;

const itemSnippet = `{%- assign d3_title = block.settings.title | default: block.settings.text -%}
{%- assign d3_body = block.settings.description -%}
{%- if kind == 'testimonials' -%}
  {%- if block.settings.quote != blank -%}<blockquote class="d3-quote" {{ block.shopify_attributes }}>{%- if block.settings.image != blank -%}<div class="d3-portrait">{% render 'theme-media', image: block.settings.image, alt: block.settings.author, aspect: 'square', sizes: '120px', loading: 'lazy' %}</div>{%- endif -%}<p>{{ block.settings.quote | escape }}</p>{% if block.settings.author != blank %}<footer>{{ block.settings.author | escape }}</footer>{% endif %}</blockquote>{%- endif -%}
{%- elsif kind == 'gallery' -%}
  {%- if block.settings.image != blank or block.settings.caption != blank -%}<figure class="d3-project" {{ block.shopify_attributes }}>{%- if block.settings.image != blank -%}{% render 'theme-media', image: block.settings.image, alt: block.settings.alt, aspect: 'landscape', sizes: '(min-width: 990px) 50vw, 100vw', loading: 'lazy' %}{%- endif -%}{% if block.settings.caption != blank %}<figcaption>{{ block.settings.caption | escape }}</figcaption>{% endif %}</figure>{%- endif -%}
{%- else -%}
  {%- if d3_title != blank or d3_body != blank or block.settings.image != blank -%}
  <article class="d3-item" {{ block.shopify_attributes }}>
    {% if block.settings.image != blank %}<div class="d3-item-media">{% render 'theme-media', image: block.settings.image, alt: d3_title, aspect: 'landscape', sizes: '(min-width: 990px) 50vw, 100vw', loading: 'lazy' %}</div>{% endif %}
    <div class="d3-item-copy">{% if d3_title != blank %}<h3>{{ d3_title | escape }}</h3>{% endif %}{% if d3_body != blank %}<p>{{ d3_body | escape }}</p>{% endif %}</div>
  </article>
  {%- endif -%}
{%- endif -%}`;

function collection(type: string, variant: string): string {
  const numbered = ["numbered_list","numbered_editorial","vertical_timeline","alternating","horizontal_steps"].includes(variant);
  const featured = ["featured_service","featured_project","featured_quote"].includes(variant);
  const tag = numbered ? "ol" : "ul";
  const capture = `{% assign d3_primary = '' %}{% assign d3_secondary = '' %}{% assign d3_items = '' %}{% assign d3_visible = 0 %}
{% for block in section.blocks %}{% capture d3_item %}{% render 'd3-composition-item', block: block, kind: '${type}' %}{% endcapture %}{% assign d3_item = d3_item | strip %}{% if d3_item != blank %}{% assign d3_visible = d3_visible | plus: 1 %}{% capture d3_li %}<li class="d3-unit">${numbered?'<span class="d3-number" aria-hidden="true">{{ d3_visible }}</span>':""}{{ d3_item }}</li>{% endcapture %}{% assign d3_items = d3_items | append: d3_li %}{% if d3_visible == 1 %}{% assign d3_primary = d3_item %}{% else %}{% assign d3_secondary = d3_secondary | append: d3_li %}{% endif %}{% endif %}{% endfor %}`;
  let content = `<${tag} class="d3-items">{{ d3_items }}</${tag}>`;
  if(featured) content=`<div class="d3-feature"><div class="d3-feature-main">{{ d3_primary }}</div>{% if d3_secondary != blank %}<ul class="d3-feature-secondary">{{ d3_secondary }}</ul>{% endif %}</div>`;
  if(variant==="split_media") content=`<div class="d3-split"><div><ul class="d3-items">{{ d3_items }}</ul></div>${media}</div>`;
  if(variant==="editorial_list"||variant==="numbered_editorial") content=`<div class="d3-editorial"><header>${heading}</header><${tag} class="d3-items">{{ d3_items }}</${tag}></div>`;
  else content=`<header class="d3-heading">${heading}</header>${content}`;
  return `${capture}{% if d3_visible > 0 %}${content}{% elsif request.design_mode %}<p class="d3-slot-note">Vul de bestaande inhoudssloten in om deze compositie te tonen.</p>{% endif %}`;
}
function prose(variant: string): string {
  const intro=`<header class="d3-heading">${heading}</header>`;
  if(variant==="story_timeline")return `${intro}{% if section.settings.body != blank %}<ol class="d3-story">{% assign d3_paragraphs = section.settings.body | split: '</p>' %}{% for paragraph in d3_paragraphs %}{% assign d3_text = paragraph | strip_html | strip %}{% if d3_text != blank %}<li><p>{{ d3_text | escape }}</p></li>{% endif %}{% endfor %}</ol>{% endif %}${media}`;
  if(variant==="statement")return `<div class="d3-statement">${intro}<aside class="d3-support">${body}</aside></div>`;
  if(variant==="image_led")return `<div class="d3-image-led"><div>${intro}${body}</div>${media}</div>`;
  if(variant==="asymmetric")return `<div class="d3-asymmetric-copy">${intro}<div class="d3-support">${body}${media}</div></div>`;
  return `<div class="d3-editorial"><header>${heading}</header><div>${body}${media}</div></div>`;
}
function cta(variant:string):string {
  const copy=`<div class="d3-cta-copy">${heading}</div>`;
  if(variant==="image_cta")return `<div class="d3-split"><div>${copy}${action}</div>${media}</div>`;
  if(variant==="immersive_cta")return `<div class="d3-immersive">${media}<div class="d3-immersive-copy">${copy}${action}</div></div>`;
  if(variant==="floating_card")return `<div class="d3-floating"><div>${copy}</div>${action}</div>`;
  if(variant==="split_cta")return `<div class="d3-cta-split">${copy}${action}</div>`;
  return `<div class="d3-statement">${copy}${action}</div>`;
}
function contact(variant:string,form:string):string {
  const info=`<div class="d3-contact-info">${heading}{% if section.settings.intro != blank %}<p>{{ section.settings.intro | escape }}</p>{% endif %}${details}</div>`;
  const formPart=`{% if section.settings.show_form %}<div class="d3-form">${form}</div>{% endif %}`;
  if(variant==="image_form")return `<div class="d3-contact-image"><div>${info}${media}</div>${formPart}</div>`;
  if(variant==="split_form")return `<div class="d3-contact-split">${info}${formPart}</div>`;
  if(variant==="large_type")return `<div class="d3-contact-large">${info}<div class="d3-support">${formPart}</div></div>`;
  return `<header>${heading}</header><div class="d3-editorial"><div>{% if section.settings.intro != blank %}<p>{{ section.settings.intro | escape }}</p>{% endif %}${details}</div>${formPart}</div>`;
}

function renderComposition(type: BlueprintSectionType, original: string): string {
  let form=original.match(/\{%-?\s*form\s+'contact'[\s\S]*?\{%-?\s*endform\s*-?%\}/)?.[0]??"";
  form=form.replace(/ContactForm(Name|Email|Phone|Message)/g,"ContactForm$1-{{ section.id }}").replace(/form 'contact'/,"form 'contact', id: d3_form_id");
  const variants=D3_COMPOSITIONS[type]!;
  const cases=variants.map(d=> {
    const markup=type==="about"||type==="rich_text"?prose(d.key):type==="cta"?cta(d.key):type==="contact"?contact(d.key,form):collection(type,d.key);
    return `{% when '${d.key}' %}<div class="d3-layout d3-${d.key}" data-mobile-strategy="${d.mobileStrategy}">${markup}</div>`;
  }).join("\n");
  const isProse=type==="about"||type==="rich_text";
  const isCollection=!isProse && type!=="contact" && type!=="cta";
  return `{% assign d3_form_id = 'D3Contact-' | append: section.id %}
{% capture d3_content %}{% case section.settings.composition %}${cases}{% endcase %}{% endcapture %}
${isProse?"{% if section.settings.body != blank or section.settings.image != blank or request.design_mode %}":isCollection?"{% if d3_visible > 0 or request.design_mode %}":""}
<section class="d3-section d3-density-{{ section.settings.composition_density | default: 'balanced' }} section--bg-{{ section.settings.background | default: 'default' }} motion--{{ section.settings.motion | default: 'none' }}"${type==="contact"?' id="contact"':""} data-composition="{{ section.settings.composition }}">
<div class="container">{{ d3_content }}</div></section>${isProse||isCollection?"{% endif %}":""}`;
}

/** Pure transform, invoked only for explicit D3 blueprint instances. */
export function applyD3CompositionRendering(files: ThemeFile[]): ThemeFile[] {
  const transformed=files.map(file=>{
    const type=file.path.match(/^sections\/([^/]+)\.liquid$/)?.[1].replace(/-/g,"_") as BlueprintSectionType|undefined;
    if(!type||!D3_COMPOSITIONS[type])return {...file};
    const match=file.content.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
    if(!match)throw new Error(`D3 missing section schema: ${file.path}`);
    const schema=JSON.parse(match[1]);
    schema.settings.push({type:"select",id:"composition",label:"Inhoudscompositie",default:"legacy",options:[{value:"legacy",label:"Bestaande layout"},...D3_COMPOSITIONS[type]!.map(d=>({value:d.key,label:d.label}))]},
      {type:"select",id:"composition_density",label:"Compositiedichtheid",default:"balanced",options:[{value:"compact",label:"Compact"},{value:"balanced",label:"Gebalanceerd"},{value:"airy",label:"Ruim"}]});
    // Real image slots only; no URLs, generated imagery or invented portraits.
    if(!schema.settings.some((s:{id?:string})=>s.id==="image"))schema.settings.push({type:"image_picker",id:"image",label:"Compositiebeeld (optioneel)"});
    if(type==="testimonials")for(const block of schema.blocks??[])if(!block.settings.some((s:{id?:string})=>s.id==="image"))block.settings.push({type:"image_picker",id:"image",label:"Echt portret (optioneel)"});
    const original=file.content.slice(0,match.index);
    const markup=renderComposition(type,original);
    return {...file,content:`{% if section.settings.composition != blank and section.settings.composition != 'legacy' %}\n${markup}\n{% else %}\n${original}\n{% endif %}\n{% schema %}\n${JSON.stringify(schema,null,2)}\n{% endschema %}\n`};
  });
  transformed.push({path:"snippets/d3-composition-item.liquid",content:itemSnippet},{path:"assets/composition.css",content:compositionCss()});
  return transformed;
}

export function compositionCss():string {
  return `/* D3 composition: shared D1 token scale; no generated CSS, colours or motion. */
.d3-section{--d3-gap:clamp(1rem,3vw,calc(var(--section-spacing,72px)*.5));--d3-pad:var(--section-spacing,72px);padding-block:var(--d3-pad);position:relative;overflow-wrap:anywhere}
.d3-density-compact{--d3-pad:calc(var(--section-spacing,72px)*.6);--d3-gap:clamp(.75rem,2vw,1.5rem)}
.d3-density-airy{--d3-pad:calc(var(--section-spacing,72px)*1.2)}
.d3-section:has(.d3-items:empty),.d3-section:has(.d3-layout:empty){display:none}
.d3-section :where(.d3-layout,.d3-item,.d3-unit,.d3-support,.d3-form,header,aside,figure,article){min-width:0}
.d3-heading{margin-block-end:var(--d3-gap);max-width:65ch}.d3-heading p,.d3-item p{color:var(--color-muted)}
.d3-items,.d3-feature-secondary,.d3-story{padding:0;margin:0;list-style:none;display:grid;gap:var(--d3-gap)}
.d3-unit{position:relative}.d3-item{display:grid;gap:calc(var(--d3-gap)*.6)}.d3-item h3{margin-top:0}.d3-item p{margin-bottom:0}
.d3-media,.d3-project{margin:0}.d3-media img,.d3-item-media img,.d3-project img{display:block;width:100%;height:auto;object-fit:cover;border-radius:var(--radius)}
.d3-prose{max-width:70ch}.d3-prose>*:first-child{margin-top:0}.d3-prose>*:last-child{margin-bottom:0}
.d3-editorial,.d3-split,.d3-asymmetric-copy,.d3-contact-split,.d3-contact-image{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:var(--d3-gap);align-items:start}
.d3-split:not(:has(.d3-media)){grid-template-columns:1fr}.d3-split:has(.d3-media){grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}
.d3-editorial>.d3-items>.d3-unit,.d3-editorial_list .d3-unit{border-top:1px solid var(--color-border);padding-top:calc(var(--d3-gap)*.75)}
.d3-numbered_list .d3-unit,.d3-numbered_editorial .d3-unit{display:grid;grid-template-columns:3ch minmax(0,1fr);gap:var(--d3-gap);border-top:1px solid var(--color-border);padding-top:var(--d3-gap)}
.d3-number{font-family:var(--font-heading);font-size:calc(1.5rem*var(--heading-scale));font-weight:var(--font-weight-heading);color:var(--color-primary)}
.d3-asymmetric_grid .d3-items,.d3-asymmetric_gallery .d3-items{grid-template-columns:repeat(6,minmax(0,1fr))}.d3-asymmetric_grid .d3-unit,.d3-asymmetric_gallery .d3-unit{grid-column:span 2}.d3-asymmetric_grid .d3-unit:first-child,.d3-asymmetric_gallery .d3-unit:first-child{grid-column:span 4;grid-row:span 2}.d3-asymmetric_grid .d3-unit:first-child h3{font-size:calc(2rem*var(--heading-scale))}
.d3-feature{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:var(--d3-gap);align-items:start}.d3-feature:not(:has(.d3-feature-secondary)){grid-template-columns:1fr}.d3-feature-main h3{font-size:calc(2.1rem*var(--heading-scale))}.d3-feature-secondary .d3-unit{border-top:1px solid var(--color-border);padding-top:var(--d3-gap)}
.d3-bento .d3-items{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}.d3-bento .d3-unit{padding:var(--d3-gap);background:var(--color-surface);border-radius:var(--radius)}.d3-bento .d3-unit:first-child{grid-column:span 2}.d3-bento .d3-unit:nth-child(3n){grid-row:span 2}
.d3-horizontal .d3-items,.d3-horizontal_showcase .d3-items,.d3-horizontal_steps .d3-items{grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))}.d3-horizontal_steps .d3-unit{border-top:2px solid var(--color-border);padding-top:var(--d3-gap)}
.d3-stacked_cards .d3-items{max-width:70rem}.d3-stacked_cards .d3-item{grid-template-columns:minmax(0,1fr) minmax(0,2fr);padding:var(--d3-gap);border:1px solid var(--color-border);border-radius:var(--radius)}.d3-stacked_cards .d3-item:not(:has(.d3-item-media)){grid-template-columns:1fr}
.d3-minimal_list .d3-items{gap:0;max-width:70ch}.d3-minimal_list .d3-unit{padding-block:1rem;border-bottom:1px solid var(--color-border)}.d3-minimal_list .d3-item-media{display:none}
.d3-editorial_grid .d3-items{grid-template-columns:repeat(2,minmax(0,1fr))}.d3-editorial_grid .d3-unit:nth-child(even){padding-top:var(--d3-gap)}
.d3-asymmetric-copy{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}.d3-asymmetric-copy>.d3-support{padding-top:calc(var(--d3-gap)*2)}
.d3-statement h2,.d3-contact-large h2{font-size:clamp(2rem,5vw,calc(4rem*var(--heading-scale)));max-width:22ch;line-height:1.08}.d3-statement .d3-support{max-width:60ch;margin-inline-start:auto;margin-block-start:var(--d3-gap)}
.d3-image-led{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:var(--d3-gap);align-items:center}.d3-image-led:not(:has(.d3-media)){grid-template-columns:1fr}
.d3-story,.d3-vertical_timeline .d3-items{max-width:70ch;border-inline-start:1px solid var(--color-border);padding-inline-start:var(--d3-gap)}.d3-story>li,.d3-vertical_timeline .d3-unit{position:relative}.d3-story>li::before,.d3-vertical_timeline .d3-unit::before{content:'';position:absolute;inline-size:.6rem;block-size:.6rem;border-radius:50%;background:var(--color-primary);inset-inline-start:calc(-1*var(--d3-gap) - .3rem);top:.5rem}
.d3-alternating .d3-items{grid-template-columns:repeat(2,minmax(0,1fr))}.d3-alternating .d3-unit{padding:var(--d3-gap);border-inline-start:1px solid var(--color-border)}.d3-alternating .d3-unit:nth-child(even){margin-top:calc(var(--d3-gap)*2)}
.d3-quote{margin:0;font-family:var(--font-heading)}.d3-quote p{font-size:calc(1.6rem*var(--heading-scale));line-height:1.4}.d3-quote footer{font-family:var(--font-body);color:var(--color-muted)}.d3-featured_quote .d3-feature-main .d3-quote p{font-size:clamp(1.8rem,3vw,3rem)}
.d3-portrait_quote .d3-quote{display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:var(--d3-gap)}.d3-portrait{width:6rem;grid-row:span 2}.d3-portrait_quote .d3-quote:not(:has(.d3-portrait)){grid-template-columns:1fr}.d3-stacked .d3-unit{border-top:1px solid var(--color-border);padding-block:var(--d3-gap)}.d3-quote_wall .d3-items{grid-template-columns:repeat(2,minmax(0,1fr))}.d3-quote_wall .d3-unit:nth-child(odd) .d3-quote p{font-size:calc(2rem*var(--heading-scale))}
.d3-action{margin-top:var(--d3-gap)}.d3-action .btn{white-space:normal;max-width:100%;text-align:center;min-height:44px}.d3-cta-split{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:var(--d3-gap);align-items:center}.d3-cta-split .d3-action{margin:0;justify-self:end}
.d3-floating{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--d3-gap);align-items:center;padding:var(--d3-gap);border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-surface);max-width:65rem;margin-inline:auto}.d3-floating .d3-action{margin:0}
.d3-immersive{position:relative;display:grid}.d3-immersive>.d3-media,.d3-immersive-copy{grid-area:1/1}.d3-immersive-copy{align-self:center;z-index:1;background:var(--color-background);padding:var(--d3-gap);max-width:50ch;margin:var(--d3-gap);border-radius:var(--radius)}.d3-immersive:not(:has(.d3-media)) .d3-immersive-copy{margin:0;padding:0;max-width:none}
.d3-details{font-style:normal}.d3-details a{color:inherit;text-underline-offset:.2em}.d3-contact-large .d3-details{font-size:clamp(1.15rem,3vw,2rem)}.d3-contact-large>.d3-support{max-width:46rem;margin-top:var(--d3-gap)}.d3-contact-split:not(:has(.d3-form)),.d3-contact-image:not(:has(.d3-form)){grid-template-columns:1fr}
.d3-form form{margin:0}.d3-form input,.d3-form textarea{width:100%;min-width:0;max-width:100%}.d3-slot-note{font-size:.875rem;color:var(--color-muted);padding:1rem;border:1px dashed var(--color-border)}
body.ad-asymmetric .d3-section{--d3-gap:clamp(1rem,4vw,calc(var(--section-spacing,72px)*.6))}body.ad-editorial .d3-heading{max-width:48ch}body.ad-minimal .d3-bento .d3-unit{background:transparent;border-top:1px solid var(--color-border)}
@media(max-width:989px){.d3-section{--d3-gap:clamp(1rem,4vw,2rem);--d3-pad:calc(var(--section-spacing,72px)*.7)}.d3-bento .d3-items{grid-template-columns:repeat(2,minmax(0,1fr))}.d3-asymmetric_grid .d3-items,.d3-asymmetric_gallery .d3-items{grid-template-columns:repeat(2,minmax(0,1fr))}.d3-asymmetric_grid .d3-unit,.d3-asymmetric_gallery .d3-unit{grid-column:auto;grid-row:auto}.d3-asymmetric_grid .d3-unit:first-child,.d3-asymmetric_gallery .d3-unit:first-child{grid-column:span 2}}
@media(max-width:749px){.d3-section{--d3-pad:clamp(1.5rem,6vw,calc(var(--section-spacing,72px)*.6));--d3-gap:1.25rem}.d3-density-compact{--d3-pad:1.5rem}.d3-section :where(.d3-editorial,.d3-split,.d3-asymmetric-copy,.d3-feature,.d3-image-led,.d3-cta-split,.d3-floating,.d3-contact-split,.d3-contact-image,.d3-items,.d3-stacked_cards .d3-item){grid-template-columns:minmax(0,1fr)}.d3-section .d3-unit{grid-column:auto!important;grid-row:auto!important;margin-top:0}.d3-editorial_grid .d3-unit:nth-child(even),.d3-asymmetric-copy>.d3-support{padding-top:0}.d3-section .d3-heading{margin-bottom:var(--d3-gap)}.d3-statement h2,.d3-contact-large h2{font-size:calc(2rem*var(--heading-scale));max-width:100%}.d3-numbered_list .d3-unit,.d3-numbered_editorial .d3-unit{grid-template-columns:2ch minmax(0,1fr);gap:.75rem}.d3-cta-split .d3-action{justify-self:start}.d3-floating{padding:var(--d3-gap)}.d3-immersive>.d3-media,.d3-immersive-copy{grid-area:auto}.d3-immersive-copy{margin:0;padding-block:var(--d3-gap);padding-inline:0}.d3-media img,.d3-item-media img{max-height:none;aspect-ratio:4/3;object-fit:cover}.d3-section .d3-action{position:static}.d3-quote p{font-size:calc(1.3rem*var(--heading-scale))}}
`;
}
