import type { FontPairingKey } from "../visual-contract";

import inter400 from "./fonts/inter-400.json";
import inter600 from "./fonts/inter-600.json";
import inter700 from "./fonts/inter-700.json";
import poppins400 from "./fonts/poppins-400.json";
import poppins600 from "./fonts/poppins-600.json";
import poppins700 from "./fonts/poppins-700.json";
import fraunces400 from "./fonts/fraunces-400.json";
import fraunces600 from "./fonts/fraunces-600.json";
import fraunces700 from "./fonts/fraunces-700.json";
import lora400 from "./fonts/lora-400.json";
import lora600 from "./fonts/lora-600.json";
import lora700 from "./fonts/lora-700.json";
import sourceSans3_400 from "./fonts/source-sans-3-400.json";
import sourceSans3_600 from "./fonts/source-sans-3-600.json";
import nunitoSans400 from "./fonts/nunito-sans-400.json";
import nunitoSans600 from "./fonts/nunito-sans-600.json";
import nunitoSans700 from "./fonts/nunito-sans-700.json";
import spaceGrotesk400 from "./fonts/space-grotesk-400.json";
import spaceGrotesk600 from "./fonts/space-grotesk-600.json";
import spaceGrotesk700 from "./fonts/space-grotesk-700.json";

import licenseInter from "./fonts/licenses/inter.json";
import licensePoppins from "./fonts/licenses/poppins.json";
import licenseFraunces from "./fonts/licenses/fraunces.json";
import licenseLora from "./fonts/licenses/lora.json";
import licenseSourceSans3 from "./fonts/licenses/source-sans-3.json";
import licenseNunitoSans from "./fonts/licenses/nunito-sans.json";
import licenseSpaceGrotesk from "./fonts/licenses/space-grotesk.json";

/**
 * FONT LIBRARY (Design Token Engine D1, 2026-09-21) — kuratore,
 * self-hosted webfont-pairings in de theme-ZIP.
 *
 * LICENTIE: alle fonts zijn SIL Open Font License 1.1 (door Google Fonts
 * uitgegeven). De woff2-bestanden (latin-subset) worden ALS EIGEN assets
 * in de ZIP meegeleverd samen met de originele OFL-licentietekst per
 * familie — juridisch veilig herdistribueren, geen externe CDN-afhan-
 * kelijkheid, geen tracking. De AI kiest uitsluitend een PAIRING-KEY;
 * concrete fonts zijn implementatiedetail (deterministisch, geen
 * AI-keuze per bestand).
 *
 * HEADINGS 400/600/700 + BODY 400/600: 600 dekt knoptekst/eyebrows
 * (font-weight 600 in theme.css), 400 dekt lopende tekst en de
 * merchant-instelling "Normaal". Font-display: swap — de systeemfallback
 * (per pairing behouden) garandeert rendertijd zonder font.
 */

interface FontFaceFile {
  /** Deterministische ZIP-assetnaam, bijv. "font-inter-400.woff2". */
  readonly asset: string;
  readonly family: string;
  readonly weight: string;
  readonly base64: string;
}

interface FontFamilyDefinition {
  readonly cssFamily: string;
  readonly faces: readonly FontFaceFile[];
  readonly fallback: string;
  readonly licenseText: string;
  readonly licenseAsset: string;
}

interface FontPairingDefinition {
  readonly key: FontPairingKey;
  readonly heading: FontFamilyDefinition;
  readonly body: FontFamilyDefinition;
}

function face(family: string, weight: string, base64: string): FontFaceFile {
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  return { asset: `font-${slug}-${weight}.woff2`, family, weight, base64 };
}

function family(
  cssFamily: string,
  faces: readonly FontFaceFile[],
  fallback: string,
  licenseText: string,
  licenseSlug: string
): FontFamilyDefinition {
  return { cssFamily, faces, fallback, licenseText, licenseAsset: `font-license-${licenseSlug}.txt` };
}

const INTER = family(
  "Inter",
  [face("Inter", "400", inter400.base64), face("Inter", "600", inter600.base64), face("Inter", "700", inter700.base64)],
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  licenseInter.text,
  "inter"
);

const POPPINS = family(
  "Poppins",
  [
    face("Poppins", "400", poppins400.base64),
    face("Poppins", "600", poppins600.base64),
    face("Poppins", "700", poppins700.base64),
  ],
  "'Poppins', 'Segoe UI', Roboto, Arial, sans-serif",
  licensePoppins.text,
  "poppins"
);

const FRAUNCES = family(
  "Fraunces",
  [
    face("Fraunces", "400", fraunces400.base64),
    face("Fraunces", "600", fraunces600.base64),
    face("Fraunces", "700", fraunces700.base64),
  ],
  "'Fraunces', Georgia, 'Times New Roman', serif",
  licenseFraunces.text,
  "fraunces"
);

const LORA = family(
  "Lora",
  [face("Lora", "400", lora400.base64), face("Lora", "600", lora600.base64), face("Lora", "700", lora700.base64)],
  "'Lora', Georgia, 'Times New Roman', serif",
  licenseLora.text,
  "lora"
);

const SOURCE_SANS_3 = family(
  "Source Sans 3",
  [
    face("Source Sans 3", "400", sourceSans3_400.base64),
    face("Source Sans 3", "600", sourceSans3_600.base64),
  ],
  "'Source Sans 3', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  licenseSourceSans3.text,
  "source-sans-3"
);

const NUNITO_SANS = family(
  "Nunito Sans",
  [
    face("Nunito Sans", "400", nunitoSans400.base64),
    face("Nunito Sans", "600", nunitoSans600.base64),
    face("Nunito Sans", "700", nunitoSans700.base64),
  ],
  "'Nunito Sans', -apple-system, 'Segoe UI', Verdana, Arial, sans-serif",
  licenseNunitoSans.text,
  "nunito-sans"
);

const SPACE_GROTESK = family(
  "Space Grotesk",
  [
    face("Space Grotesk", "400", spaceGrotesk400.base64),
    face("Space Grotesk", "600", spaceGrotesk600.base64),
    face("Space Grotesk", "700", spaceGrotesk700.base64),
  ],
  "'Space Grotesk', 'SF Mono', 'Cascadia Code', Consolas, monospace",
  licenseSpaceGrotesk.text,
  "space-grotesk"
);

export const FONT_PAIRING_LIBRARY: Readonly<Record<FontPairingKey, FontPairingDefinition>> = {
  modern_sans: { key: "modern_sans", heading: INTER, body: INTER },
  geometric_sans: { key: "geometric_sans", heading: POPPINS, body: INTER },
  editorial_serif: { key: "editorial_serif", heading: FRAUNCES, body: INTER },
  classic_serif: { key: "classic_serif", heading: LORA, body: SOURCE_SANS_3 },
  humanist_sans: { key: "humanist_sans", heading: NUNITO_SANS, body: NUNITO_SANS },
  mono_technical: { key: "mono_technical", heading: SPACE_GROTESK, body: INTER },
};

/** Deterministische @font-face-declaraties (voor {% style %} in theme.liquid). */
export function buildFontFaceCss(pairing: FontPairingKey): string {
  const def = FONT_PAIRING_LIBRARY[pairing];
  const faces = [...def.heading.faces, ...def.body.faces]
    .filter((item, index, all) => all.findIndex((other) => other.asset === item.asset) === index)
    .sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  return faces
    .map(
      (item) =>
        `@font-face { font-family: '${item.family}'; font-style: normal; font-weight: ${item.weight}; font-display: swap; src: url({{ '${item.asset}' | asset_url }}) format('woff2'); }`
    )
    .join("\n      ");
}

/** CSS font-familiewaarden (met behouden systeemfallback) voor :root. */
export function fontFamilyValues(
  pairing: FontPairingKey
): { heading: string; body: string } {
  const def = FONT_PAIRING_LIBRARY[pairing];
  return { heading: def.heading.fallback, body: def.body.fallback };
}

/**
 * Alle ZIP-assets voor een pairing: woff2-bestanden (binair, als bytes)
 * plus de OFL-licentietekst per gebruikte familie. Gesorteerd en
 * ontdubbeld — deterministisch.
 */
export function fontPairingAssets(
  pairing: FontPairingKey
): ReadonlyArray<{ path: string; content: string; bytes?: Uint8Array }> {
  const def = FONT_PAIRING_LIBRARY[pairing];
  const out: Array<{ path: string; content: string; bytes?: Uint8Array }> = [];
  const seenAssets = new Set<string>();
  const addFamily = (fam: FontFamilyDefinition): void => {
    for (const item of fam.faces) {
      if (seenAssets.has(item.asset)) continue;
      seenAssets.add(item.asset);
      const bytes = new Uint8Array(
        atob(item.base64)
          .split("")
          .map((char) => char.charCodeAt(0))
      );
      out.push({ path: `assets/${item.asset}`, content: "", bytes });
    }
  };
  addFamily(def.heading);
  addFamily(def.body);
  const seenLicenses = new Set<string>();
  for (const fam of [def.heading, def.body]) {
    if (seenLicenses.has(fam.licenseAsset)) continue;
    seenLicenses.add(fam.licenseAsset);
    out.push({ path: `assets/${fam.licenseAsset}`, content: `${fam.licenseText}\n` });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
