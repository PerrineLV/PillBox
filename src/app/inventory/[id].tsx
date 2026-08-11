import { Stack, useLocalSearchParams } from 'expo-router';
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
  getMedicationBox,
  listStockMovements,
} from '@/infrastructure/inventory/inventory-repository';
import {
  AppButton,
  AppField,
  Card,
  Message,
  STOCK_MOVEMENT_TYPE_LABELS,
  colors,
  spacing,
  typography,
} from '@/ui';
import {
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';

export default function BoxDetailScreen() {
  const database = useSQLiteContext();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [box, setBox] = useState<MedicationBox | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [quantity, setQuantity] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!Number.isInteger(id))
      throw new Error('Identifiant de boîte invalide.');
    const [nextBox, nextMovements] = await Promise.all([
      getMedicationBox(database, id),
      listStockMovements(database, id),
    ]);
    setBox(nextBox);
    setMovements(nextMovements);
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
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Ajustement impossible.',
      );
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
