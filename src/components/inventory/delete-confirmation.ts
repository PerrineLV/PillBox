import { Alert } from 'react-native';

import type { MedicationBox } from '@/domain/inventory/inventory';

export function confirmPermanentBoxDeletion(
  box: MedicationBox,
  onConfirm: () => void,
): void {
  Alert.alert(
    'Supprimer définitivement cette boîte ?',
    `La boîte #${box.id} de ${box.specialtyName} (lot ${
      box.lot ?? 'non renseigné'
    }) sera retirée du stock avec ses mouvements. Cette action est irréversible.`,
    [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer définitivement',
        style: 'destructive',
        onPress: onConfirm,
      },
    ],
  );
}
