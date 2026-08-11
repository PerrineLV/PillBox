import { Text } from 'react-native';

import { AppModal, typography } from '@/ui';

export function TreatmentDeletionConfirmation({
  visible,
  treatmentName,
  onCancel,
  onConfirm,
}: Readonly<{
  visible: boolean;
  treatmentName: string;
  onCancel(): void;
  onConfirm(): void;
}>) {
  return (
    <AppModal
      visible={visible}
      title="Supprimer définitivement ce traitement ?"
      primaryLabel="Supprimer définitivement"
      destructive
      onCancel={onCancel}
      onPrimary={onConfirm}
    >
      <Text style={typography.body}>
        {`Le traitement « ${treatmentName} » sera supprimé définitivement. Cette action est irréversible.`}
      </Text>
    </AppModal>
  );
}
