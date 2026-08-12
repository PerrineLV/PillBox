import { allocateItemCompletion } from '../pending-completion';
import type { PreparationItemSnapshot } from '../preparation';

function item(
  date: string,
  slot: PreparationItemSnapshot['slot'],
  quantityHalfUnits: number,
): PreparationItemSnapshot {
  return {
    treatmentId: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
    date,
    slot,
    quantityHalfUnits,
  };
}

describe('allocateItemCompletion', () => {
  it('couvre toutes les cases quand la couverture est suffisante', () => {
    const items = [
      item('2026-08-10', 'morning', 2),
      item('2026-08-11', 'morning', 2),
    ];
    const result = allocateItemCompletion(items, 4);
    expect(result.every((entry) => entry.status === 'FILLED')).toBe(true);
  });

  it('laisse les jours les plus tardifs en attente, sans fractionner une case', () => {
    const items = [
      item('2026-08-12', 'morning', 2),
      item('2026-08-10', 'morning', 2),
      item('2026-08-11', 'morning', 2),
    ];
    const result = allocateItemCompletion(items, 4);

    expect(result.map((entry) => [entry.date, entry.status])).toEqual([
      ['2026-08-10', 'FILLED'],
      ['2026-08-11', 'FILLED'],
      ['2026-08-12', 'PENDING_COMPLEMENT'],
    ]);
  });

  it('ordonne les créneaux au sein d’un même jour (matin avant coucher)', () => {
    const items = [
      item('2026-08-10', 'bedtime', 2),
      item('2026-08-10', 'morning', 2),
    ];
    const result = allocateItemCompletion(items, 2);

    expect(result.map((entry) => entry.slot)).toEqual(['morning', 'bedtime']);
    expect(result[0].status).toBe('FILLED');
    expect(result[1].status).toBe('PENDING_COMPLEMENT');
  });

  it('laisse tout en attente sans aucune couverture', () => {
    const items = [item('2026-08-10', 'morning', 2)];
    const result = allocateItemCompletion(items, 0);
    expect(result[0].status).toBe('PENDING_COMPLEMENT');
  });

  it('essaie une case suivante plus petite plutôt que de gaspiller le reliquat', () => {
    // 3 demi-unités restantes : insuffisant pour la case de 4, mais assez
    // pour la case de 2 qui suit chronologiquement.
    const items = [
      item('2026-08-10', 'morning', 4),
      item('2026-08-11', 'morning', 2),
    ];
    const result = allocateItemCompletion(items, 3);

    expect(result[0].status).toBe('PENDING_COMPLEMENT');
    expect(result[1].status).toBe('FILLED');
  });
});
