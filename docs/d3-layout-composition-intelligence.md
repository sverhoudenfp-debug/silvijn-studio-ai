# D3 Layout & Composition Intelligence

## Scope and safety

D3 adds machine-executable content composition to D1 tokens, D2 art direction, Blueprint v2, ContentPlan, media slots and Theme Certification. It does not generate free CSS, images or additional motion. It does not add a design score or alter price, payment, approval, delivery or transfer permissions.

Old plans without `section.composition` keep the legacy rendering path. D3 is an optional per-instance contract, not a replacement for `section.layout`.

## Pipeline

1. Design planning receives the closed per-section composition catalogue and content, purpose, industry, art-direction and media context.
2. The blueprint records a variant, density, importance and rationale. Unsupported choices fail schema validation.
3. Deterministic planning rules reconcile choices with item counts, media availability and repetition. No content or sections are fabricated.
4. ContentPlan fills the existing content slots. Customer and merchant slots remain empty until real content is supplied.
5. Blueprint template mapping writes `composition` and `composition_density` next to the existing layout/background/motion settings.
6. The D3 renderer supplies structural Liquid alternatives and shared token-based CSS. Unselected sections retain their original markup.
7. Certification audits actual template content, mobile/render contracts and Shopify syntax. QC receives the stored artifact's D3 findings, not a newer unrelated Design Plan.

## Composition contract

```ts
composition?: {
  variant: string; // validated against the closed per-type catalogue
  density: "compact" | "balanced" | "airy";
  importance: "primary" | "supporting";
  rationale: string;
}
```

The catalogue contains 46 per-type variants across services, about, projects, gallery, process, testimonials, CTA, contact, benefits and rich text. Hero and other non-catalogue sections retain their existing contracts.

A planned media slot is not an available photograph. Actual persisted image-upload metadata may inform the planning pass; assigning an uploaded image to a Shopify slot remains manual. Missing media has an explicit text fallback and a pending-slot finding. Layout selection cannot create testimonials, projects, team members, dates or business claims.

## Artifact-level quality rules

- `D3_UNKNOWN_COMPOSITION`: fail closed for unknown type/variant combinations.
- `D3_RENDER_CONTRACT`: fail when a composed template has no bound composition stylesheet.
- `D3_EMPTY_CONTENT_ROLE`: heading-only/empty content requires real customer or merchant input.
- `D3_CONTENT_DENSITY`: actual meaningful items fall below the composition's minimum.
- `D3_MEDIA_SLOT_PENDING`: a media-led choice has no supplied image.
- `D3_EXCESSIVE_SPACE_RISK`: airy density with very little actual content.
- `D3_REPEATED_VISUAL_PATTERN`: consecutive content sections repeat one structural family.
- `D3_TOO_MANY_CARD_COMPOSITIONS`: a page overuses card/grid structures.
- `D3_REPEATED_COMPOSITION`: repeated non-functional type/variant combinations across the site.

Functional CTA/contact repetition is allowed. Warnings do not invent or erase content. These are deterministic structural/content heuristics, not pixel measurements or an aesthetic guarantee.

## Owner visibility

The internal Design Plan panel lists each page's explicit composition, density, importance, rationale and mobile strategy. Existing plan history and human approvals remain unchanged.

## Verification boundary

Automated schema/Liquid/CSS tests, local Liquid rendering and Shopify Theme Check each prove different properties. A certified ZIP is not evidence of a successful Shopify import or a visual approval. Final Shopify runtime inspection and owner approval remain separate steps.

Current local evidence:
- 604 automated tests pass, including 46 individual Liquid rendering cases.
- TypeScript strict, ESLint and production build pass.
- Three pre-D3 reference builds remain byte-identical: 62 legacy files, 61 blueprint/art-direction files, and 69 files with D1 fonts plus D2 art direction (including all six binary WOFF2 assets).
- Local Liquid rendering generated 49 HTML fixtures (three pages plus all 46 composition variants).
- Live AI probes correctly rejected unsupported hero compositions, missing required service blocks and confusion between legacy `layout` and D3 `composition.variant`. The prompt now contains a complete valid section example; bounded design-planning retries receive the actual schema diagnostics rather than repeating the identical invalid request. The strict schemas remain unchanged.

## Live E2E evidence (21 September 2026)

Normal production services, real AI and the explicitly marked existing test fixture:
- Design Plan v22 completed with seven valid D3 choices; ContentPlan v1 completed.
- Website v17: `4d3ad85f-2c81-4ce2-abfc-257ecd8b7beb`.
- ZIP artifact v1: CERTIFIED, 73 files, 201292 bytes. SHA-256 `6b08de1fdc3bf8bb842f86e4a0bdde86f75a6dfdda0fd194de5da1c53d6f9542`.
- External Shopify Theme Check: 0 errors, 13 warnings. Downloaded bytes match the recorded checksum.
- Blueprint-to-template placement: 7/7 exact, preserving section indices, types, variants and density.
- D3 artifact audit: 0 errors; four honest empty-content/density warnings. No invented content, no repeated nonfunctional composition warning.
- Existing QC: PASS, score 28, zero critical/error findings; state becomes READY_FOR_SILVIJN through the existing certification gate. This is internal review readiness, NOT human approval or delivery readiness.
- All 18 lead records, price approvals, payment events and requirements match their pre-run snapshots. Website v16 remains ready_for_silvijn.

## Remaining verification and separate existing issue

No responsive browser measurements or Shopify visual approval are claimed. Local Liquid rendering succeeded for three actual pages and all 46 synthetic stress variants, but the provided browser could not open the uploaded HTML fixture. Actual Shopify import and visual review remain manual.

The fixture lacks real content. Empty service/about sections are not inflated into large blank areas; their slots remain editable and the warnings remain visible. The low existing QC score must not be presented as a high-quality finished customer site.

The live run also exposed an EXISTING QC coverage-source bug outside the D3 artifact audit: `summarizeContentPlanCoverage` sorts all project ContentPlans by `version`, although versions restart per Design Plan. Its coverage prose therefore referenced historical ContentPlan v8 rather than the actual v1 bound to Design Plan v22. D3 composition findings are correctly taken from the certified artifact. The legacy coverage-source lookup has not been silently changed in this D3 release and remains a separate follow-up; do not rely on its old counts.
