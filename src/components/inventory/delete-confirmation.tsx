import { Text } from 'react-native';

import type { MedicationBox } from '@/domain/inventory/inventory';
import { AppModal, typography } from '@/ui';

export function BoxDeletionConfirmation({
  visible,
  box,
  onCancel,
  onConfirm,
}: Readonly<{
  visible: boolean;
  box: MedicationBox;
  onCancel(): void;
  onConfirm(): void;
}>) {
  return (
    <AppModal
      visible={visible}
      title="Supprimer définitivement cette boîte ?"
      primaryLabel="Supprimer définitivement"
      destructive
      onCancel={onCancel}
      onPrimary={onConfirm}
    >
      <Text style={typography.body}>
        {`La boîte #${box.id} de ${box.specialtyName} (lot ${
          box.lot ?? 'non renseigné'
        }) sera retirée du stock avec ses mouvements. Cette action est irréversible.`}
      </Text>
    </AppModal>
  );
}
