import Database from 'better-sqlite3';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import { normalizeMedicationSearch } from '../../src/domain/medications/normalize-medication-search';

const SPECIALTY_COLUMN_COUNT = 12;
const PRESENTATION_COLUMN_COUNT = 13;

export type ImportOptions = {
  specialtiesPath: string;
  presentationsPath: string;
  outputPath: string;
  specialtiesSourceDate: string;
  presentationsSourceDate: string;
};

export type ImportSummary = {
  specialties: number;
  presentations: number;
  orphanPresentations: number;
};

type SpecialtyRow = {
  cis: string;
  name: string;
  pharmaceuticalForm: string | null;
  administrationRoutes: string | null;
  authorizationStatus: string | null;
  procedureType: string | null;
  marketingStatus: string | null;
  authorizationDate: string | null;
  bdpmStatus: string | null;
  europeanAuthorizationNumber: string | null;
  holders: string | null;
  enhancedMonitoring: string | null;
};

type PresentationRow = {
  cis: string;
  cip7: string;
  label: string;
  presentationStatus: string | null;
  marketingStatus: string | null;
  marketingDeclarationDate: string | null;
  cip13: string;
};

export async function importBdpm(
  options: ImportOptions,
): Promise<ImportSummary> {
  validateSourceDate(options.specialtiesSourceDate);
  validateSourceDate(options.presentationsSourceDate);
  const specialtyRows = parseSpecialties(
    await readFile(options.specialtiesPath),
    options.specialtiesPath,
  );
  const presentationRows = parsePresentations(
    await readFile(options.presentationsPath),
    options.presentationsPath,
  );
  const specialtyIds = new Set(specialtyRows.map((row) => row.cis));

  const orphanPresentations = presentationRows.filter(
    (presentation) => !specialtyIds.has(presentation.cis),
  ).length;

  const outputPath = resolve(options.outputPath);
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  const database = new Database(temporaryPath);
  try {
    createSchema(database);
    database.transaction(() => {
      insertMetadata(database, options, orphanPresentations);
      insertSpecialties(database, specialtyRows);
      insertPresentations(database, presentationRows);
      database.exec(
        "INSERT INTO medication_search(medication_search) VALUES ('optimize')",
      );
    })();
    database.pragma('journal_mode = DELETE');
    database.pragma('optimize');
    database.exec('VACUUM');
  } finally {
    database.close();
  }

  await rm(outputPath, { force: true });
  await rename(temporaryPath, outputPath);

  return {
    specialties: specialtyRows.length,
    presentations: presentationRows.length,
    orphanPresentations,
  };
}

function parseSpecialties(
  contents: Buffer,
  sourcePath: string,
): SpecialtyRow[] {
  const text = new TextDecoder('windows-1252').decode(contents);
  return parseLines(text, sourcePath, SPECIALTY_COLUMN_COUNT, (columns) => {
    const cis = requiredIdentifier(columns[0], 'CIS', /^\d{8}$/);
    const name = requiredText(columns[1], 'dénomination', cis);
    return {
      cis,
      name,
      pharmaceuticalForm: optionalText(columns[2]),
      administrationRoutes: optionalText(columns[3]),
      authorizationStatus: optionalText(columns[4]),
      procedureType: optionalText(columns[5]),
      marketingStatus: optionalText(columns[6]),
      authorizationDate: optionalText(columns[7]),
      bdpmStatus: optionalText(columns[8]),
      europeanAuthorizationNumber: optionalText(columns[9]),
      holders: optionalText(columns[10]),
      enhancedMonitoring: optionalText(columns[11]),
    };
  });
}

function parsePresentations(
  contents: Buffer,
  sourcePath: string,
): PresentationRow[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(contents);
  return parseLines(text, sourcePath, PRESENTATION_COLUMN_COUNT, (columns) => {
    const cis = requiredIdentifier(columns[0], 'CIS', /^\d{8}$/);
    return {
      cis,
      cip7: requiredIdentifier(columns[1], 'CIP7', /^\d{7}$/),
      label: requiredText(columns[2], 'libellé de présentation', cis),
      presentationStatus: optionalText(columns[3]),
      marketingStatus: optionalText(columns[4]),
      marketingDeclarationDate: optionalText(columns[5]),
      cip13: requiredIdentifier(columns[6], 'CIP13', /^\d{13}$/),
    };
  });
}

function parseLines<T>(
  text: string,
  sourcePath: string,
  expectedColumnCount: number,
  map: (columns: string[]) => T,
): T[] {
  const rows: T[] = [];
  const seen = new Set<string>();

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.length === 0) continue;
    const columns = line.split('\t');
    if (columns.length !== expectedColumnCount) {
      throw new Error(
        `${sourcePath}, ligne ${index + 1}: ${expectedColumnCount} colonnes attendues, ${columns.length} reçues.`,
      );
    }
    const row = map(columns);
    const identifier = getRowIdentifier(row);
    if (seen.has(identifier)) {
      throw new Error(
        `${sourcePath}, ligne ${index + 1}: identifiant dupliqué ${identifier}.`,
      );
    }
    seen.add(identifier);
    rows.push(row);
  }

  if (rows.length === 0)
    throw new Error(`${sourcePath} ne contient aucune donnée.`);
  return rows;
}

function getRowIdentifier(row: unknown): string {
  if (isPresentationRow(row)) return row.cip13;
  return (row as SpecialtyRow).cis;
}

function isPresentationRow(row: unknown): row is PresentationRow {
  return typeof row === 'object' && row !== null && 'cip13' in row;
}

function requiredIdentifier(
  value: string,
  field: string,
  pattern: RegExp,
): string {
  const normalized = value.trim();
  if (!pattern.test(normalized))
    throw new Error(`${field} invalide: ${JSON.stringify(value)}.`);
  return normalized;
}

function requiredText(
  value: string,
  field: string,
  identifier: string,
): string {
  const normalized = value.trim();
  if (normalized.length === 0)
    throw new Error(`${field} vide pour ${identifier}.`);
  return normalized;
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function validateSourceDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--source-date doit respecter le format AAAA-MM-JJ.');
  }
}

function createSchema(database: Database.Database): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE specialties (
      cis TEXT PRIMARY KEY NOT NULL CHECK(length(cis) = 8),
      name TEXT NOT NULL,
      pharmaceutical_form TEXT,
      administration_routes TEXT,
      authorization_status TEXT,
      procedure_type TEXT,
      marketing_status TEXT,
      authorization_date TEXT,
      bdpm_status TEXT,
      european_authorization_number TEXT,
      holders TEXT,
      enhanced_monitoring TEXT
    ) WITHOUT ROWID;
    CREATE TABLE presentations (
      cip13 TEXT PRIMARY KEY NOT NULL CHECK(length(cip13) = 13),
      cis TEXT NOT NULL CHECK(length(cis) = 8),
      cip7 TEXT NOT NULL CHECK(length(cip7) = 7),
      label TEXT NOT NULL,
      presentation_status TEXT,
      marketing_status TEXT,
      marketing_declaration_date TEXT
    ) WITHOUT ROWID;
    CREATE INDEX presentations_by_cis ON presentations(cis, cip13);
    CREATE VIRTUAL TABLE medication_search USING fts5(
      cis UNINDEXED,
      search_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

function insertMetadata(
  database: Database.Database,
  options: ImportOptions,
  orphanPresentations: number,
): void {
  const insert = database.prepare(
    'INSERT INTO metadata (key, value) VALUES (?, ?)',
  );
  insert.run('schema_version', '1');
  insert.run('source', 'Base de données publique des médicaments (BDPM)');
  insert.run('specialties_source_date', options.specialtiesSourceDate);
  insert.run('presentations_source_date', options.presentationsSourceDate);
  insert.run('orphan_presentations', String(orphanPresentations));
  insert.run('generated_at', new Date().toISOString());
}

function insertSpecialties(
  database: Database.Database,
  rows: SpecialtyRow[],
): void {
  const insert = database.prepare(`
    INSERT INTO specialties VALUES (
      @cis, @name, @pharmaceuticalForm, @administrationRoutes,
      @authorizationStatus, @procedureType, @marketingStatus, @authorizationDate,
      @bdpmStatus, @europeanAuthorizationNumber, @holders, @enhancedMonitoring
    )
  `);
  const insertSearch = database.prepare(
    'INSERT INTO medication_search (cis, search_text) VALUES (?, ?)',
  );
  for (const row of rows) {
    insert.run(row);
    insertSearch.run(
      row.cis,
      normalizeMedicationSearch(`${row.name} ${row.pharmaceuticalForm ?? ''}`),
    );
  }
}

function insertPresentations(
  database: Database.Database,
  rows: PresentationRow[],
): void {
  const insert = database.prepare(`
    INSERT INTO presentations VALUES (
      @cip13, @cis, @cip7, @label, @presentationStatus,
      @marketingStatus, @marketingDeclarationDate
    )
  `);
  for (const row of rows) insert.run(row);
}

export function parseImportArguments(arguments_: string[]): ImportOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error(
        'Arguments attendus: --specialties, --presentations, --output, ' +
          '--specialties-source-date, --presentations-source-date.',
      );
    }
    values.set(key, value);
  }
  const read = (key: string) => {
    const value = values.get(key);
    if (value === undefined) throw new Error(`Argument ${key} manquant.`);
    return value;
  };
  return {
    specialtiesPath: read('--specialties'),
    presentationsPath: read('--presentations'),
    outputPath: read('--output'),
    specialtiesSourceDate: read('--specialties-source-date'),
    presentationsSourceDate: read('--presentations-source-date'),
  };
}
