import { Text } from 'react-native';

import { AppModal, typography } from '@/ui';

/**
 * Demande une confirmation explicite avant d'accepter, pour ce traitement,
 * une boîte d'un autre membre du même groupe générique officiel (BDPM) que
 * la spécialité attendue. Purement informatif jusqu'à la confirmation :
 * aucune acceptation automatique n'a lieu tant que cette modale est visible.
 * Partagée entre la désignation d'une boîte pendant une préparation et son
 * ajout au stock (ticket 24).
 */
export function GenericMatchConfirmation({
  visible,
  expectedSpecialtyName,
  scannedSpecialtyName,
  groupLabel,
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  visible: boolean;
  expectedSpecialtyName: string;
  scannedSpecialtyName: string;
  groupLabel: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}>) {
  return (
    <AppModal
      visible={visible}
      title="Correspondance générique détectée"
      primaryLabel="Confirmer cette correspondance"
      busy={busy}
      onCancel={onCancel}
      onPrimary={onConfirm}
    >
      <Text style={typography.detail}>
        {`La boîte désignée est « ${scannedSpecialtyName} », différente de « ${expectedSpecialtyName} » attendu pour ce traitement, mais appartient au même groupe générique officiel de la BDPM : ${groupLabel}.`}
      </Text>
      <Text style={typography.detail}>
        Cette information vient de la BDPM ; ce n’est pas une recommandation
        médicale ni une substitution automatique. En confirmant, vous choisissez
        d’utiliser cette boîte pour ce traitement. PillBox mémorisera cette
        correspondance précise pour ne plus la redemander, sauf si vous
        l’oubliez depuis la fiche du traitement.
      </Text>
    </AppModal>
  );
}
