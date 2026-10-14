import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import Database from 'better-sqlite3';

describe('snapshot Compl’Alim', () => {
  it('est recherché hors ligne sans reprendre de posologie ni de produit retiré', () => {
    const database = new Database(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'assets',
        'medications',
        'compl-alim.db',
      ),
      { readonly: true },
    );
    try {
      expect(
        database.prepare('SELECT count(*) AS count FROM supplements').get(),
      ).toEqual({ count: 130797 });
      expect(
        database
          .prepare('SELECT id FROM supplements WHERE id = ?')
          .get('168730'),
      ).toBeUndefined();
      expect(
        database
          .prepare('PRAGMA table_info(supplements)')
          .all()
          .map((column) => (column as { name: string }).name),
      ).toEqual([
        'id',
        'name',
        'brand',
        'form',
        'operator',
        'product_range',
        'normalized_name',
        'normalized_brand',
      ]);
      expect(
        database
          .prepare('SELECT id FROM supplements GROUP BY id HAVING count(*) > 1')
          .all(),
      ).toEqual([]);
    } finally {
      database.close();
    }
  });
});

it('dédoublonne seulement une référence identique et refuse les métadonnées contradictoires', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pillbox-complalim-'));
  const source = join(directory, 'source.csv');
  const destination = join(directory, 'reference.db');
  const header =
    'id;nom_commercial;marque;forme_galenique;decision;responsable_mise_sur_marche;gamme\n';
  const row =
    '42;Magnésium;Marque;Gélule;Commercialisation possible;Opérateur;Gamme\n';
  const run = () =>
    spawnSync(
      'python3',
      [join(__dirname, '..', 'import-compl-alim.py'), source, destination],
      { encoding: 'utf8' },
    );
  try {
    writeFileSync(source, header + row + row + row.replace('42;', '43;'));
    expect(run().status).toBe(0);
    const database = new Database(destination, { readonly: true });
    try {
      expect(
        database.prepare('SELECT count(*) AS count FROM supplements').get(),
      ).toEqual({ count: 2 });
      expect(
        database
          .prepare('SELECT count(*) AS count FROM supplement_search')
          .get(),
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }
    writeFileSync(
      source,
      header + row + row.replace(';Opérateur;', ';Autre opérateur;'),
    );
    expect(run().status).not.toBe(0);
    expect(existsSync(destination)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
