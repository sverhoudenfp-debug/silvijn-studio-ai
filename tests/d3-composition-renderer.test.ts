import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Liquid } from "liquidjs";
import { builtTheme } from "./fixtures/theme";
import { applyD3CompositionRendering, compositionCss } from "../lib/websites/theme-zip/composition-renderer";
import { D3_COMPOSITIONS } from "../lib/websites/blueprint/composition-registry";

const files=applyD3CompositionRendering(builtTheme());
const dir=mkdtempSync(join(tmpdir(),"d3-liquid-"));
for(const f of files.filter(f=>f.path.startsWith("snippets/")))writeFileSync(join(dir,f.path.slice(9)),f.content);
process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
const liquid=new Liquid({root:dir,extname:".liquid"});
liquid.registerFilter("t",key=>key);
liquid.registerFilter("image_url",()=>"/actual-test-image");
liquid.registerFilter("image_tag",()=>'<img src="/actual-test-image" width="100" height="100" alt="Test">');
async function render(type:string,variant:string,empty=false,editor=false){
 const file=files.find(f=>f.path===`sections/${type.replace(/_/g,"-")}.liquid`)!;
 const source=file.content.slice(0,file.content.indexOf("{% schema %}")).replace(/\{%-?\s*form\s+'contact'[^%]*%\}/g,"<form>").replace(/\{%-?\s*endform\s*-?%\}/g,"</form>");
 return liquid.parseAndRender(source,{request:{design_mode:editor},form:{},section:{id:"fixture",settings:{composition:variant,composition_density:"balanced",heading:"Testkop",body:empty?null:"<p>Verifieerbare testtekst.</p><p>Tweede echte alinea.</p>",subheading:empty?null:"Een toelichting",cta_label:"Contact",cta_link:"/pages/contact",show_form:true,email:"test@example.com"},blocks:Array.from({length:4},(_,i)=>({id:`b${i}`,settings:empty?{}:{title:`Dienst ${i+1}`,text:`Voordeel ${i+1}`,description:`Uitleg ${i+1}`,quote:`Testquote ${i+1}`,author:"Testauteur",caption:`Bijschrift ${i+1}`}}))}});
}
for(const [type,definitions] of Object.entries(D3_COMPOSITIONS))for(const d of definitions!){
 test(`D3 Liquid renders ${type}/${d.key} with explicit ${d.mobileStrategy}`,async()=>{
  const html=await render(type,d.key);assert(html.includes(`data-mobile-strategy="${d.mobileStrategy}"`));assert(html.includes(`data-composition="${d.key}"`));assert(!html.includes("undefined"));
  if(type==="contact"){assert(html.includes('name="contact[email]"'));assert(html.includes('id="ContactFormEmail-fixture"'));assert(html.includes('for="ContactFormEmail-fixture"'));}
  if(["services","projects","process"].includes(type))for(let i=1;i<=4;i++)assert(html.includes(`Dienst ${i}`),"no content dropped");
 });
}
test("D3 featured service has separate primary/secondary DOM, unlike editorial list",async()=>{
 const featured=await render("services","featured_service");const list=await render("services","editorial_list");
 assert(featured.includes('class="d3-feature-main"'));assert(featured.includes('class="d3-feature-secondary"'));assert(!list.includes('class="d3-feature-main"'));assert.equal((featured.match(/Dienst 1/g)??[]).length,1);
});
test("D3 empty content sections are suppressed outside editor, no fake fallback copy",async()=>{
 for(const type of ["services","about","process","testimonials","gallery"]){const variant=D3_COMPOSITIONS[type as keyof typeof D3_COMPOSITIONS]![0].key;const html=await render(type,variant,true);assert(!html.includes("<section"),type);const editor=await render(type,variant,true,true);assert(editor.includes("<section"));}
});
test("D3 timeline uses supplied paragraphs only, never dates or invented milestones",async()=>{
 const html=await render("about","story_timeline");assert(html.includes('class="d3-story"'));assert(html.includes("Tweede echte alinea."));assert(!/20\d\d/.test(html));
});
test("D3 responsive CSS collapses all structural families without clipping or hiding CTA",()=>{
 const css=compositionCss();assert(css.includes("@media(max-width:989px)"));assert(css.includes("@media(max-width:749px)"));
 for(const selector of [".d3-feature",".d3-editorial",".d3-split",".d3-items",".d3-contact-split",".d3-floating"])assert(css.slice(css.indexOf("@media(max-width:749px)")).includes(selector));
 assert(css.includes("minmax(0,1fr)"));assert(css.includes("white-space:normal"));assert(css.includes("min-height:44px"));assert(!/overflow(?:-x)?:\s*hidden/.test(css));assert(!/#[a-f\d]{3,8}\b/i.test(css));assert(!/animation|@keyframes/.test(css));
});
test("D3 transform preserves binary and unrelated files; legacy markup remains verbatim",()=>{
 const original=builtTheme();const transformed=applyD3CompositionRendering(original);
 for(const f of original){const actual=transformed.find(a=>a.path===f.path)!;if(!/^sections\/(services|about|projects|gallery|process|testimonials|cta|contact|benefits|rich-text)\.liquid$/.test(f.path))assert.deepEqual(actual,f);else assert(actual.content.includes(f.content.slice(0,f.content.indexOf("{% schema %}"))));}
});
