import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { masterPricingConfiguration } from "../lib/pricing/master-config";
import { calculatePriceIndication } from "../lib/pricing/engine";
import { getAIConfig } from "../lib/ai/config";
const root = process.cwd();
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]); }
const config = () => masterPricingConfiguration({ currency: "EUR", version: "test", firstPage: 895, extraPage: 200, webshopFrom: 2495, vatRate: null });
test("895 first page, 200 additional page: one/three page exact totals", () => {
  for (const [pages, expected] of [[1,895],[3,1295]]) {
    const result=calculatePriceIndication({projectId:"test",requirements:{websiteType:"business_website",numberOfPages:pages}},config());
    assert.equal(result.total,expected); assert.equal(result.status,"ready");
  }
});
test("unknown page count blocks a concrete price", () => {
  const r=calculatePriceIndication({projectId:"test",requirements:{websiteType:"business_website"}},config());
  assert.equal(r.status,"missing_information"); assert.equal(r.total,0);
});
test("webshop amount comes only from central configuration", () => {
  const r=calculatePriceIndication({projectId:"test",requirements:{websiteType:"webshop",numberOfPages:1,ecommerce:true}},config());
  assert.equal(r.basePrice,2495);
});
test("unconfigured requested add-on is never silently free", () => {
  const r=calculatePriceIndication({projectId:"test",requirements:{websiteType:"business_website",numberOfPages:1,photography:true}},config());
  assert.equal(r.status,"missing_information");
});
test("invalid central pricing configuration rejected", () => {
  assert.throws(()=>masterPricingConfiguration({currency:"EUR",version:"test",firstPage:-1,extraPage:200,webshopFrom:2495,vatRate:null}));
});
test("every exported protected server action awaits owner authorization first", () => {
  const list=[...files(path.join(root,"app/actions")),path.join(root,"app/(dashboard)/lead-discovery/actions.ts")];
  let checked=0;
  for(const f of list){
    const source=ts.createSourceFile(f,readFileSync(f,"utf8"),ts.ScriptTarget.Latest,true);
    for(const n of source.statements) if(ts.isFunctionDeclaration(n)&&n.body&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)){
      assert.match(n.body.statements[0].getText(source),/^await requireStudioOwner\(\);$/,`${f}:${n.name?.text}`); checked++;
    }
  }
  assert.equal(checked,48);
});
test("all protected pages and layouts authorize before reads", () => {
  for(const f of files(path.join(root,"app/(dashboard)")).filter(f=>/\/(page|layout)\.tsx$/.test(f))){
    const source=ts.createSourceFile(f,readFileSync(f,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    for(const n of source.statements) if(ts.isFunctionDeclaration(n)&&n.body&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) assert.match(n.body.statements[0].getText(source),/^await requireStudioOwner\(\);$/,f);
  }
});
test("live generation cannot silently select Next.js", () => {
  const s=readFileSync(path.join(root,"lib/websites/service.ts"),"utf8");
  assert.match(s,/framework: "nextjs" \| "shopify" = "shopify"/);
  assert.match(s,/await assertProductionAuthorized\(projectId\)/);
});
test("public health does not expose configuration or query database", () => {
  const s=readFileSync(path.join(root,"app/api/health/route.ts"),"utf8");
  assert.doesNotMatch(s,/getAIConfig|getSupabase|process\.env|models|forbiddenActions/);
});
test("invalid AI_MODE rejected instead of silent mock fallback", () => {
  const before=process.env.AI_MODE;
  try { process.env.AI_MODE="liv"; assert.throws(()=>getAIConfig(),/AI_MODE/); }
  finally { if(before===undefined) delete process.env.AI_MODE; else process.env.AI_MODE=before; }
});
