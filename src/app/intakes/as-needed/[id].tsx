import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { AsNeededIntakeLog } from '@/components/treatments/as-needed-intake-log';
import type { Treatment } from '@/domain/treatments/treatment';
import { getTreatment } from '@/infrastructure/treatments/treatment-repository';
import { LoadingState, Message, Screen, typography } from '@/ui';

/** Point d'entrée léger pour enregistrer une prise ponctuelle depuis l'accueil. */
export default function AsNeededIntakeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const treatmentId = Number(id);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isSafeInteger(treatmentId)) {
      setError('Identifiant de traitement invalide.');
      return;
    }
    getTreatment(database, treatmentId)
      .then((value) => {
        if (value === null || value.dosageKind !== 'AS_NEEDED') {
          setError('Traitement si besoin introuvable.');
          return;
        }
        setTreatment(value);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Chargement impossible.',
        ),
      );
  }, [database, treatmentId]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Prise si besoin' }} />
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && treatment === null ? (
        <LoadingState label="Chargement du traitement…" />
      ) : null}
      {treatment ? (
        <>
          <Text accessibilityRole="header" style={typography.title}>
            {treatment.specialtyName}
          </Text>
          <AsNeededIntakeLog
            treatmentId={treatment.id}
            canRecord={treatment.archivedAt === null}
          />
        </>
      ) : null}
    </Screen>
  );
}
