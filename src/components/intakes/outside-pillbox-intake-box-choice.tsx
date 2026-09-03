import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import {
  isExpired,
  todayIso,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { takeOutsidePillboxIntake } from '@/infrastructure/intakes/intake-repository';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { listGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  AppModal,
  Banner,
  DenseList,
  DenseRow,
  SeverityBadge,
  colors,
  radii,
  typography,
} from '@/ui';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * La sélection explicite du lot évite d'attribuer silencieusement une prise à
 * une boîte lorsque plusieurs lots sont encore disponibles hors pilulier.
 */
export function OutsidePillboxIntakeBoxChoice({
  database,
  record,
  onCancel,
  onTaken,
}: {
  database: SQLiteDatabase;
  record: IntakeRecord | null;
  onCancel(): void;
  onTaken(): Promise<void>;
}) {
  const [boxes, setBoxes] = useState<MedicationBox[] | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (record === null) return;
    let cancelled = false;
    setBoxes(null);
    setSelectedBoxId(null);
    setError(null);
    Promise.all([
      listMedicationBoxes(database),
      listGenericEquivalenceConfirmations(database, record.treatmentId),
    ])
      .then(([allBoxes, equivalences]) => {
        const acceptedCis = new Set([
          record.specialtyCis,
          ...equivalences.map((equivalence) => equivalence.cis),
        ]);
        const eligible = allBoxes
          .filter((box) => acceptedCis.has(box.specialtyCis))
          .sort(
            (left, right) =>
              left.expirationDate.localeCompare(right.expirationDate) ||
              left.id - right.id,
          );
        if (!cancelled) setBoxes(eligible);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Chargement du stock impossible.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [database, record]);

  async function confirm(): Promise<void> {
    if (record === null || selectedBoxId === null) return;
    setBusy(true);
    setError(null);
    try {
      await takeOutsidePillboxIntake(
        database,
        record.key,
        selectedBoxId,
        todayIso(),
      );
      await onTaken();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Prise impossible.');
    } finally {
      setBusy(false);
    }
  }

  const today = todayIso();
  return (
    <AppModal
      visible={record !== null}
      title="Choisir la boîte utilisée"
      primaryLabel="Marquer comme pris"
      busy={busy}
      onPrimary={() => void confirm()}
      onCancel={onCancel}
    >
      <Text style={typography.detail}>
        Sélectionnez le lot réellement utilisé. Le stock sera décrémenté de{' '}
        {record ? record.quantityHalfUnits / 2 : 0} unité(s).
      </Text>
      {error ? <Banner level="high">{error}</Banner> : null}
      {boxes === null && !error ? (
        <Text style={typography.micro}>Chargement des boîtes…</Text>
      ) : null}
      {boxes?.length === 0 ? (
        <Banner level="warning">
          Aucune boîte correspondante n’est disponible dans le stock.
        </Banner>
      ) : null}
      {boxes && boxes.length > 0 ? (
        <DenseList>
          {boxes.map((box, index) => {
            const insufficient =
              record !== null &&
              box.remainingQuantity < record.quantityHalfUnits / 2;
            const expired = isExpired(box.expirationDate, today);
            const disabled = insufficient || expired;
            const selected = selectedBoxId === box.id;
            return (
              <DenseRow
                accessibilityLabel={`Boîte numéro ${box.id}, lot ${box.lot ?? 'non renseigné'}`}
                detail={
                  <View style={styles.details}>
                    <Text style={styles.detailText}>
                      Péremption {formatLongFrenchCivilDate(box.expirationDate)}{' '}
                      · reste {box.remainingQuantity}
                    </Text>
                    {box.specialtyCis !== record?.specialtyCis ? (
                      <SeverityBadge
                        label="Équivalence générique confirmée"
                        level="warning"
                      />
                    ) : null}
                    {expired ? (
                      <SeverityBadge label="Périmée" level="high" />
                    ) : null}
                    {insufficient ? (
                      <SeverityBadge
                        label="Stock insuffisant"
                        level="warning"
                      />
                    ) : null}
                  </View>
                }
                disabled={disabled || busy}
                first={index === 0}
                key={box.id}
                leading={
                  <View style={[styles.radio, selected && styles.radioOn]} />
                }
                onPress={() => setSelectedBoxId(box.id)}
                title={
                  <Text style={styles.boxTitle}>
                    Boîte #{box.id} · lot {box.lot ?? 'non renseigné'}
                  </Text>
                }
              />
            );
          })}
        </DenseList>
      ) : null}
      {selectedBoxId === null ? (
        <Banner level="warning">
          Choisissez une boîte avant de confirmer.
        </Banner>
      ) : null}
    </AppModal>
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
  radioOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
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
