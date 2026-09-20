import type { QuestionnaireQuestion } from "./validation";

/**
 * C2 — Design-critical questions (Questionnaire Intelligence, 2026-09-20).
 *
 * Deterministische garantie dat iedere gegenereerde questionnaire een
 * compacte design-kern bevat: acht korte kernvragen die daadwerkelijk
 * invloed hebben op website-architectuur, content en conversie. De AI
 * formuleert de lijst dynamisch (branche-afhankelijk); deze module vult
 * áchteraf deterministisch de ontbrekende kernvragen aan en verwijdert
 * geen bekende informatie-vraag:
 *
 * - is een kernonderwerp al gedekt door een AI-vraag (keyword-match op
 *   het vraaglabel), dan blijft alles zoals het is;
 * - is het onderwerp al betrouwbaar bekend uit de context (keyword-match
 *   op de contextsamenvatting), dan wordt het NIET opnieuw gevraagd;
 * - anders wordt de vaste kernvraag toegevoegd (korte, neutrale tekst —
 *   geen bedrijfsfeiten, dus nooit fabricatie).
 *
 * De maximale lijstgrootte (15) blijft gehandhaafd: moet er plaats worden
 * gemaakt, dan vallen de LAATSTE niet-kernvragen weg — nooit kernvragen.
 */

export interface DesignCoreTopic {
  id: string;
  question: string;
  help: string;
  type: QuestionnaireQuestion["type"];
  /** Herkent een AI-vraag die dit onderwerp al dekt. */
  questionPattern: RegExp;
  /** Herkent betrouwbaar bekende informatie in de contextsamenvatting. */
  knownPattern: RegExp;
}

export const MAX_GENERATED_QUESTIONS = 15;

export const DESIGN_CORE_TOPICS: readonly DesignCoreTopic[] = [
  {
    id: "core_aanbod",
    question: "Wat bied je concreet aan? (diensten of producten)",
    help: "Kort is prima; een lijstje mag ook.",
    type: "textarea",
    questionPattern: /(aanbod|dienst|product|wat.*lever|wat doe|wat bieden)/i,
    knownPattern: /(diensten|aanbod|producten|services)/i,
  },
  {
    id: "core_doelgroep",
    question: "Voor wie is het bedoeld?",
    help: "Je belangrijkste klanten of opdrachtgevers.",
    type: "text",
    questionPattern: /(doelgroep|voor wie|klanten|doelpubliek)/i,
    knownPattern: /(doelgroep|doelpubliek|kerndoelgroep)/i,
  },
  {
    id: "core_usp",
    question: "Waarom zouden klanten voor jullie kiezen?",
    help: "Wat maakt jullie anders of beter dan anderen?",
    type: "textarea",
    questionPattern: /(usp|waarom.*kiezen|onderscheid|differenti|wat maakt jullie anders|uniek)/i,
    knownPattern: /(usp|unique selling|differentiator|onderscheidend)/i,
  },
  {
    id: "core_bewijs",
    question: "Welke reviews, resultaten, projecten, certificeringen of andere betrouwbare bewijzen zijn beschikbaar?",
    help: "Ook goed om te weten: als dit er (nog) niet is, vermeld dat dan gerust.",
    type: "textarea",
    questionPattern: /(review|referent|bewijs|case|certific|resultaat|beoordeling|klachtervaring)/i,
    knownPattern: /(google rating|reviews|referenties|certificering|portfolio van projecten)/i,
  },
  {
    id: "core_doel",
    question: "Wat moet een bezoeker vooral doen op de website?",
    help: "Bijvoorbeeld contact opnemen, een offerte aanvragen of iets anders.",
    type: "text",
    questionPattern: /(doel|wat moet een bezoeker|conversie|actie|offerte|afspraak)/i,
    knownPattern: /(conversiedoel|primair doel|hoofddoel)/i,
  },
  {
    id: "core_stijl",
    question: "Welke uitstraling past bij het bedrijf?",
    help: "Bijvoorbeeld zakelijk, speels, warm, luxe of juist heel simpel.",
    type: "text",
    questionPattern: /(uitstraling|sfeer|stijl|toon|tone of voice|persoonlijkheid)/i,
    knownPattern: /(uitstraling|tone of voice|gewenste stijl|stijlrichting)/i,
  },
  {
    id: "core_kleuren",
    question: "Zijn er bestaande kleuren, een logo of huisstijlregels?",
    help: "Zo niet: dan bepalen wij iets dat past. Zeg het gerust als dit mag.",
    type: "text",
    questionPattern: /(kleur|huisstijl|logo|branding|brand identity|corporate identity)/i,
    knownPattern: /(huisstijl|logo|brand colors|merkkleuren|kleurenpalet|branding)/i,
  },
  {
    id: "core_media",
    question: "Welke foto's of video's zijn beschikbaar?",
    help: "Ook prima als die er (nog) niet zijn — zeg het dan even.",
    type: "text",
    questionPattern: /(foto|beeld|video|media|afbeelding)/i,
    knownPattern: /(foto's beschikbaar|fotos aangeleverd|beeldmateriaal|media beschikbaar)/i,
  },
];

export interface DesignCoreCoverage {
  questions: QuestionnaireQuestion[];
  /** Toegevoegde kernonderwerpen (deterministisch aangevuld). */
  addedTopics: string[];
  /** Kernonderwerpen die al betrouwbaar bekend waren (niet opnieuw gevraagd). */
  knownTopics: string[];
}

/**
 * Vult de AI-vragenlijst deterministisch aan tot de design-kern compleet is.
 * Puur: zelfde input → zelfde output, geen AI, geen feiten-verzinsel.
 */
export function ensureDesignCoreQuestions(
  questions: QuestionnaireQuestion[],
  contextSummary: string
): DesignCoreCoverage {
  const ids = new Set(questions.map((q) => q.id));
  const result = [...questions];
  const addedTopics: string[] = [];
  const knownTopics: string[] = [];

  for (const topic of DESIGN_CORE_TOPICS) {
    const coveredByQuestion = questions.some((q) => topic.questionPattern.test(q.label));
    if (coveredByQuestion) continue;
    if (topic.knownPattern.test(contextSummary)) {
      knownTopics.push(topic.id);
      continue;
    }
    // Binnen de limiet blijven: ruimte maken door de LAATSTE niet-kernvraag
    // te laten vallen — kernvragen zijn nooit de dupe.
    if (result.length >= MAX_GENERATED_QUESTIONS) {
      const coreIds = new Set(DESIGN_CORE_TOPICS.map((t) => t.id));
      let dropIndex = -1;
      for (let i = result.length - 1; i >= 0; i -= 1) {
        if (!coreIds.has(result[i].id)) {
          dropIndex = i;
          break;
        }
      }
      if (dropIndex === -1) break; // niets ruilbaars; limiet gehaald
      result.splice(dropIndex, 1);
    }
    // Vaste kernvraag: vast id, korte tekst, geen bedrijfsfeiten.
    let id = topic.id;
    while (ids.has(id)) id = `${topic.id}_${Math.random().toString(36).slice(2, 6)}`;
    ids.add(id);
    result.push({
      id,
      label: topic.question,
      type: topic.type,
      help: topic.help,
    });
    addedTopics.push(topic.id);
  }

  return { questions: result, addedTopics, knownTopics };
}

/** Kernvraag voor één content-dimensie (voor deterministische follow-ups). */
export function coreQuestionForTopic(topicId: string): QuestionnaireQuestion | null {
  const topic = DESIGN_CORE_TOPICS.find((t) => t.id === topicId);
  if (!topic) return null;
  return {
    id: topic.id,
    label: topic.question,
    type: topic.type,
    help: topic.help,
  };
}
