import { Text } from 'react-native';

import { formatFrenchWeekdayAndDate } from '@/components/treatments/civil-date';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type {
  MedicationRequirement,
  PreparationSnapshot,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import type { SavedPreparationProgress } from '@/infrastructure/preparations/preparation-repository';
import { Card, Message, typography } from '@/ui';

import { SLOT_LABELS } from './labels';
import { styles } from './styles';

/**
 * Médicament en cours de vérification : le besoin restant tient compte des
 * boîtes déjà retenues dans cette préparation, lorsque la première s'est
 * terminée avant de couvrir toute la semaine.
 */
export type CurrentRequirement = MedicationRequirement & {
  remainingHalfUnits: number;
  contributions: readonly SavedPreparationProgress[];
};

export function MedicationStep({
  snapshot,
  current,
  boxes,
}: {
  snapshot: PreparationSnapshot;
  current: CurrentRequirement;
  boxes: readonly MedicationBox[];
}) {
  const cases = snapshot.items.filter(
    (item) => item.specialtyCis === current.specialtyCis,
  );
  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{current.specialtyName}</Text>
      {cases[0]?.pharmaceuticalForm ? (
        <Text style={typography.body}>{cases[0].pharmaceuticalForm}</Text>
      ) : null}
      <Text style={styles.total}>
        Quantité totale : {formatHalfUnits(current.requiredHalfUnits)}
      </Text>
      {current.contributions.length > 0 ? (
        <Message
          tone="warning"
          title="Boîte précédente épuisée : reste à couvrir"
        >
          {current.contributions.map((contribution) => {
            const box = boxes.find((item) => item.id === contribution.boxId);
            return (
              <Text key={contribution.boxId} style={styles.case}>
                • Lot {box?.lot ?? 'non renseigné'} :{' '}
                {formatHalfUnits(contribution.quantityHalfUnits)} déjà attribués
              </Text>
            );
          })}
          <Text style={styles.case}>
            Reste à couvrir avec une seconde boîte :{' '}
            {formatHalfUnits(current.remainingHalfUnits)}
          </Text>
        </Message>
      ) : null}
      <Text style={styles.casesTitle}>Cases concernées</Text>
      {cases.map((item, index) => (
        <Text key={`${item.date}-${item.slot}-${index}`} style={styles.case}>
          • {formatFrenchWeekdayAndDate(item.date)} · {SLOT_LABELS[item.slot]} :{' '}
          {formatHalfUnits(item.quantityHalfUnits)}
        </Text>
      ))}
    </Card>
  );
}
