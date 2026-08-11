import type { StockMovementType } from '@/domain/inventory/inventory';
import {
  WEEKDAYS,
  type IntakeSlot,
  type Weekday,
} from '@/domain/treatments/treatment';

/** Libellés affichés pour les jours et les temps de prise, partagés par tous les écrans. */
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

export const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] =
  WEEKDAYS.map((weekday) => ({
    value: weekday,
    label: WEEKDAY_LABELS[weekday],
  }));

export const INTAKE_SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};

/** Libellés affichés pour l’origine d’un mouvement de stock. */
export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  BOX_ADDED: 'Ajout de la boîte',
  MANUAL_ADJUSTMENT: 'Ajustement manuel',
  CORRECTION: 'Correction',
  PILLBOX_PREPARATION: 'Préparation du pilulier',
};
