import { appendFile } from 'node:fs/promises';

import {
  compareSourceDates,
  extractSourceDatesFromHtml,
  readSourceDatesState,
} from './bdpm-source-dates';

const DOWNLOAD_PAGE_URL =
  'https://base-donnees-publique.medicaments.gouv.fr/telechargement';
const DEFAULT_STATE_PATH = 'assets/medications/source-dates.json';

async function main(): Promise<void> {
  const statePath = readStatePathArgument(process.argv.slice(2));

  const response = await fetch(DOWNLOAD_PAGE_URL);
  if (!response.ok) {
    throw new Error(
      `Échec du téléchargement de la page BDPM (${DOWNLOAD_PAGE_URL}): HTTP ${response.status}.`,
    );
  }
  const html = await response.text();
  const current = extractSourceDatesFromHtml(html);
  const previous = await readSourceDatesState(statePath);
  const comparison = compareSourceDates(previous, current);

  console.log(
    comparison.changed
      ? `Changement détecté: ${comparison.changedFields.join(', ')}.`
      : 'Aucun changement de date BDPM détecté.',
  );
  console.log(JSON.stringify({ previous, current, ...comparison }, null, 2));

  await writeGithubOutput({
    changed: String(comparison.changed),
    specialties_source_date: current.specialtiesSourceDate,
    presentations_source_date: current.presentationsSourceDate,
    generics_source_date: current.genericsSourceDate,
  });
}

function readStatePathArgument(arguments_: string[]): string {
  const index = arguments_.indexOf('--state-path');
  if (index === -1) return DEFAULT_STATE_PATH;
  const value = arguments_[index + 1];
  if (value === undefined)
    throw new Error('--state-path nécessite une valeur.');
  return value;
}

async function writeGithubOutput(
  values: Record<string, string>,
): Promise<void> {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  await appendFile(target, lines, 'utf-8');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
