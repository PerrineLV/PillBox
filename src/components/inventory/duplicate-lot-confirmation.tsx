import { Text } from 'react-native';

import type { MedicationBox } from '@/domain/inventory/inventory';
import { AppModal, typography } from '@/ui';

/**
 * Demande une confirmation explicite avant d'ajouter une boîte dont le lot
 * correspond exactement à celui d'une boîte déjà en stock, pour aider à
 * repérer une erreur de saisie plutôt qu'un ajout volontaire d'une boîte
 * supplémentaire (ticket 33). Partagée entre l'ajout par scan et l'ajout
 * manuel.
 */
export function DuplicateLotConfirmation({
  visible,
  existingBox,
  onCancel,
  onConfirm,
}: Readonly<{
  visible: boolean;
  existingBox: MedicationBox;
  onCancel(): void;
  onConfirm(): void;
}>) {
  return (
    <AppModal
      visible={visible}
      title="Ce lot est déjà en stock"
      primaryLabel="Ajouter quand même cette boîte"
      onCancel={onCancel}
      onPrimary={onConfirm}
    >
      <Text style={typography.body}>
        {`Une boîte de ${existingBox.specialtyName} avec le lot ${
          existingBox.lot ?? ''
        } est déjà en stock, avec ${existingBox.remainingQuantity} unité(s) restante(s).`}
      </Text>
      <Text style={typography.body}>
        S’il s’agit bien d’une boîte supplémentaire portant le même lot,
        confirmez l’ajout. Si le lot a été mal recopié ou scanné deux fois par
        erreur, revenez à la saisie pour le corriger : rien ne sera enregistré.
      </Text>
    </AppModal>
  );
}
