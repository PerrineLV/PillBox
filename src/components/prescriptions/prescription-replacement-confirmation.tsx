import { Text } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type { Prescription } from '@/domain/prescriptions/prescription';
import { AppModal, typography } from '@/ui';

/**
 * Demande une confirmation explicite avant de marquer une ordonnance active
 * comme remplacée par celle en cours de création ou d'édition (ticket 48).
 * Jamais automatique : tant que cette modale est visible, aucune ordonnance
 * n'est modifiée. Sans confirmation, les deux ordonnances restent actives —
 * ce n'est jamais bloquant pour l'enregistrement en cours.
 */
export function PrescriptionReplacementConfirmation({
  visible,
  overlapping,
  busy,
  onSkip,
  onConfirm,
}: Readonly<{
  visible: boolean;
  overlapping: Prescription | null;
  busy: boolean;
  onSkip(): void;
  onConfirm(): void;
}>) {
  if (overlapping === null) return null;
  return (
    <AppModal
      visible={visible}
      title="Ordonnance déjà active pour ce traitement"
      primaryLabel="Marquer comme remplacée"
      busy={busy}
      onCancel={onSkip}
      onPrimary={onConfirm}
    >
      <Text style={typography.detail}>
        {`« ${overlapping.label} »${
          overlapping.validUntil !== null
            ? ` (valide jusqu’au ${formatLongFrenchCivilDate(overlapping.validUntil)})`
            : ''
        } couvre déjà au moins un des traitements de cette ordonnance.`}
      </Text>
      <Text style={typography.detail}>
        En confirmant, cette ordonnance précédente sera marquée comme remplacée
        et restera consultable dans l’historique. Sans confirmation, les deux
        ordonnances resteront actives.
      </Text>
    </AppModal>
  );
}
