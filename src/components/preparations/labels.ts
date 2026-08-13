import type { PreparationWeekChoice } from '@/domain/preparations/preparation';
import type { IntakeSlot } from '@/domain/treatments/treatment';

export const WEEK_LABELS: Record<PreparationWeekChoice, string> = {
  CURRENT: 'Semaine à venir',
  NEXT: 'Semaine suivante',
};

export const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'matin',
  noon: 'midi',
  evening: 'soir',
  bedtime: 'coucher',
};
