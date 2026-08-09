import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { todayIso } from '@/domain/inventory/inventory';
import {
  generatePreparationSnapshot,
  preparationStartDate,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import { createPreparation } from '@/infrastructure/preparations/preparation-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';

export default function NewPreparationScreen() {
  const database = useSQLiteContext();
  const [snapshot, setSnapshot] = useState<PreparationSnapshot | null>(null);
  const [preparationId, setPreparationId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    if (loading || preparationId !== null) return;
    setLoading(true);
    setError(null);
    try {
      const referenceDate = todayIso();
      const startDate = preparationStartDate(referenceDate);
      const [treatments, boxes] = await Promise.all([
        listTreatments(database),
        listMedicationBoxes(database),
      ]);
      const generated = generatePreparationSnapshot(
        treatments,
        boxes,
        startDate,
        referenceDate,
      );
      const id = await createPreparation(database, generated);
      setSnapshot(generated);
      setPreparationId(id);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Génération impossible.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Préparer mon pilulier' }}
      />
      <Text style={styles.intro}>
        La préparation couvre les 7 jours à partir de demain. Le stock n’est pas
        décrémenté à cette étape.
      </Text>
      {preparationId === null ? (
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void generate()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            Générer la préparation de 7 jours
          </Text>
        </Pressable>
      ) : null}
      {loading ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {snapshot ? (
        <>
          <Text style={styles.period}>
            Du {snapshot.startDate} au {snapshot.endDate}
          </Text>
          {snapshot.requirements.length === 0 ? (
            <Text>Aucune prise prévue pour cette période.</Text>
          ) : null}
          {snapshot.hasShortages ? (
            <View style={styles.warning}>
              <Text accessibilityRole="alert" style={styles.warningTitle}>
                Stock insuffisant avant le début de la préparation
              </Text>
              <Text>
                Les insuffisances sont signalées telles quelles. Aucun stock n’a
                été modifié.
              </Text>
            </View>
          ) : null}
          {snapshot.requirements.map((requirement) => (
            <View key={requirement.specialtyCis} style={styles.requirement}>
              <Text style={styles.name}>{requirement.specialtyName}</Text>
              <Text>
                Besoin : {formatHalfUnits(requirement.requiredHalfUnits)} ·
                Stock utilisable :{' '}
                {formatHalfUnits(requirement.usableStockHalfUnits)}
              </Text>
              {requirement.missingHalfUnits > 0 ? (
                <Text style={styles.shortage}>
                  Manque : {formatHalfUnits(requirement.missingHalfUnits)}
                </Text>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    marginVertical: 20,
    padding: 14,
  },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  container: { backgroundColor: '#fff', flexGrow: 1, padding: 16 },
  error: { color: '#b91c1c', marginTop: 16 },
  intro: { color: '#374151', lineHeight: 21 },
  name: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  period: { fontSize: 20, fontWeight: '800', marginBottom: 16 },
  requirement: {
    borderColor: '#d1d5db',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  shortage: { color: '#b91c1c', fontWeight: '800', marginTop: 5 },
  warning: {
    backgroundColor: '#fff7ed',
    borderColor: '#c2410c',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    padding: 12,
  },
  warningTitle: { color: '#9a3412', fontWeight: '800', marginBottom: 4 },
});
