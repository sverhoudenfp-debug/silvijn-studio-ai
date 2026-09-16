/**
 * Fictieve inbound-scenario's voor tests en mock mode (Fase 7).
 * ALLEMAAL verzonnen testdata — geen echte personen of bedrijven.
 * Scenario's volgen de Fase 7-eisen (minimaal 10 situaties).
 */

export interface MockInboundScenario {
  id: string;
  label: string;
  sender: string;
  subject: string;
  body: string;
}

export const MOCK_INBOUND_SCENARIOS: MockInboundScenario[] = [
  {
    id: "scenario-interested",
    label: "1. Geïnteresseerde lead",
    sender: "Jeroen Jansen (TESTDATA)",
    subject: "Re: Voorbeeldwebsite voor Jansen Dakwerken",
    body: "Hallo, dit klinkt interessant! Ik zag de voorbeeldwebsite en zou hier graag meer over willen weten. TESTDATA (mock): fictieve reactie van een fictieve lead.",
  },
  {
    id: "scenario-price-request",
    label: "2. Prijsaanvraag",
    sender: "Bakker Elzinga (TESTDATA)",
    subject: "Wat kost een website?",
    body: "Hallo, wat kost een website zoals in jullie voorbeeld? Ik zoek iets voor mijn bakkerij. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-demo-request",
    label: "3. Demo-aanvraag",
    sender: "Mevr. De Vries (TESTDATA)",
    subject: "Voorbeeldwebsite bekijken",
    body: "Goedemiddag, kan ik de voorbeeldwebsite nog eens bekijken? Ik wil de demo zien. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-not-interested",
    label: "4. Niet geïnteresseerd",
    sender: "K. Hendriks (TESTDATA)",
    subject: "Re: uw bericht",
    body: "Hallo, bedankt voor het bericht maar we hebben geen interesse. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-price-objection",
    label: "5. Bezwaar over prijs",
    sender: "P. van den Berg (TESTDATA)",
    subject: "Re: voorstel",
    body: "Het lijkt me veel te duur, buiten ons budget. TESTDATA (mock): fictieve reactie van een fictieve lead.",
  },
  {
    id: "scenario-timing-objection",
    label: "6. Bezwaar over timing",
    sender: "S. Kowalski (TESTDATA)",
    subject: "Re: voorstel",
    body: "Nu niet — we hebben op dit moment geen tijd voor een website, misschien later. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-unclear",
    label: "7. Onduidelijke reactie",
    sender: "Onbekend (TESTDATA)",
    subject: "(geen onderwerp)",
    body: "Hmm zoiets ja misschien weet ik niet zeker nog even over nadenken. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-call-request",
    label: "8. Belverzoek",
    sender: "R. Timmermans (TESTDATA)",
    subject: "Even bellen?",
    body: "Kunnen jullie me even bellen om de mogelijkheden te bespreken? Ik ben doordeweeks bereikbaar. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-opt-out",
    label: "9. Afmelding",
    sender: "Anoniem (TESTDATA)",
    subject: "Afmelden",
    body: "Ik wil geen e-mails meer ontvangen, schrijf ons alstublieft uit. TESTDATA (mock): fictieve reactie.",
  },
  {
    id: "scenario-custom-project",
    label: "10. Complexe/custom aanvraag",
    sender: "Directie Vermeulen (TESTDATA)",
    subject: "Webshop met koppeling",
    body: "We zoeken een complexe webshop met een koppeling naar ons boekingssysteem en Shopify. Kunnen jullie dat maken? TESTDATA (mock): fictieve reactie.",
  },
];

export function getScenario(id: string): MockInboundScenario | undefined {
  return MOCK_INBOUND_SCENARIOS.find((scenario) => scenario.id === id);
}
