import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import {
  renewalAvailabilityLabel,
  renewalRuptureLabel,
} from '@/components/inventory/renewal-labels';
import type { AttentionItem } from '@/domain/home/attention-items';
import type { SeverityLevel } from '@/ui';

/** Les trois familles d'items qui alimentent la section « À surveiller ». */
export type WatchAttentionItem = Extract<
  AttentionItem,
  { type: 'STOCK_RENEWAL' | 'EXPIRATION' | 'PRESCRIPTION_EXPIRY' }
>;

export function isWatchAttentionItem(
  item: AttentionItem,
): item is WatchAttentionItem {
  return (
    item.type === 'STOCK_RENEWAL' ||
    item.type === 'EXPIRATION' ||
    item.type === 'PRESCRIPTION_EXPIRY'
  );
}

export type WatchItemPresentation = Readonly<{
  title: string;
  detail: string;
  severity: SeverityLevel;
}>;

export function watchItemPresentation(
  item: WatchAttentionItem,
): WatchItemPresentation {
  switch (item.type) {
    case 'STOCK_RENEWAL':
      return {
        title: item.item.specialtyName,
        detail:
          renewalRuptureLabel(item.item) ?? renewalAvailabilityLabel(item.item),
        severity:
          item.item.urgency === 'INSUFFICIENT_FOR_NEXT_PREPARATION'
            ? 'high'
            : item.item.urgency === 'RUNS_OUT_SOON'
              ? 'warning'
              : 'neutral',
      };
    case 'EXPIRATION':
      return {
        title: item.specialtyName,
        detail: `Lot ${item.lot ?? 'non renseigné'} · périme le ${formatLongFrenchCivilDate(item.expirationDate)}`,
        severity: 'warning',
      };
    case 'PRESCRIPTION_EXPIRY':
      return {
        title: item.label,
        detail: `Ordonnance valide jusqu’au ${formatLongFrenchCivilDate(item.validUntil)}`,
        severity: 'warning',
      };
  }
}
