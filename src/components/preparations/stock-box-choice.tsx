import { Pressable, Text } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { todayIso, type MedicationBox } from '@/domain/inventory/inventory';
import { evaluateBoxAvailability } from '@/domain/preparations/preparation';
import { AppButton, Badge, Card, typography } from '@/ui';

import { styles } from './styles';

/**
 * Boîtes déjà enregistrées pour ce médicament, du lot à utiliser en priorité
 * vers les boîtes inutilisables. Rien n'est masqué silencieusement : une
 * quantité insuffisante est signalée avant même la sélection, pour permettre
 * de choisir directement une seconde boîte lorsque la première est presque
 * terminée plutôt que de découvrir le problème après validation.
 */
export function StockBoxChoice({
  boxes,
  expectedSpecialtyCis,
  requiredHalfUnits,
  onCancel,
  onSelect,
}: {
  boxes: readonly MedicationBox[];
  expectedSpecialtyCis: string;
  requiredHalfUnits: number;
  onCancel(): void;
  onSelect(box: MedicationBox): void;
}) {
  const today = todayIso();
  return (
    <Card style={styles.card}>
      <Text style={styles.casesTitle}>Boîtes enregistrées dans le stock</Text>
      <Text style={typography.caption}>
        Aucune lecture de DataMatrix ne sera enregistrée : les contrôles de
        médicament, de lot et de péremption restent appliqués. Un autre membre
        du même groupe générique officiel exige une confirmation explicite.
      </Text>
      {boxes.length === 0 ? (
        <Text style={styles.case}>
          Aucune boîte de ce médicament n’est enregistrée dans le stock.
        </Text>
      ) : null}
      {boxes.map((box) => {
        const availability = evaluateBoxAvailability(
          box,
          requiredHalfUnits,
          today,
        );
        return (
          <Pressable
            accessibilityRole="button"
            key={box.id}
            onPress={() => onSelect(box)}
            style={styles.stockOption}
          >
            <Text style={styles.stockOptionTitle}>
              Boîte #{box.id} · lot {box.lot ?? 'non renseigné'}
            </Text>
            <Text>
              Péremption {formatLongFrenchCivilDate(box.expirationDate)} · reste{' '}
              {box.remainingQuantity}
            </Text>
            {availability === 'EXPIRED' ? (
              <Badge label="Périmée" tone="danger" />
            ) : null}
            {availability === 'INSUFFICIENT' ? (
              <Badge label="Quantité insuffisante seule" tone="warning" />
            ) : null}
            {box.origin === 'MANUAL' ? (
              <Badge label="Ajoutée sans DataMatrix" />
            ) : null}
            {box.specialtyCis !== expectedSpecialtyCis ? (
              <Badge
                label={`Autre spécialité du même groupe générique : ${box.specialtyName}`}
                tone="warning"
              />
            ) : null}
          </Pressable>
        );
      })}
      <AppButton label="Annuler" variant="quiet" onPress={onCancel} />
    </Card>
  );
}
