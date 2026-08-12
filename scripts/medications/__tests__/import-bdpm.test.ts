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
      genericGroups: 2,
      orphanGenericGroups: 0,
      dispensingConditions: 0,
      orphanDispensingConditions: 0,
      controlledDispensingSpecialties: 0,
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
    expect(
      database.prepare('SELECT * FROM generic_groups ORDER BY cis').all(),
    ).toEqual([
      {
        group_id: '10',
        cis: '61234567',
        group_label: 'GROUPE TEST GÉNÉRIQUE',
        type: '0',
        sort_number: '1',
      },
      {
        group_id: '10',
        cis: '67654321',
        group_label: 'GROUPE TEST GÉNÉRIQUE',
        type: '1',
        sort_number: '2',
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT value FROM metadata WHERE key = 'generics_source_date'",
        )
        .get(),
    ).toEqual({ value: '2026-08-05' });
    expect(
      database
        .prepare(
          "SELECT value FROM metadata WHERE key = 'conditions_source_date'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      database.prepare('SELECT COUNT(*) AS n FROM dispensing_conditions').get(),
    ).toEqual({ n: 0 });
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

  it('conserve et compte un groupe générique lié à un CIS absent', async () => {
    const paths = await writeFixtures(directory);
    const generics = await readFile(paths.genericsPath, 'latin1');
    await writeFile(
      paths.genericsPath,
      Buffer.from(generics.replace('61234567', '69999999'), 'latin1'),
    );

    await expect(importBdpm(importOptions(paths))).resolves.toEqual(
      expect.objectContaining({ orphanGenericGroups: 1 }),
    );
    const database = new Database(paths.outputPath, { readonly: true });
    expect(
      database
        .prepare(
          "SELECT value FROM metadata WHERE key = 'orphan_generic_groups'",
        )
        .get(),
    ).toEqual({ value: '1' });
    database.close();
  });

  it('accepte un même CIS dans deux groupes génériques distincts', async () => {
    const paths = await writeFixtures(directory);
    const generics = [
      genericGroupRow('10', 'GROUPE A', '61234567', '0', '1'),
      genericGroupRow('11', 'GROUPE B', '61234567', '2', '1'),
    ].join('\r\n');
    await writeFile(paths.genericsPath, Buffer.from(generics, 'latin1'));

    const summary = await importBdpm(importOptions(paths));
    expect(summary.genericGroups).toBe(2);
    const database = new Database(paths.outputPath, { readonly: true });
    expect(
      database
        .prepare(
          'SELECT group_id FROM generic_groups WHERE cis = ? ORDER BY group_id',
        )
        .all('61234567'),
    ).toEqual([{ group_id: '10' }, { group_id: '11' }]);
    database.close();
  });

  it('rejette un doublon de groupe et CIS dans les groupes génériques', async () => {
    const paths = await writeFixtures(directory);
    const generics = [
      genericGroupRow('10', 'GROUPE TEST', '61234567', '0', '1'),
      genericGroupRow('10', 'GROUPE TEST', '61234567', '1', '2'),
    ].join('\r\n');
    await writeFile(paths.genericsPath, Buffer.from(generics, 'latin1'));

    await expect(importBdpm(importOptions(paths))).rejects.toThrow(
      /identifiant dupliqué/,
    );
  });

  it('rejette un fichier de groupes génériques avec un nombre de colonnes invalide', async () => {
    const paths = await writeFixtures(directory);
    await writeFile(
      paths.genericsPath,
      Buffer.from('10\tGROUPE TEST\t61234567\t0', 'latin1'),
    );

    await expect(importBdpm(importOptions(paths))).rejects.toThrow(
      /colonnes attendues/,
    );
  });

  it('--conditions et --conditions-source-date doivent être fournis ensemble', async () => {
    const paths = await writeFixtures(directory);
    await expect(
      importBdpm({ ...importOptions(paths), conditionsPath: '/tmp/x.txt' }),
    ).rejects.toThrow(/ensemble/);
    await expect(
      importBdpm({
        ...importOptions(paths),
        conditionsSourceDate: '2026-08-10',
      }),
    ).rejects.toThrow(/ensemble/);
  });
});

describe('conditions de délivrance encadrée (CIS_CPD_bdpm, ticket 30)', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pillbox-bdpm-cpd-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('détecte une spécialité mentionnée stupéfiants et compte les conditions sans rapport', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(
        [
          conditionRow('61234567', 'liste I'),
          conditionRow('61234567', 'stupéfiants'),
          conditionRow('67654321', 'prescription hospitalière'),
        ].join('\r\n'),
        'latin1',
      ),
    );

    const summary = await importBdpm({
      ...importOptions(paths),
      conditionsPath,
      conditionsSourceDate: '2026-08-10',
    });

    expect(summary).toEqual({
      specialties: 2,
      presentations: 2,
      orphanPresentations: 0,
      genericGroups: 2,
      orphanGenericGroups: 0,
      dispensingConditions: 3,
      orphanDispensingConditions: 0,
      controlledDispensingSpecialties: 1,
    });

    const database = new Database(paths.outputPath, { readonly: true });
    expect(
      database
        .prepare(
          'SELECT condition_text, controlled_dispensing_mention FROM dispensing_conditions WHERE cis = ? ORDER BY condition_text',
        )
        .all('61234567'),
    ).toEqual([
      { condition_text: 'liste I', controlled_dispensing_mention: 0 },
      { condition_text: 'stupéfiants', controlled_dispensing_mention: 1 },
    ]);
    expect(
      database
        .prepare(
          "SELECT value FROM metadata WHERE key = 'conditions_source_date'",
        )
        .get(),
    ).toEqual({ value: '2026-08-10' });
    database.close();
  });

  it('détecte une délivrance fractionnée', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(
        conditionRow('61234567', 'délivrance fractionnée de 7 jours'),
        'latin1',
      ),
    );

    const summary = await importBdpm({
      ...importOptions(paths),
      conditionsPath,
      conditionsSourceDate: '2026-08-10',
    });

    expect(summary.controlledDispensingSpecialties).toBe(1);
  });

  it('conserve et compte une ligne de condition liée à un CIS absent', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(conditionRow('69999999', 'stupéfiants'), 'latin1'),
    );

    const summary = await importBdpm({
      ...importOptions(paths),
      conditionsPath,
      conditionsSourceDate: '2026-08-10',
    });

    expect(summary.orphanDispensingConditions).toBe(1);
    expect(summary.controlledDispensingSpecialties).toBe(1);
  });

  it('accepte un même CIS présent sur plusieurs lignes de conditions distinctes', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(
        [
          conditionRow('61234567', 'liste I'),
          conditionRow('61234567', 'stupéfiants'),
          conditionRow('61234567', 'prescription sur ordonnance sécurisée'),
        ].join('\r\n'),
        'latin1',
      ),
    );

    const summary = await importBdpm({
      ...importOptions(paths),
      conditionsPath,
      conditionsSourceDate: '2026-08-10',
    });

    expect(summary.dispensingConditions).toBe(3);
  });

  it('rejette une ligne de condition strictement dupliquée', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(
        [
          conditionRow('61234567', 'stupéfiants'),
          conditionRow('61234567', 'stupéfiants'),
        ].join('\r\n'),
        'latin1',
      ),
    );

    await expect(
      importBdpm({
        ...importOptions(paths),
        conditionsPath,
        conditionsSourceDate: '2026-08-10',
      }),
    ).rejects.toThrow(/dupliquée/);
  });

  it('ignore les lignes vides parasites du fichier source réel', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from(
        [conditionRow('61234567', 'stupéfiants'), '\r', ''].join('\r\n'),
        'latin1',
      ),
    );

    const summary = await importBdpm({
      ...importOptions(paths),
      conditionsPath,
      conditionsSourceDate: '2026-08-10',
    });

    expect(summary.dispensingConditions).toBe(1);
  });

  it('rejette un fichier de conditions avec un nombre de colonnes invalide', async () => {
    const paths = await writeFixtures(directory);
    const conditionsPath = join(directory, 'CIS_CPD_bdpm.txt');
    await writeFile(
      conditionsPath,
      Buffer.from('61234567\tstupéfiants\ttrop', 'latin1'),
    );

    await expect(
      importBdpm({
        ...importOptions(paths),
        conditionsPath,
        conditionsSourceDate: '2026-08-10',
      }),
    ).rejects.toThrow(/colonnes attendues/);
  });
});

function conditionRow(cis: string, conditionText: string): string {
  return [cis, conditionText].join('\t');
}

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
  const genericsPath = join(directory, 'CIS_GENER_bdpm.txt');
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
  const genericRows = [
    genericGroupRow('10', 'GROUPE TEST GÉNÉRIQUE', '61234567', '0', '1'),
    genericGroupRow('10', 'GROUPE TEST GÉNÉRIQUE', '67654321', '1', '2'),
  ].join('\r\n');
  await writeFile(genericsPath, Buffer.from(genericRows, 'latin1'));
  return { specialtiesPath, presentationsPath, genericsPath, outputPath };
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

function genericGroupRow(
  groupId: string,
  groupLabel: string,
  cis: string,
  type: string,
  sortNumber: string,
): string {
  return [groupId, groupLabel, cis, type, sortNumber].join('\t');
}

function importOptions(paths: {
  specialtiesPath: string;
  presentationsPath: string;
  genericsPath: string;
  outputPath: string;
}) {
  return {
    ...paths,
    specialtiesSourceDate: '2026-08-03',
    presentationsSourceDate: '2026-08-08',
    genericsSourceDate: '2026-08-05',
  };
}
