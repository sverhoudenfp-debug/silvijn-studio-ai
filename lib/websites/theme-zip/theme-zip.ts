import JSZip from "jszip";
import { THEME_ZIP_ENTRY_DATE, type ThemeFile } from "./theme-structure";

/**
 * ZIP-aanmaak en -uitlezing (Fase I.2).
 *
 * Deterministisch: vaste bestandsdatum, vaste volgorde (gesorteerd op pad),
 * vaste compressie — dezelfde thema-input levert byte-identieke ZIP-bytes.
 * Dat maakt checksums vergelijkbaar en regeneraties reproduceerbaar.
 */

const ZIP_FIXED_DATE = new Date(THEME_ZIP_ENTRY_DATE);

export async function createThemeZip(files: ThemeFile[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error("Kan geen leeg thema zippen.");
  const zip = new JSZip();
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    if (zip.file(file.path)) {
      throw new Error(`Dubbel themabestand: "${file.path}".`);
    }
    zip.file(file.path, file.content, {
      date: ZIP_FIXED_DATE,
      createFolders: false,
    });
  }
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/** Leest een ZIP terug naar bestanden (voor validatie en tests). */
export async function readThemeZip(bytes: Uint8Array): Promise<ThemeFile[]> {
  const zip = await JSZip.loadAsync(bytes);
  const files: ThemeFile[] = [];
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    const content = await entry.async("text");
    files.push({ path, content });
  }
  return files;
}
