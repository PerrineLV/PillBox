import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeMedicationSearch } from '../../../src/domain/medications/normalize-medication-search';
import { importBdpm } from '../import-bdpm';

describe('importBdpm', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pillbox-bdpm-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('importe CIS et CIP13 sans déduire de quantité', async () => {
    const paths = await writeFixtures(directory);
    const summary = await importBdpm(importOptions(paths));
    const database = new Database(paths.outputPath, { readonly: true });

    expect(summary).toEqual({
      specialties: 2,
      presentations: 2,
      orphanPresentations: 0,
    });
    expect(
      database
        .prepare('SELECT * FROM presentations WHERE cip13 = ?')
        .get('3400912345678'),
    ).toEqual({
      cip13: '3400912345678',
      cis: '61234567',
      cip7: '1234567',
      label: 'plaquette de 30 comprimés',
      presentation_status: 'Présentation active',
      marketing_status: 'Commercialisée',
      marketing_declaration_date: '01/02/2020',
    });
    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('presentations')")
        .all(),
    ).not.toContainEqual({ name: 'quantity' });
    database.close();
  });

  it('construit un index insensible à la casse et aux accents', async () => {
    const paths = await writeFixtures(directory);
    await importBdpm(importOptions(paths));
    const database = new Database(paths.outputPath, { readonly: true });

    const hits = database
      .prepare(
        "SELECT cis FROM medication_search WHERE medication_search MATCH 'effer* 500*'",
      )
      .all();
    expect(hits).toEqual([{ cis: '61234567' }]);
    database.close();
  });

  it('conserve et compte une présentation liée à un CIS absent', async () => {
    const paths = await writeFixtures(directory);
    const presentation = await readFile(paths.presentationsPath, 'utf8');
    await writeFile(
      paths.presentationsPath,
      presentation.replace('61234567', '69999999'),
    );

    await expect(importBdpm(importOptions(paths))).resolves.toEqual(
      expect.objectContaining({ orphanPresentations: 1 }),
    );
    const database = new Database(paths.outputPath, { readonly: true });
    expect(
      database
        .prepare('SELECT cis FROM presentations WHERE cip13 = ?')
        .get('3400912345678'),
    ).toEqual({ cis: '69999999' });
    expect(
      database
        .prepare(
          "SELECT value FROM metadata WHERE key = 'orphan_presentations'",
        )
        .get(),
    ).toEqual({ value: '1' });
    database.close();
  });
});

describe('normalizeMedicationSearch', () => {
  it('retire accents, casse et ponctuation sans modifier la source stockée', () => {
    expect(normalizeMedicationSearch('ÉFFERALGAN 500 mg, comprimé')).toBe(
      'efferalgan 500 mg comprime',
    );
  });
});

async function writeFixtures(directory: string) {
  const specialtiesPath = join(directory, 'CIS_bdpm.txt');
  const presentationsPath = join(directory, 'CIS_CIP_bdpm.txt');
  const outputPath = join(directory, 'medications.db');
  const specialtyRows = [
    specialtyRow('61234567', 'ÉFFERALGAN 500 mg, comprimé', 'comprimé'),
    specialtyRow(
      '67654321',
      'TEST 10 mg, solution buvable',
      'solution buvable',
    ),
  ].join('\r\n');
  await writeFile(specialtiesPath, Buffer.from(specialtyRows, 'latin1'));
  await writeFile(
    presentationsPath,
    [
      presentationRow(
        '61234567',
        '1234567',
        '3400912345678',
        'plaquette de 30 comprimés',
      ),
      presentationRow(
        '67654321',
        '7654321',
        '3400987654321',
        'flacon de 100 ml',
      ),
    ].join('\r\n'),
  );
  return { specialtiesPath, presentationsPath, outputPath };
}

function specialtyRow(cis: string, name: string, form: string): string {
  return [
    cis,
    name,
    form,
    'orale',
    'Autorisation active',
    'Procédure nationale',
    'Commercialisée',
    '01/01/2020',
    '',
    '',
    'LABORATOIRE',
    'Non',
  ].join('\t');
}

function presentationRow(
  cis: string,
  cip7: string,
  cip13: string,
  label: string,
): string {
  return [
    cis,
    cip7,
    label,
    'Présentation active',
    'Commercialisée',
    '01/02/2020',
    cip13,
    'oui',
    '65%',
    '1,00',
    '2,00',
    '1,00',
    '',
  ].join('\t');
}

function importOptions(paths: {
  specialtiesPath: string;
  presentationsPath: string;
  outputPath: string;
}) {
  return {
    ...paths,
    specialtiesSourceDate: '2026-08-03',
    presentationsSourceDate: '2026-08-08',
  };
}
