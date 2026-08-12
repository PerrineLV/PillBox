import { readFile, writeFile } from 'node:fs/promises';

export type SourceDates = {
  specialtiesSourceDate: string;
  presentationsSourceDate: string;
  genericsSourceDate: string;
};

export type SourceDatesComparison = {
  changed: boolean;
  changedFields: Array<keyof SourceDates>;
};

const SOURCE_FILES: Array<{ filename: string; field: keyof SourceDates }> = [
  { filename: 'CIS_bdpm.txt', field: 'specialtiesSourceDate' },
  { filename: 'CIS_CIP_bdpm.txt', field: 'presentationsSourceDate' },
  { filename: 'CIS_GENER_bdpm.txt', field: 'genericsSourceDate' },
];

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FRENCH_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseFrenchDate(value: string): string {
  const match = FRENCH_DATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(
      `Date BDPM invalide: ${JSON.stringify(value)} (format attendu JJ/MM/AAAA).`,
    );
  }
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  const isRealDate =
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day);
  if (!isRealDate) {
    throw new Error(`Date BDPM invalide: ${JSON.stringify(value)}.`);
  }
  return iso;
}

export function formatFrenchDate(iso: string): string {
  if (!ISO_DATE_PATTERN.test(iso)) {
    throw new Error(
      `Date ISO invalide: ${JSON.stringify(iso)} (attendu AAAA-MM-JJ).`,
    );
  }
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export function extractSourceDatesFromHtml(html: string): SourceDates {
  const dates = {} as SourceDates;
  for (const { filename, field } of SOURCE_FILES) {
    const anchorPattern = new RegExp(
      `href="/download/file/${escapeRegExp(filename)}"[\\s\\S]*?</a>`,
    );
    const anchorMatch = anchorPattern.exec(html);
    if (!anchorMatch) {
      throw new Error(
        `Page de téléchargement BDPM: lien introuvable pour ${filename}. Le format de la page a peut-être changé.`,
      );
    }
    const dateMatch = /Date de mise à jour\s*:\s*(\d{2}\/\d{2}\/\d{4})/.exec(
      anchorMatch[0],
    );
    if (!dateMatch) {
      throw new Error(
        `Page de téléchargement BDPM: date de mise à jour introuvable pour ${filename}. Le format de la page a peut-être changé.`,
      );
    }
    dates[field] = parseFrenchDate(dateMatch[1]);
  }
  return dates;
}

export function compareSourceDates(
  previous: SourceDates,
  current: SourceDates,
): SourceDatesComparison {
  const changedFields = SOURCE_FILES.map(({ field }) => field).filter(
    (field) => previous[field] !== current[field],
  );
  return { changed: changedFields.length > 0, changedFields };
}

export function assertSourceDates(value: SourceDates, context: string): void {
  for (const { field } of SOURCE_FILES) {
    if (!ISO_DATE_PATTERN.test(value[field])) {
      throw new Error(
        `${context}: champ ${field} manquant ou invalide (attendu AAAA-MM-JJ), reçu ${JSON.stringify(value[field])}.`,
      );
    }
  }
}

export async function readSourceDatesState(path: string): Promise<SourceDates> {
  const raw = await readFile(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${path}: JSON invalide.`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${path}: contenu invalide.`);
  }
  const record = parsed as Record<string, unknown>;
  const dates = {} as SourceDates;
  for (const { field } of SOURCE_FILES) {
    const value = record[field];
    if (typeof value !== 'string') {
      throw new Error(
        `${path}: champ ${field} manquant ou invalide (attendu AAAA-MM-JJ).`,
      );
    }
    dates[field] = value;
  }
  assertSourceDates(dates, path);
  return dates;
}

export async function writeSourceDatesState(
  path: string,
  dates: SourceDates,
): Promise<void> {
  assertSourceDates(dates, path);
  const content = `${JSON.stringify(dates, null, 2)}\n`;
  await writeFile(path, content, 'utf-8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
