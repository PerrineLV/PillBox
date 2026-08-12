import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  isExpired,
  todayIso,
  type MedicationBox,
  type StockMovement,
} from '@/domain/inventory/inventory';
import {
  adjustMedicationBox,
  deleteUnusedMedicationBox,
  getMedicationBox,
  getMedicationBoxRemovalAction,
  listStockMovements,
  type MedicationBoxRemovalAction,
} from '@/infrastructure/inventory/inventory-repository';
import { BoxDeletionConfirmation } from '@/components/inventory/delete-confirmation';
import { GenericGroupSectionWithDatabase } from '@/components/medications/generic-group-section';
import {
  AppButton,
  AppField,
  Card,
  Message,
  STOCK_MOVEMENT_TYPE_LABELS,
  colors,
  spacing,
  typography,
  useToast,
} from '@/ui';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';

export default function BoxDetailScreen() {
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [box, setBox] = useState<MedicationBox | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [quantity, setQuantity] = useState('');
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
    const [nextBox, nextMovements, nextRemovalAction] = await Promise.all([
      getMedicationBox(database, id),
      listStockMovements(database, id),
      getMedicationBoxRemovalAction(database, id),
    ]);
    setBox(nextBox);
    setMovements(nextMovements);
    setRemovalAction(nextRemovalAction);
    if (nextBox) setQuantity(String(nextBox.remainingQuantity));
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

  const adjust = async (type: 'MANUAL_ADJUSTMENT' | 'CORRECTION') => {
    try {
      await adjustMedicationBox(
        database,
        id,
        Number(quantity),
        type,
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
   * En cas de refus, l'écran est rechargé : la raison du refus vient de la base
   * et non de l'état affiché avant la confirmation.
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

  if (!box)
    return (
      <View style={styles.center}>
        <Text>{error ?? 'Chargement…'}</Text>
      </View>
    );
  const expired = isExpired(box.expirationDate, todayIso());
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: `Boîte #${box.id}` }}
      />
      <Text style={styles.title}>{box.specialtyName}</Text>
      <Text>{box.presentationLabel}</Text>
      <Text>Lot : {box.lot ?? 'non renseigné'}</Text>
      <Text>Péremption : {formatLongFrenchCivilDate(box.expirationDate)}</Text>
      <Text>
        Origine :{' '}
        {box.origin === 'SCAN'
          ? 'scan DataMatrix'
          : 'saisie manuelle, sans scan'}
      </Text>
      <Text>Quantité initiale : {box.initialQuantity}</Text>
      <Text style={styles.remaining}>
        Quantité restante : {box.remainingQuantity}
      </Text>
      {expired ? (
        <Message tone="error" title="Boîte périmée">
          Stock utilisable : 0. Cette boîte ne pourra pas être sélectionnée
          pendant une préparation.
        </Message>
      ) : null}
      <GenericGroupSectionWithDatabase cis={box.specialtyCis} />

      <Text style={styles.section}>Ajuster le stock physique</Text>
      <AppField
        label="Nouvelle quantité restante"
        keyboardType="number-pad"
        onChangeText={setQuantity}
        value={quantity}
      />
      <AppField
        label="Explication de l’ajustement"
        multiline
        onChangeText={setExplanation}
        placeholder="Pourquoi le stock diffère-t-il ?"
        value={explanation}
      />
      {error ? <Message tone="error">{error}</Message> : null}
      <AppButton
        label="Enregistrer l’ajustement"
        onPress={() => void adjust('MANUAL_ADJUSTMENT')}
      />
      <View style={styles.correction}>
        <AppButton
          label="Enregistrer comme correction"
          variant="secondary"
          onPress={() => void adjust('CORRECTION')}
        />
      </View>

      <Text style={styles.section}>Retirer cette boîte du stock</Text>
      {deleteError ? <Message tone="error">{deleteError}</Message> : null}
      {removalAction === 'DELETE' ? (
        <AppButton
          label="Supprimer cette boîte"
          variant="danger"
          loading={deleting}
          onPress={() => setDeleteConfirmationVisible(true)}
        />
      ) : null}
      <BoxDeletionConfirmation
        visible={deleteConfirmationVisible}
        box={box}
        onCancel={() => setDeleteConfirmationVisible(false)}
        onConfirm={() => {
          setDeleteConfirmationVisible(false);
          void remove();
        }}
      />
      {removalAction === 'KEEP_USED_IN_PREPARATION' ? (
        <Message tone="warning" title="Suppression impossible">
          Cette boîte a déjà servi à une préparation : la supprimer effacerait
          cet historique. Pour la retirer du stock utilisable, ajustez sa
          quantité restante à 0 ci-dessus.
        </Message>
      ) : null}
      {removalAction === 'KEEP_IN_DRAFT_PREPARATION' ? (
        <Message tone="warning" title="Suppression impossible">
          Cette boîte est désignée dans une préparation en cours. Terminez ou
          annulez cette préparation avant de la supprimer.
        </Message>
      ) : null}

      <Text style={styles.section}>Mouvements</Text>
      {movements.map((movement) => (
        <Card key={movement.id} style={styles.movement}>
          <Text style={styles.movementType}>
            {STOCK_MOVEMENT_TYPE_LABELS[movement.type]}
          </Text>
          <Text>
            {movement.quantityDelta >= 0 ? '+' : ''}
            {movement.quantityDelta} → reste {movement.quantityAfter}
          </Text>
          <Text>{movement.explanation}</Text>
          <Text style={styles.date}>
            {formatFrenchDateTime(movement.createdAt)}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  correction: { marginTop: 10 },
  date: { color: '#4b5563', fontSize: 12 },
  movement: {
    borderBottomColor: '#d1d5db',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  movementType: { fontWeight: '800' },
  remaining: { ...typography.heading, marginTop: 8 },
  section: { ...typography.heading, marginBottom: 10, marginTop: 24 },
  title: typography.title,
});
