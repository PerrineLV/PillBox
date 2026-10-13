import { Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type { PreparationSnapshot } from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import type { SavedPreparationProgress } from '@/infrastructure/preparations/preparation-repository';

import { styles } from './styles';
import { PillButton } from '@/ui';

/**
 * Récapitulatif des lots réellement retenus pour chaque médicament, affiché
 * juste avant la validation finale : lorsque plusieurs boîtes couvrent un
 * même médicament, les deux doivent être visibles avant la décrémentation.
 */
export function UsageSummary({
  snapshot,
  progress,
  boxes,
  onRemove,
  saving = false,
}: {
  snapshot: PreparationSnapshot;
  progress: readonly SavedPreparationProgress[];
  boxes: readonly MedicationBox[];
  onRemove?(contribution: SavedPreparationProgress): void;
  saving?: boolean;
}) {
  return (
    <View style={styles.finalCheck}>
      {snapshot.requirements.map((requirement) => {
        const contributions = progress.filter(
          (item) => item.specialtyCis === requirement.specialtyCis,
        );
        return (
          <View key={requirement.specialtyCis} style={styles.day}>
            <Text style={styles.dayTitle}>{requirement.specialtyName}</Text>
            {contributions.map((contribution) => {
              const box = boxes.find((item) => item.id === contribution.boxId);
              return (
                <View key={contribution.boxId}>
                  <Text style={styles.case}>
                    • Boîte #{contribution.boxId} · lot{' '}
                    {box?.lot ?? 'non renseigné'} · péremption{' '}
                    {box ? formatLongFrenchCivilDate(box.expirationDate) : '—'}{' '}
                    · {formatHalfUnits(contribution.quantityHalfUnits)} ·{' '}
                    {contribution.verification === 'SCAN'
                      ? 'vérifiée par scan'
                      : 'choisie sans scan'}
                  </Text>
                  {onRemove ? (
                    <PillButton
                      disabled={saving}
                      tone="outline"
                      label={`Corriger le prélèvement dans la boîte #${contribution.boxId}`}
                      onPress={() => onRemove(contribution)}
                    />
                  ) : null}
                </View>
              );
            })}
            {contributions.length === 0 ? (
              <Text style={styles.case}>Aucune boîte retenue</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
