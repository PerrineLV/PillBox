import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  INTAKE_REMINDER_HORIZON_DAYS,
  planIntakeReminders,
  usedSlots,
  type SlotTime,
  type TreatmentReminderSettings,
} from '@/domain/reminders/intake-reminder';
import type { IntakeSlot, Treatment } from '@/domain/treatments/treatment';
import {
  getTreatmentReminderSettings,
  saveTreatmentReminderSettings,
} from '@/infrastructure/reminders/intake-reminder-repository';
import { synchronizeTreatmentIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { requestLocalNotificationPermission } from '@/infrastructure/reminders/local-notifications';
import { getTreatment } from '@/infrastructure/treatments/treatment-repository';
import {
  AppButton,
  Card,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  spacing,
  typography,
} from '@/ui';

const LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};

export default function TreatmentRemindersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const treatmentId = Number(id);
  const database = useSQLiteContext();
  const router = useRouter();
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [settings, setSettings] = useState<TreatmentReminderSettings | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getTreatment(database, treatmentId),
      getTreatmentReminderSettings(database, treatmentId),
    ])
      .then(([loadedTreatment, loadedSettings]) => {
        if (!loadedTreatment) throw new Error('Traitement introuvable.');
        setTreatment(loadedTreatment);
        setSettings(loadedSettings);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : 'Chargement impossible.',
        ),
      );
  }, [database, treatmentId]);

  const parsed = settings;
  const preview = useMemo(() => {
    if (!treatment || !parsed || !parsed.enabled) return [];
    const now = new Date();
    const until = new Date(now);
    until.setDate(until.getDate() + 7);
    return planIntakeReminders([treatment], [parsed], now, until).slice(0, 5);
  }, [parsed, treatment]);

  async function save(): Promise<void> {
    if (!parsed) {
      setError('Choisissez une heure pour chaque créneau utilisé.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (parsed.enabled) {
        const permission = await requestLocalNotificationPermission();
        if (permission !== 'granted') {
          setError(
            permission === 'blocked'
              ? 'Les notifications sont définitivement refusées. Autorisez-les dans les réglages Android.'
              : 'Permission refusée : aucun rappel n’a été programmé.',
          );
          return;
        }
      }
      await saveTreatmentReminderSettings(database, parsed);
      await synchronizeTreatmentIntakeReminders(database, treatmentId);
      router.replace({
        pathname: '/treatments',
        params: {
          notice: parsed.enabled
            ? 'Rappels de prise enregistrés.'
            : 'Rappels de prise désactivés.',
        },
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (error && (!treatment || !settings))
    return (
      <Screen>
        <Stack.Screen
          options={{ headerShown: true, title: 'Rappels de prise' }}
        />
        <Message tone="error">{error}</Message>
      </Screen>
    );
  if (!treatment || !settings)
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  const slots = usedSlots(treatment);
  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: 'Rappels de prise' }}
      />
      <Text style={typography.title}>{treatment.specialtyName}</Text>
      {error ? <Message tone="error">{error}</Message> : null}
      {!treatment.active || treatment.archivedAt ? (
        <Message tone="warning">
          Un traitement inactif ou archivé ne génère aucun rappel.
        </Message>
      ) : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={typography.label}>Activer les rappels</Text>
          <Text style={typography.caption}>
            Aide locale : elle ne garantit pas que la prise a été effectuée.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Activer les rappels de prise"
          value={settings.enabled}
          onValueChange={(enabled) => setSettings({ ...settings, enabled })}
        />
      </View>
      <SectionTitle>Heures globales utilisées</SectionTitle>
      <Message>
        Ces horaires sont communs à tous les traitements et se modifient dans
        Réglages.
      </Message>
      {slots.map((slot) => (
        <Card key={slot} style={styles.slotCard}>
          <Text style={typography.label}>{LABELS[slot]}</Text>
          <Text style={typography.body}>
            {formatTime(settings.slotTimes[slot] as SlotTime)}
          </Text>
        </Card>
      ))}
      <SectionTitle>Prochains rappels</SectionTitle>
      {!settings.enabled ? (
        <Message>Activez les rappels pour afficher l’aperçu.</Message>
      ) : preview.length === 0 ? (
        <Message tone="warning">
          Aucune prise prévue dans les 7 prochains jours.
        </Message>
      ) : (
        preview.map((item) => (
          <Card key={item.scheduledAt.toISOString()}>
            <Text style={typography.body}>
              {item.scheduledAt.toLocaleString('fr-FR', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </Text>
          </Card>
        ))
      )}
      <Text style={typography.caption}>
        Les alarmes sont renouvelées à chaque ouverture sur un horizon glissant
        de {INTAKE_REMINDER_HORIZON_DAYS} jours.
      </Text>
      <AppButton
        label="Enregistrer les rappels"
        loading={saving}
        onPress={() => void save()}
      />
    </Screen>
  );
}

function formatTime(value: SlotTime): string {
  return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
}
const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1, gap: spacing.xs },
  slotCard: { flexDirection: 'row', justifyContent: 'space-between' },
});
