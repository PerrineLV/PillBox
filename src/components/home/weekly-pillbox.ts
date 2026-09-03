import type { WeeklyPreparationState } from './weekly-pillbox-card';
import type { AttentionItem } from '@/domain/home/attention-items';
import { buildWeeklyGrid, type WeeklyGrid } from '@/domain/home/weekly-grid';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import type { Treatment } from '@/domain/treatments/treatment';
import type { SavedPreparation } from '@/infrastructure/preparations/preparation-repository';

export type PreparationAttentionItem = Extract<
  AttentionItem,
  { type: 'PREPARATION' }
>;

export type WeeklyPillbox = Readonly<{
  grid: WeeklyGrid;
  state: WeeklyPreparationState;
}>;

/**
 * Résumé de la semaine affiché sur l'accueil, ou `null` quand il n'y a rien à
 * préparer — la carte disparaît alors entièrement.
 *
 * La visibilité n'est pas recalculée ici : elle suit l'item d'attention, seul
 * porteur de la règle (proposer de démarrer n'appartient qu'au jour du rappel
 * hebdomadaire ; une préparation déjà commencée reste toujours reprenable).
 * Le dupliquer ferait diverger l'accueil de l'écran de préparation.
 */
export function buildWeeklyPillbox({
  preparation,
  draft,
  treatments,
}: {
  preparation: PreparationAttentionItem | undefined;
  draft: SavedPreparation | null;
  treatments: readonly Treatment[];
}): WeeklyPillbox | null {
  if (preparation === undefined) return null;

  if (preparation.mode === 'RESUME') {
    // La grille d'une préparation en cours vient de son snapshot, jamais des
    // traitements actuels : modifier un traitement ne redessine pas un
    // pilulier déjà commencé.
    if (draft === null) return null;
    return {
      grid: buildWeeklyGrid({
        startDate: draft.snapshot.startDate,
        items: draft.snapshot.items,
        preparedCis: draft.progress.map((entry) => entry.specialtyCis),
      }),
      state: 'IN_PROGRESS',
    };
  }

  const items = generateIntakes(
    treatments,
    preparation.startDate,
    preparation.endDate,
  );
  if (items.length === 0) return null;
  return {
    grid: buildWeeklyGrid({ startDate: preparation.startDate, items }),
    state: 'TO_PREPARE',
  };
}
