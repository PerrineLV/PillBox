import { StyleSheet, Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import { todayIso, type MedicationBox } from '@/domain/inventory/inventory';
import { evaluateBoxAvailability } from '@/domain/preparations/preparation';
import {
  AppCard,
  DenseList,
  DenseRow,
  PillButton,
  SeverityBadge,
  colors,
  radii,
  typography,
} from '@/ui';

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
    <AppCard>
      <Text style={typography.cardTitle}>
        Boîtes enregistrées dans le stock
      </Text>
      <Text style={typography.micro}>
        Aucune lecture de DataMatrix ne sera enregistrée : les contrôles de
        médicament, de lot et de péremption restent appliqués. Un autre membre
        du même groupe générique officiel exige une confirmation explicite. La
        liste privilégie les boîtes qui couvrent le besoin puis la péremption la
        plus proche ; la boîte que vous confirmez est celle retenue.
      </Text>
      {boxes.length === 0 ? (
        <Text style={typography.detail}>
          Aucune boîte de ce médicament n’est enregistrée dans le stock.
        </Text>
      ) : (
        <DenseList>
          {boxes.map((box, index) => {
            const availability = evaluateBoxAvailability(
              box,
              requiredHalfUnits,
              today,
            );
            const otherSpecialty = box.specialtyCis !== expectedSpecialtyCis;
            return (
              <DenseRow
                accessibilityLabel={`Boîte numéro ${box.id}, lot ${box.lot ?? 'non renseigné'}`}
                detail={
                  <View style={styles.details}>
                    <Text style={styles.detailText}>
                      Reste {box.remainingQuantity} · péremption{' '}
                      {formatLongFrenchCivilDate(box.expirationDate)} ·{' '}
                      {box.origin === 'MANUAL'
                        ? 'ajoutée sans DataMatrix'
                        : 'ajoutée par scan'}
                    </Text>
                    {availability === 'EXPIRED' ? (
                      <SeverityBadge label="Périmée" level="high" />
                    ) : null}
                    {availability === 'INSUFFICIENT' ? (
                      <SeverityBadge
                        label="Quantité insuffisante seule"
                        level="warning"
                      />
                    ) : null}
                    {otherSpecialty ? (
                      <SeverityBadge
                        label={`Même groupe générique : ${box.specialtyName}`}
                        level="warning"
                      />
                    ) : null}
                  </View>
                }
                first={index === 0}
                key={box.id}
                leading={<View style={styles.radio} />}
                onPress={() => onSelect(box)}
                title={
                  <Text style={styles.boxTitle}>
                    Boîte #{box.id} · lot {box.lot ?? 'non renseigné'}
                  </Text>
                }
              />
            );
          })}
        </DenseList>
      )}
      <PillButton
        height={44}
        label="Annuler"
        onPress={onCancel}
        tone="outline"
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  radio: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 2,
    height: 22,
    width: 22,
  },
  boxTitle: { ...typography.itemTitle, fontSize: 13.5, lineHeight: 17 },
  details: { alignItems: 'flex-start', gap: 5 },
  detailText: {
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '500',
    lineHeight: 15,
  },
});
