import type { BlueprintSectionType } from "./section-registry";
export interface D3CompositionDefinition {
  key: string; label: string; family: string; mobileStrategy: string; minItems: number; requiresMedia: boolean;
}
type Entry = [string, string, string, number, boolean?];
const MOBILE: Record<string,string> = {
  editorial: "ordered_editorial_stack", list: "ordered_compact_list", grid: "ordered_single_column",
  featured: "featured_first_then_stack", split: "content_first_media_second", bento: "ordered_single_column",
  horizontal: "vertical_stack_no_scroll", card: "compact_single_column", statement: "fluid_type_cta_visible",
  timeline: "single_axis_timeline", quote: "quote_then_attribution", form: "info_then_full_width_form",
};
const list = (entries: Entry[]): readonly D3CompositionDefinition[] => entries.map(([key,label,family,minItems,requiresMedia=false]) => ({key,label,family,minItems,requiresMedia,mobileStrategy:MOBILE[family]}));
const services = list([
  ["editorial_list","Redactionele lijst","editorial",1], ["numbered_list","Genummerde lijst","list",2],
  ["asymmetric_grid","Asymmetrisch grid","grid",3], ["featured_service","Uitgelicht met secundair aanbod","featured",2],
  ["split_media","Beeld naast aanbod","split",1,true], ["bento","Bento-compositie","bento",3],
  ["horizontal","Horizontale compositie","horizontal",2], ["stacked_cards","Gestapelde kaarten","card",2],
  ["minimal_list","Minimale lijst","list",1],
]);
const gallery = list([
  ["editorial_grid","Redactioneel grid","editorial",2,true], ["bento","Bento-galerij","bento",3,true],
  ["featured_project","Uitgelicht project met secundaire","featured",2,true],
  ["asymmetric_gallery","Asymmetrische galerij","grid",3,true], ["horizontal_showcase","Horizontale presentatie","horizontal",2,true],
]);
export const D3_COMPOSITIONS: Partial<Record<BlueprintSectionType, readonly D3CompositionDefinition[]>> = {
  services,
  about: list([["editorial_split","Redactionele split","split",0],["image_led","Beeldgestuurd verhaal","featured",0,true],["asymmetric","Asymmetrisch verhaal","editorial",0],["statement","Groot statement met toelichting","statement",0],["story_timeline","Verhaal in leesvolgorde","timeline",0]]),
  projects: gallery, gallery,
  process: list([["numbered_editorial","Genummerd redactioneel","editorial",2],["horizontal_steps","Horizontale stappen","horizontal",2],["vertical_timeline","Verticale tijdlijn","timeline",2],["alternating","Afwisselende stappen","split",2]]),
  testimonials: list([["featured_quote","Uitgelichte quote","featured",1],["portrait_quote","Quote met portret","quote",1,true],["stacked","Gestapelde quotes","quote",1],["quote_wall","Grote quotewand","grid",2]]),
  cta: list([["full_statement","Volledig statement","statement",0],["image_cta","Beeld met actie","split",0,true],["split_cta","Gesplitste actie","split",0],["immersive_cta","Immersieve actie","featured",0,true],["floating_card","Vrijstaande actiekaart","card",0]]),
  contact: list([["editorial_contact","Redactioneel contact","editorial",0],["split_form","Formulier naast gegevens","form",0],["image_form","Beeld met formulier","form",0,true],["large_type","Grote contacttypografie","statement",0]]),
  benefits: services.filter(d=>["editorial_list","featured_service","bento"].includes(d.key)),
  rich_text: list([["editorial_split","Redactionele tekstkolommen","split",0],["statement","Groot tekststatement","statement",0]]),
};
export function getD3Composition(type: BlueprintSectionType, key: string): D3CompositionDefinition | undefined {
  return D3_COMPOSITIONS[type]?.find(definition=>definition.key===key);
}
export function buildD3CompositionContract(): string {
  return [
    "D3 COMPOSITION: kies voor elk ondersteund type een composition: {variant,density,importance,rationale}. density uitsluitend compact|balanced|airy; importance primary|supporting. rationale: 1 feitelijke ontwerpzin (max 400 tekens). Bestaande layout blijft verplicht en geldig.",
    "Kies op inhoudshoeveelheid, werkelijke item-aantallen, belang, conversiedoel, branche, brandPersonality, artDirection, imageryBalance, paginadoel en desktop/mobile. Vier diensten hoeven geen vier gelijke kaarten te zijn: featured_service geeft het primaire aanbod nadruk. Wissel STRUCTUUR af, niet alleen alignment. Geen hero-cards-about-CTA automatisme, geen sitebrede herhaling van card-grids. Herhaald contact/CTA is wel functioneel.",
    'VOORBEELD VAN EEN VOLLEDIG GELDIGE DIENSTENSECTIE: {"type":"services","layout":"grid","blocks":[{"kind":"service","hint":null},{"kind":"service","hint":null}],"media":[],"cta":null,"background":"default","motion":"none","contentHints":null,"composition":{"variant":"featured_service","density":"compact","importance":"primary","rationale":"Hoofdaanbod met secundair aanbod zonder verzonnen inhoud."}}. Hier is layout=grid, NIET featured_service. Voor about-statement: layout=story en composition.variant=statement. D3-variantnamen mogen NOOIT in layout staan. motion is altijd none|fade_up|stagger, nooit subtle, fade of rise.',
    "NIET-ONDERSTEUNDE TYPES: hero, usp_band, stats, faq, team, rates, newsletter en booking hebben GEEN D3-composition: laat composition VOLLEDIG WEG (niet null, geen variant van een ander type). Hero houdt uitsluitend zijn bestaande layout uit de SECTION-REGISTRY.",
    "BLOKCONTRACT BLIJFT VERPLICHT: D3 verandert NOOIT de verplichte bloktypes of minimale aantallen uit de SECTION-REGISTRY. services vereist minimaal 2 {kind:'service',hint:null}-blokken, process minimaal 2 step-blokken, benefits minimaal 2 benefit-blokken. Ontbrekende echte copy = lege geplande slots met hint:null, NIET blocks:[]. Deze lege slots zijn geen gefabriceerde bedrijfsfeiten. Als de sectie niet functioneel nodig is, plan haar niet.",
    "Een gepland image-slot is GEEN aanwezige afbeelding. Gebruik een beeldgedragen variant uitsluitend met echte aangeleverde media. Bij ontbrekende tekst: compact, met eerlijke merchant/customer slots, NOOIT feiten, quotes, projecten, jaartallen of mijlpalen verzinnen. Geen vrije CSS, extra motion of designscore.",
    ...Object.entries(D3_COMPOSITIONS).map(([type,defs])=>`${type}: ${defs!.map(d=>`${d.key} [familie=${d.family}, minimaal ${d.minItems} items${d.requiresMedia?", echte media vereist":""}, mobile=${d.mobileStrategy}]`).join("; ")}`),
  ].join("\n");
}
