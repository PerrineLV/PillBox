import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { planIntakeReminders } from '@/domain/reminders/intake-reminder';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { listTreatmentReminderSettings } from '@/infrastructure/reminders/intake-reminder-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { Card, LoadingState, Message, Screen, typography } from '@/ui';

export default function PlannedIntakeScreen() {
  const { at } = useLocalSearchParams<{ at?: string }>();
  const database = useSQLiteContext();
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const target = at ? new Date(at) : new Date();
    if (Number.isNaN(target.getTime())) {
      setError('Rappel invalide.');
      return;
    }
    const from = new Date(target.getTime() - 60_000);
    const until = new Date(target.getTime() + 60_000);
    Promise.all([
      listTreatments(database),
      listTreatmentReminderSettings(database),
    ])
      .then(([treatments, settings]) => {
        const reminder = planIntakeReminders(
          treatments,
          settings,
          from,
          until,
        )[0];
        if (!reminder) {
          setLines([]);
          return;
        }
        const byId = new Map(treatments.map((t) => [t.id, t]));
        const slotTimes = new Map(
          settings.flatMap((s) =>
            Object.entries(s.slotTimes).map(([slot, time]) => [
              `${s.treatmentId}:${slot}`,
              time,
            ]),
          ),
        );
        const date = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
        setLines(
          generateIntakes(treatments, date, date, {
            includeTreatmentsOutsidePillbox: true,
          })
            .filter((dose) => {
              if (!reminder.treatmentIds.includes(dose.treatmentId))
                return false;
              const time = slotTimes.get(`${dose.treatmentId}:${dose.slot}`);
              return (
                time?.hour === target.getHours() &&
                time.minute === target.getMinutes()
              );
            })
            .map(
              (dose) =>
                `${byId.get(dose.treatmentId)?.specialtyName ?? dose.specialtyName} · ${formatHalfUnits(dose.quantityHalfUnits)} unité(s)`,
            ),
        );
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Chargement impossible.',
        ),
      );
  }, [at, database]);
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Prise prévue' }} />
      <Text style={typography.title}>Prise prévue</Text>
      <Message>
        Ce rappel est une aide et ne confirme pas que les médicaments ont été
        pris.
      </Message>
      {error ? (
        <Message tone="error">{error}</Message>
      ) : lines === null ? (
        <LoadingState />
      ) : lines.length === 0 ? (
        <Message tone="warning">
          Cette prise n’est plus prévue dans la posologie actuelle.
        </Message>
      ) : (
        lines.map((line) => (
          <Card key={line}>
            <Text style={typography.body}>{line}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
