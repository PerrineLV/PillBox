import Database from 'better-sqlite3';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import { mentionsControlledDispensing } from '../../src/domain/medications/controlled-dispensing-detection';
import { normalizeMedicationSearch } from '../../src/domain/medications/normalize-medication-search';

const SPECIALTY_COLUMN_COUNT = 12;
const PRESENTATION_COLUMN_COUNT = 13;
const GENERIC_GROUP_COLUMN_COUNT = 5;
const CONDITION_COLUMN_COUNT = 2;

export type ImportOptions = {
  specialtiesPath: string;
  presentationsPath: string;
  genericsPath: string;
  outputPath: string;
  specialtiesSourceDate: string;
  presentationsSourceDate: string;
  genericsSourceDate: string;
  /**
   * `CIS_CPD_bdpm` (conditions de prescription et de délivrance, ticket 30).
   * Optionnel pour ne pas casser le workflow automatisé existant
   * (.github/workflows/update-medications.yml), qui n'appelle l'import
   * qu'avec les trois fichiers historiques : sans ce fichier, aucune
   * spécialité n'est détectée comme concernée par une délivrance encadrée,
   * plutôt que d'échouer ou de deviner. `conditionsPath` et
   * `conditionsSourceDate` doivent être fournis ensemble ou pas du tout.
   */
  conditionsPath?: string;
  conditionsSourceDate?: string;
};

export type ImportSummary = {
  specialties: number;
  presentations: number;
  orphanPresentations: number;
  genericGroups: number;
  orphanGenericGroups: number;
  dispensingConditions: number;
  orphanDispensingConditions: number;
  /** Nombre de spécialités distinctes détectées, à confirmer par l'utilisatrice (ticket 30). */
  controlledDispensingSpecialties: number;
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

type GenericGroupRow = {
  groupId: string;
  groupLabel: string;
  cis: string;
  type: string | null;
  sortNumber: string | null;
};

type ConditionRow = {
  cis: string;
  conditionText: string;
};

export async function importBdpm(
  options: ImportOptions,
): Promise<ImportSummary> {
  validateSourceDate(options.specialtiesSourceDate);
  validateSourceDate(options.presentationsSourceDate);
  validateSourceDate(options.genericsSourceDate);
  if (
    (options.conditionsPath === undefined) !==
    (options.conditionsSourceDate === undefined)
  ) {
    throw new Error(
      '--conditions et --conditions-source-date doivent être fournis ensemble.',
    );
  }
  if (options.conditionsSourceDate !== undefined)
    validateSourceDate(options.conditionsSourceDate);

  const specialtyRows = parseSpecialties(
    await readFile(options.specialtiesPath),
    options.specialtiesPath,
  );
  const presentationRows = parsePresentations(
    await readFile(options.presentationsPath),
    options.presentationsPath,
  );
  const genericGroupRows = parseGenericGroups(
    await readFile(options.genericsPath),
    options.genericsPath,
  );
  const conditionRows =
    options.conditionsPath === undefined
      ? []
      : parseConditions(
          await readFile(options.conditionsPath),
          options.conditionsPath,
        );
  const specialtyIds = new Set(specialtyRows.map((row) => row.cis));

  const orphanPresentations = presentationRows.filter(
    (presentation) => !specialtyIds.has(presentation.cis),
  ).length;
  const orphanGenericGroups = genericGroupRows.filter(
    (genericGroup) => !specialtyIds.has(genericGroup.cis),
  ).length;
  const orphanDispensingConditions = conditionRows.filter(
    (condition) => !specialtyIds.has(condition.cis),
  ).length;
  const controlledDispensingSpecialties = new Set(
    conditionRows
      .filter((condition) =>
        mentionsControlledDispensing(condition.conditionText),
      )
      .map((condition) => condition.cis),
  ).size;

  const outputPath = resolve(options.outputPath);
  const temporaryPath = `${outputPath}.tmp`;
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  const database = new Database(temporaryPath);
  try {
    createSchema(database);
    database.transaction(() => {
      insertMetadata(
        database,
        options,
        orphanPresentations,
        orphanGenericGroups,
        orphanDispensingConditions,
      );
      insertSpecialties(database, specialtyRows);
      insertPresentations(database, presentationRows);
      insertGenericGroups(database, genericGroupRows);
      insertDispensingConditions(database, conditionRows);
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
    genericGroups: genericGroupRows.length,
    orphanGenericGroups,
    dispensingConditions: conditionRows.length,
    orphanDispensingConditions,
    controlledDispensingSpecialties,
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

function parseGenericGroups(
  contents: Buffer,
  sourcePath: string,
): GenericGroupRow[] {
  const text = new TextDecoder('windows-1252').decode(contents);
  return parseLines(text, sourcePath, GENERIC_GROUP_COLUMN_COUNT, (columns) => {
    const cis = requiredIdentifier(columns[2], 'CIS', /^\d{8}$/);
    return {
      groupId: requiredText(columns[0], 'identifiant de groupe générique', cis),
      groupLabel: requiredText(columns[1], 'libellé de groupe générique', cis),
      cis,
      type: optionalText(columns[3]),
      sortNumber: optionalText(columns[4]),
    };
  });
}

/**
 * Format observé sur le fichier officiel actuel : 2 colonnes tabulées (CIS,
 * condition de prescription/délivrance), encodage windows-1252, fins de
 * ligne CRLF. Un même CIS apparaît légitimement sur plusieurs lignes (une
 * spécialité peut cumuler plusieurs conditions, ex. « stupéfiants » et
 * « liste I ») : contrairement à `parseLines`, un CIS répété n'est jamais
 * rejeté ici, seule une ligne strictement identique l'est. Quelques lignes
 * vides parasites (un retour chariot isolé) existent dans le fichier source
 * réel : elles sont ignorées comme des lignes vides plutôt que rejetées.
 */
function parseConditions(contents: Buffer, sourcePath: string): ConditionRow[] {
  const text = new TextDecoder('windows-1252').decode(contents);
  const rows: ConditionRow[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const columns = line.split('\t');
    if (columns.length !== CONDITION_COLUMN_COUNT) {
      throw new Error(
        `${sourcePath}, ligne ${index + 1}: ${CONDITION_COLUMN_COUNT} colonnes attendues, ${columns.length} reçues.`,
      );
    }
    const cis = requiredIdentifier(columns[0], 'CIS', /^\d{8}$/);
    const conditionText = requiredText(
      columns[1],
      'condition de prescription/délivrance',
      cis,
    );
    const identifier = `${cis} ${conditionText}`;
    if (seen.has(identifier)) {
      throw new Error(
        `${sourcePath}, ligne ${index + 1}: ligne dupliquée pour ${cis}.`,
      );
    }
    seen.add(identifier);
    rows.push({ cis, conditionText });
  }

  if (rows.length === 0)
    throw new Error(`${sourcePath} ne contient aucune donnée.`);
  return rows;
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
  if (isGenericGroupRow(row)) return `${row.groupId}:${row.cis}`;
  return (row as SpecialtyRow).cis;
}

function isPresentationRow(row: unknown): row is PresentationRow {
  return typeof row === 'object' && row !== null && 'cip13' in row;
}

function isGenericGroupRow(row: unknown): row is GenericGroupRow {
  return typeof row === 'object' && row !== null && 'groupId' in row;
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
    CREATE TABLE generic_groups (
      group_id TEXT NOT NULL,
      cis TEXT NOT NULL CHECK(length(cis) = 8),
      group_label TEXT NOT NULL,
      type TEXT,
      sort_number TEXT,
      PRIMARY KEY (group_id, cis)
    ) WITHOUT ROWID;
    CREATE INDEX generic_groups_by_cis ON generic_groups(cis);
    CREATE TABLE dispensing_conditions (
      cis TEXT NOT NULL CHECK(length(cis) = 8),
      condition_text TEXT NOT NULL,
      controlled_dispensing_mention INTEGER NOT NULL CHECK (controlled_dispensing_mention IN (0, 1)),
      PRIMARY KEY (cis, condition_text)
    ) WITHOUT ROWID;
    CREATE INDEX dispensing_conditions_controlled_idx
      ON dispensing_conditions(cis) WHERE controlled_dispensing_mention = 1;
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
  orphanGenericGroups: number,
  orphanDispensingConditions: number,
): void {
  const insert = database.prepare(
    'INSERT INTO metadata (key, value) VALUES (?, ?)',
  );
  insert.run('schema_version', '1');
  insert.run('source', 'Base de données publique des médicaments (BDPM)');
  insert.run('specialties_source_date', options.specialtiesSourceDate);
  insert.run('presentations_source_date', options.presentationsSourceDate);
  insert.run('generics_source_date', options.genericsSourceDate);
  insert.run('orphan_presentations', String(orphanPresentations));
  insert.run('orphan_generic_groups', String(orphanGenericGroups));
  // Absente plutôt que vide quand --conditions n'a pas été fourni : ne pas
  // inventer une date source pour un fichier qui n'a pas été lu.
  if (options.conditionsSourceDate !== undefined)
    insert.run('conditions_source_date', options.conditionsSourceDate);
  insert.run(
    'orphan_dispensing_conditions',
    String(orphanDispensingConditions),
  );
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

function insertGenericGroups(
  database: Database.Database,
  rows: GenericGroupRow[],
): void {
  const insert = database.prepare(`
    INSERT INTO generic_groups (group_id, cis, group_label, type, sort_number)
    VALUES (@groupId, @cis, @groupLabel, @type, @sortNumber)
  `);
  for (const row of rows) insert.run(row);
}

function insertDispensingConditions(
  database: Database.Database,
  rows: ConditionRow[],
): void {
  const insert = database.prepare(`
    INSERT INTO dispensing_conditions (cis, condition_text, controlled_dispensing_mention)
    VALUES (@cis, @conditionText, @mention)
  `);
  for (const row of rows) {
    insert.run({
      cis: row.cis,
      conditionText: row.conditionText,
      mention: mentionsControlledDispensing(row.conditionText) ? 1 : 0,
    });
  }
}

export function parseImportArguments(arguments_: string[]): ImportOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error(
        'Arguments attendus: --specialties, --presentations, --generics, --output, ' +
          '--specialties-source-date, --presentations-source-date, --generics-source-date, ' +
          '--conditions (optionnel), --conditions-source-date (optionnel).',
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
    genericsPath: read('--generics'),
    outputPath: read('--output'),
    specialtiesSourceDate: read('--specialties-source-date'),
    presentationsSourceDate: read('--presentations-source-date'),
    genericsSourceDate: read('--generics-source-date'),
    conditionsPath: values.get('--conditions'),
    conditionsSourceDate: values.get('--conditions-source-date'),
  };
}
