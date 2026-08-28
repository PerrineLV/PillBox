import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
import { AppModal, Badge, Message, typography } from '@/ui';
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
      <Text style={typography.body}>
        Sélectionnez le lot réellement utilisé. Le stock sera décrémenté de{' '}
        {record ? record.quantityHalfUnits / 2 : 0} unité(s).
      </Text>
      {error ? <Message tone="error">{error}</Message> : null}
      {boxes === null && !error ? <Text>Chargement des boîtes…</Text> : null}
      {boxes?.length === 0 ? (
        <Message tone="warning">
          Aucune boîte correspondante n’est disponible dans le stock.
        </Message>
      ) : null}
      <View style={{ gap: 8 }}>
        {boxes?.map((box) => {
          const insufficient =
            record !== null &&
            box.remainingQuantity < record.quantityHalfUnits / 2;
          const expired = isExpired(box.expirationDate, today);
          const disabled = insufficient || expired;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled,
                selected: selectedBoxId === box.id,
              }}
              disabled={disabled || busy}
              key={box.id}
              onPress={() => setSelectedBoxId(box.id)}
              style={{ opacity: disabled ? 0.45 : 1 }}
            >
              <Text style={typography.label}>
                {selectedBoxId === box.id ? '✓ ' : ''}Boîte #{box.id} · lot{' '}
                {box.lot ?? 'non renseigné'}
              </Text>
              <Text>
                Péremption {formatLongFrenchCivilDate(box.expirationDate)} ·
                reste {box.remainingQuantity}
              </Text>
              {box.specialtyCis !== record?.specialtyCis ? (
                <Badge label="Équivalence générique confirmée" tone="warning" />
              ) : null}
              {expired ? <Badge label="Périmée" tone="danger" /> : null}
              {insufficient ? (
                <Badge label="Stock insuffisant" tone="warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {selectedBoxId === null ? (
        <Message tone="warning">
          Choisissez une boîte avant de confirmer.
        </Message>
      ) : null}
    </AppModal>
  );
}
