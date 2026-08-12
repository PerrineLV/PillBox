import { readFile, writeFile } from 'node:fs/promises';

import { writeSourceDatesState, type SourceDates } from './bdpm-source-dates';
import { updateReferenceDocDates } from './update-reference-doc';

const DEFAULT_STATE_PATH = 'assets/medications/source-dates.json';
const DEFAULT_DOC_PATH = 'docs/medications-reference.md';

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const dates: SourceDates = {
    specialtiesSourceDate: requireArgument(
      arguments_,
      '--specialties-source-date',
    ),
    presentationsSourceDate: requireArgument(
      arguments_,
      '--presentations-source-date',
    ),
    genericsSourceDate: requireArgument(arguments_, '--generics-source-date'),
    conditionsSourceDate: requireArgument(
      arguments_,
      '--conditions-source-date',
    ),
  };
  const statePath = arguments_.get('--state-path') ?? DEFAULT_STATE_PATH;
  const docPath = arguments_.get('--doc-path') ?? DEFAULT_DOC_PATH;

  await writeSourceDatesState(statePath, dates);

  const markdown = await readFile(docPath, 'utf-8');
  await writeFile(docPath, updateReferenceDocDates(markdown, dates), 'utf-8');

  console.log(
    `Dates source enregistrées dans ${statePath} ; ${docPath} mis à jour.`,
  );
}

function parseArguments(arguments_: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error(
        'Arguments attendus: --specialties-source-date, --presentations-source-date, ' +
          '--generics-source-date, --conditions-source-date [--state-path] [--doc-path].',
      );
    }
    values.set(key, value);
  }
  return values;
}

function requireArgument(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined) throw new Error(`Argument ${key} manquant.`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
