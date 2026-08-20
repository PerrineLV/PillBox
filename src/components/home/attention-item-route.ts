import type { Href } from 'expo-router';

import type { AttentionItem } from '@/domain/home/attention-items';
import { serializeIntakeGroups } from '@/domain/reminders/notification-navigation';

/** Écran ouvert par chaque carte d'attention : toujours l'action correspondante. */
export function attentionItemHref(item: AttentionItem): Href {
  switch (item.type) {
    case 'NEXT_INTAKE_GROUP':
      return {
        pathname: '/intakes/planned',
        params: { groups: serializeIntakeGroups(item.groups) },
      };
    case 'PREPARATION':
      return item.mode === 'READY'
        ? '/preparations/history'
        : '/preparations/new';
    case 'STOCK_RENEWAL':
      return { pathname: '/inventory', params: { filter: 'renew' } };
    case 'EXPIRATION':
      return {
        pathname: '/inventory/[id]',
        params: { id: String(item.boxId) },
      };
    case 'AS_NEEDED_INFO':
      return {
        pathname: '/intakes/as-needed/[id]',
        params: { id: String(item.treatmentId) },
      };
    case 'PRESCRIPTION_EXPIRY':
      return {
        pathname: '/prescriptions/[id]',
        params: { id: String(item.prescriptionId) },
      };
  }
}

/** Libellé explicite de l'action ouverte par la carte, visible et lu par les lecteurs d'écran. */
export function attentionItemActionLabel(item: AttentionItem): string {
  switch (item.type) {
    case 'NEXT_INTAKE_GROUP':
      return 'Voir le détail de la prise';
    case 'PREPARATION':
      if (item.mode === 'RESUME') return 'Reprendre la préparation';
      if (item.mode === 'READY') return 'Voir l’historique des préparations';
      return 'Commencer la préparation';
    case 'STOCK_RENEWAL':
      return 'Voir le stock';
    case 'EXPIRATION':
      return 'Voir la boîte';
    case 'AS_NEEDED_INFO':
      return 'Enregistrer une prise';
    case 'PRESCRIPTION_EXPIRY':
      return 'Voir l’ordonnance';
  }
}
