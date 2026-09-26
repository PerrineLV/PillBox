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
      ).toEqual(['id', 'name', 'brand', 'form']);
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
