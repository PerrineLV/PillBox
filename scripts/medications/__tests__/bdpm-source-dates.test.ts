import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareSourceDates,
  extractSourceDatesFromHtml,
  formatFrenchDate,
  parseFrenchDate,
  readSourceDatesState,
  writeSourceDatesState,
  type SourceDates,
} from '../bdpm-source-dates';

function anchor(filename: string, date: string): string {
  return `<a href="/download/file/${filename}" download="${filename}">Fichier (Date de mise à jour : ${date}, 100 Ko)</a>`;
}

function buildHtml(dates: {
  specialties: string;
  presentations: string;
  generics: string;
  conditions: string;
}): string {
  return [
    anchor('CIS_bdpm.txt', dates.specialties),
    anchor('CIS_CIP_bdpm.txt', dates.presentations),
    anchor('CIS_GENER_bdpm.txt', dates.generics),
    anchor('CIS_CPD_bdpm.txt', dates.conditions),
  ].join('\n');
}

describe('parseFrenchDate / formatFrenchDate', () => {
  it('convertit JJ/MM/AAAA en AAAA-MM-JJ et inversement', () => {
    expect(parseFrenchDate('03/08/2026')).toBe('2026-08-03');
    expect(formatFrenchDate('2026-08-03')).toBe('03/08/2026');
  });

  it('rejette un format invalide', () => {
    expect(() => parseFrenchDate('2026-08-03')).toThrow(/invalide/);
    expect(() => parseFrenchDate('32/08/2026')).toThrow(/invalide/);
    expect(() => parseFrenchDate('03/13/2026')).toThrow(/invalide/);
  });
});

describe('extractSourceDatesFromHtml', () => {
  it('extrait les quatre dates depuis la page de téléchargement', () => {
    const html = buildHtml({
      specialties: '03/08/2026',
      presentations: '10/08/2026',
      generics: '03/08/2026',
      conditions: '03/08/2026',
    });
    expect(extractSourceDatesFromHtml(html)).toEqual({
      specialtiesSourceDate: '2026-08-03',
      presentationsSourceDate: '2026-08-10',
      genericsSourceDate: '2026-08-03',
      conditionsSourceDate: '2026-08-03',
    });
  });

  it('échoue explicitement si un lien est introuvable', () => {
    const html = anchor('CIS_bdpm.txt', '03/08/2026');
    expect(() => extractSourceDatesFromHtml(html)).toThrow(/CIS_CIP_bdpm\.txt/);
  });

  it('échoue explicitement si la date est absente du format attendu', () => {
    const html = buildHtml({
      specialties: '03/08/2026',
      presentations: '10/08/2026',
      generics: '03/08/2026',
      conditions: '03/08/2026',
    }).replace(
      'Date de mise à jour : 03/08/2026, 100 Ko)</a>',
      'sans date)</a>',
    );
    expect(() => extractSourceDatesFromHtml(html)).toThrow(
      /date de mise à jour introuvable/,
    );
  });
});

describe('compareSourceDates', () => {
  const base: SourceDates = {
    specialtiesSourceDate: '2026-08-03',
    presentationsSourceDate: '2026-08-10',
    genericsSourceDate: '2026-08-03',
    conditionsSourceDate: '2026-08-03',
  };

  it('ne signale aucun changement quand les quatre dates sont identiques', () => {
    expect(compareSourceDates(base, { ...base })).toEqual({
      changed: false,
      changedFields: [],
    });
  });

  it('signale un seul champ changé', () => {
    const current = { ...base, presentationsSourceDate: '2026-08-11' };
    expect(compareSourceDates(base, current)).toEqual({
      changed: true,
      changedFields: ['presentationsSourceDate'],
    });
  });

  it('signale les quatre champs changés', () => {
    const current: SourceDates = {
      specialtiesSourceDate: '2026-09-01',
      presentationsSourceDate: '2026-09-01',
      genericsSourceDate: '2026-09-01',
      conditionsSourceDate: '2026-09-01',
    };
    expect(compareSourceDates(base, current)).toEqual({
      changed: true,
      changedFields: [
        'specialtiesSourceDate',
        'presentationsSourceDate',
        'genericsSourceDate',
        'conditionsSourceDate',
      ],
    });
  });
});

describe('readSourceDatesState / writeSourceDatesState', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pillbox-source-dates-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('écrit puis relit le même état', async () => {
    const path = join(directory, 'source-dates.json');
    const dates: SourceDates = {
      specialtiesSourceDate: '2026-08-03',
      presentationsSourceDate: '2026-08-10',
      genericsSourceDate: '2026-08-03',
      conditionsSourceDate: '2026-08-03',
    };
    await writeSourceDatesState(path, dates);
    await expect(readSourceDatesState(path)).resolves.toEqual(dates);
    expect(await readFile(path, 'utf-8')).toMatch(/\n$/);
  });

  it('échoue explicitement (récupération impossible) si le fichier est absent', async () => {
    const path = join(directory, 'absent.json');
    await expect(readSourceDatesState(path)).rejects.toThrow();
  });

  it('échoue explicitement si un champ est manquant ou mal formaté', async () => {
    const path = join(directory, 'source-dates.json');
    await writeSourceDatesState(path, {
      specialtiesSourceDate: '2026-08-03',
      presentationsSourceDate: '2026-08-10',
      genericsSourceDate: '2026-08-03',
      conditionsSourceDate: '2026-08-03',
    });
    await writeFile(
      path,
      JSON.stringify({ specialtiesSourceDate: '03/08/2026' }),
      'utf-8',
    );
    await expect(readSourceDatesState(path)).rejects.toThrow(
      /manquant ou invalide/,
    );
  });
});
