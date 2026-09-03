import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BoxDeletionConfirmation } from '@/components/inventory/delete-confirmation';
import { GenericGroupSection } from '@/components/medications/generic-group-section';
import { OrphanBoxGenericMatch } from '@/components/medications/orphan-box-generic-match';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  buildAttachedSpecialtyCisSet,
  isOrphanBox,
} from '@/domain/inventory/box-attachment';
import {
  isExpired,
  todayIso,
  type MedicationBox,
  type StockMovement,
} from '@/domain/inventory/inventory';
import type { TreatmentGenericEquivalence } from '@/domain/preparations/preparation';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  adjustMedicationBox,
  deleteUnusedMedicationBox,
  getMedicationBox,
  getMedicationBoxRemovalAction,
  listStockMovements,
  type MedicationBoxRemovalAction,
} from '@/infrastructure/inventory/inventory-repository';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppField,
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  LoadingState,
  Message,
  PillButton,
  ProgressBar,
  Section,
  STOCK_MOVEMENT_TYPE_LABELS,
  StackHeader,
  Stepper,
  Tile,
  TileRow,
  colors,
  severity as severityScale,
  typography,
  useToast,
  type SeverityLevel,
} from '@/ui';

export default function BoxDetailScreen() {
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [box, setBox] = useState<MedicationBox | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [equivalences, setEquivalences] = useState<
    TreatmentGenericEquivalence[]
  >([]);
  /** Pré-rempli avec la quantité restante réelle, jamais la quantité initiale. */
  const [quantity, setQuantity] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removalAction, setRemovalAction] =
    useState<MedicationBoxRemovalAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmationVisible, setDeleteConfirmationVisible] =
    useState(false);

  const load = async () => {
    if (!Number.isInteger(id))
      throw new Error('Identifiant de boîte invalide.');
    const [
      nextBox,
      nextMovements,
      nextRemovalAction,
      nextTreatments,
      nextConfirmations,
    ] = await Promise.all([
      getMedicationBox(database, id),
      listStockMovements(database, id),
      getMedicationBoxRemovalAction(database, id),
      listTreatments(database),
      listAllGenericEquivalenceConfirmations(database),
    ]);
    setBox(nextBox);
    setMovements(nextMovements);
    setRemovalAction(nextRemovalAction);
    setTreatments(nextTreatments);
    setEquivalences(
      nextConfirmations.map((confirmation) => ({
        treatmentId: confirmation.treatmentId,
        cis: confirmation.cis,
      })),
    );
    if (nextBox) setQuantity(nextBox.remainingQuantity);
  };

  useEffect(() => {
    load().catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      ),
    );
    // La base et l’identifiant sont les seules sources de rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database, id]);

  const adjust = async () => {
    try {
      await adjustMedicationBox(
        database,
        id,
        quantity,
        'MANUAL_ADJUSTMENT',
        explanation,
      );
      setExplanation('');
      setError(null);
      await load();
      showToast('Ajustement du stock enregistré.', 'success');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Ajustement impossible.',
      );
    }
  };

  /**
   * En cas de refus, l'écran est rechargé : la raison du refus vient de la
   * base et non de l'état affiché avant la confirmation.
   */
  const remove = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteUnusedMedicationBox(database, id);
      router.replace('/inventory');
    } catch (reason: unknown) {
      setDeleteError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
      setDeleting(false);
      await load().catch(() => undefined);
    }
  };

  const attachedCis = useMemo(
    () => buildAttachedSpecialtyCisSet(treatments, equivalences),
    [treatments, equivalences],
  );

  if (!box) {
    return (
      <AppScreen header={<StackHeader title="Boîte" />}>
        {error ? (
          <Message tone="error">{error}</Message>
        ) : (
          <LoadingState label="Chargement de la boîte…" />
        )}
      </AppScreen>
    );
  }

  const today = todayIso();
  const expired = isExpired(box.expirationDate, today);
  const orphan = isOrphanBox(box, attachedCis);
  const level: SeverityLevel = expired
    ? 'high'
    : box.remainingQuantity === 0
      ? 'warning'
      : 'ok';
  const blockedReason = REMOVAL_BLOCKED_REASONS[removalAction ?? 'DELETE'];

  return (
    <AppScreen
      header={
        <StackHeader subtitle={box.specialtyName} title={`Boîte #${box.id}`} />
      }
    >
      <AppCard>
        <Text style={typography.sectionLabel}>Quantité restante</Text>
        <View style={styles.remainingRow}>
          <Text
            style={[styles.remaining, { color: severityScale[level].text }]}
          >
            {box.remainingQuantity}
          </Text>
          <Text style={styles.initial}>/ {box.initialQuantity}</Text>
        </View>
        <ProgressBar
          color={severityScale[level].text}
          height={6}
          ratio={
            box.initialQuantity > 0
              ? box.remainingQuantity / box.initialQuantity
              : 0
          }
        />
        <TileRow>
          <Tile label="Lot" value={box.lot ?? 'non renseigné'} />
          <Tile
            label="Péremption"
            value={formatLongFrenchCivilDate(box.expirationDate)}
          />
          <Tile
            label="Origine"
            value={box.origin === 'SCAN' ? 'Scan' : 'Manuelle'}
          />
        </TileRow>
        <Text style={typography.micro}>{box.presentationLabel}</Text>
      </AppCard>

      {expired ? (
        <Banner level="high" title="Boîte périmée">
          Stock utilisable : 0. Cette boîte ne pourra pas être sélectionnée
          pendant une préparation.
        </Banner>
      ) : null}
      {orphan ? (
        <Banner level="warning" title="Aucun traitement actif associé">
          Ce médicament ne correspond, ni par CIS exact ni par équivalence
          générique confirmée, à aucun traitement actif : cette boîte ne
          participe à aucun calcul de besoin pour l’instant.
        </Banner>
      ) : null}
      <OrphanBoxGenericMatch
        onConfirmed={() => {
          void load();
          showToast(
            'Équivalence générique confirmée pour ce traitement.',
            'success',
          );
        }}
        personalDatabase={database}
        specialtyCis={box.specialtyCis}
        specialtyName={box.specialtyName}
      />
      <GenericGroupSection cis={box.specialtyCis} />

      <Section label="Ajuster le stock physique">
        <AppCard>
          <View style={styles.adjustRow}>
            <Text style={styles.adjustLabel}>Nouvelle quantité restante</Text>
            <Stepper
              label="nouvelle quantité restante"
              min={0}
              onChange={setQuantity}
              value={quantity}
            />
          </View>
          <AppField
            label="Explication de l’ajustement"
            multiline
            onChangeText={setExplanation}
            placeholder="Pourquoi le stock diffère-t-il ?"
            value={explanation}
          />
          {error ? <Message tone="error">{error}</Message> : null}
          <PillButton
            label="Enregistrer l’ajustement"
            onPress={() => void adjust()}
          />
        </AppCard>
      </Section>

      <Section label="Retirer cette boîte du stock">
        {deleteError ? <Message tone="error">{deleteError}</Message> : null}
        {removalAction === 'DELETE' ? (
          <PillButton
            disabled={deleting}
            height={46}
            label="Supprimer cette boîte"
            onPress={() => setDeleteConfirmationVisible(true)}
            tone="destructive"
          />
        ) : blockedReason ? (
          <Banner level="warning" title="Suppression impossible">
            {blockedReason}
          </Banner>
        ) : null}
      </Section>

      <BoxDeletionConfirmation
        box={box}
        onCancel={() => setDeleteConfirmationVisible(false)}
        onConfirm={() => {
          setDeleteConfirmationVisible(false);
          void remove();
        }}
        visible={deleteConfirmationVisible}
      />

      <Section aside={String(movements.length)} label="Mouvements">
        <DenseList>
          {movements.map((movement, index) => (
            <DenseRow
              detail={`${movement.explanation} · reste ${movement.quantityAfter}`}
              first={index === 0}
              key={movement.id}
              title={
                <View style={styles.movementTitle}>
                  <Text style={styles.movementType}>
                    {STOCK_MOVEMENT_TYPE_LABELS[movement.type]}
                  </Text>
                  <Text style={styles.movementDate}>
                    {formatFrenchDateTime(movement.createdAt)}
                  </Text>
                </View>
              }
              trailing={
                <Text
                  style={[
                    styles.delta,
                    movement.quantityDelta >= 0
                      ? styles.deltaPositive
                      : styles.deltaNegative,
                  ]}
                >
                  {movement.quantityDelta >= 0 ? '+' : '−'}
                  {Math.abs(movement.quantityDelta)}
                </Text>
              }
            />
          ))}
        </DenseList>
      </Section>
    </AppScreen>
  );
}

const REMOVAL_BLOCKED_REASONS: Record<
  MedicationBoxRemovalAction,
  string | null
> = {
  DELETE: null,
  KEEP_USED_IN_PREPARATION:
    'Cette boîte a déjà servi à une préparation : la supprimer effacerait cet historique. Pour la retirer du stock utilisable, ajustez sa quantité restante à 0 ci-dessus.',
  KEEP_USED_FOR_OUTSIDE_PILLBOX_INTAKE:
    'Cette boîte a déjà servi à une prise hors pilulier : la supprimer effacerait cet historique. Pour la retirer du stock utilisable, ajustez sa quantité restante à 0 ci-dessus.',
  KEEP_IN_DRAFT_PREPARATION:
    'Cette boîte est désignée dans une préparation en cours. Terminez ou annulez cette préparation avant de la supprimer.',
};

const styles = StyleSheet.create({
  remainingRow: { alignItems: 'baseline', flexDirection: 'row', gap: 7 },
  remaining: {
    ...typography.numeric,
    fontSize: 26,
    lineHeight: 29,
  },
  initial: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
  adjustRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  adjustLabel: {
    ...typography.itemTitle,
    flex: 1,
    fontSize: 14.5,
    minWidth: 0,
  },
  movementTitle: { gap: 3 },
  movementType: {
    ...typography.itemTitle,
    fontSize: 13.5,
    lineHeight: 17,
  },
  movementDate: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  delta: {
    ...typography.numeric,
    fontSize: 15,
    lineHeight: 18,
  },
  deltaPositive: { color: colors.success },
  deltaNegative: { color: colors.destructive },
});
