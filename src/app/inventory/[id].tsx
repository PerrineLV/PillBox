import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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
      <Text>Péremption : {box.expirationDate}</Text>
      <Text>Quantité initiale : {box.initialQuantity}</Text>
      <Text style={styles.remaining}>
        Quantité restante : {box.remainingQuantity}
      </Text>
      {expired ? (
        <Text style={styles.expired}>PÉRIMÉE — stock utilisable : 0</Text>
      ) : null}

      <Text style={styles.section}>Ajuster le stock physique</Text>
      <TextInput
        accessibilityLabel="Nouvelle quantité restante"
        keyboardType="number-pad"
        onChangeText={setQuantity}
        style={styles.input}
        value={quantity}
      />
      <TextInput
        accessibilityLabel="Explication de l’ajustement"
        multiline
        onChangeText={setExplanation}
        placeholder="Pourquoi le stock diffère-t-il ?"
        style={styles.input}
        value={explanation}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        title="Enregistrer un ajustement manuel"
        onPress={() => adjust('MANUAL_ADJUSTMENT')}
      />
      <View style={styles.correction}>
        <Button
          title="Enregistrer une correction"
          onPress={() => adjust('CORRECTION')}
        />
      </View>

      <Text style={styles.section}>Mouvements</Text>
      {movements.map((movement) => (
        <View key={movement.id} style={styles.movement}>
          <Text style={styles.movementType}>{movement.type}</Text>
          <Text>
            {movement.quantityDelta >= 0 ? '+' : ''}
            {movement.quantityDelta} → reste {movement.quantityAfter}
          </Text>
          <Text>{movement.explanation}</Text>
          <Text style={styles.date}>{movement.createdAt}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 18 },
  correction: { marginTop: 10 },
  date: { color: '#4b5563', fontSize: 12 },
  error: { color: '#b91c1c', marginBottom: 10 },
  expired: {
    backgroundColor: '#fff1f2',
    color: '#b91c1c',
    fontWeight: '800',
    marginTop: 10,
    padding: 10,
  },
  input: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  movement: {
    borderBottomColor: '#d1d5db',
    borderBottomWidth: 1,
    paddingVertical: 10,
  },
  movementType: { fontWeight: '800' },
  remaining: { fontSize: 17, fontWeight: '800', marginTop: 8 },
  section: { fontSize: 18, fontWeight: '800', marginBottom: 10, marginTop: 24 },
  title: { fontSize: 21, fontWeight: '800', marginBottom: 8 },
});
