import { Alert } from 'react-native';

export function confirmPermanentTreatmentDeletion(
  treatmentName: string,
  onConfirm: () => void,
): void {
  Alert.alert(
    'Supprimer définitivement ce traitement ?',
    `Le traitement « ${treatmentName} » sera supprimé définitivement. Cette action est irréversible.`,
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
