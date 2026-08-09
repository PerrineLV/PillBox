import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  formatReminderTime,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';
import { WEEKDAYS, type Weekday } from '@/domain/treatments/treatment';
import {
  cancelPreparationReminders,
  getLocalNotificationPermission,
  replacePreparationReminder,
  requestLocalNotificationPermission,
} from '@/infrastructure/reminders/local-notifications';
import {
  getPreparationReminderSettings,
  savePreparationReminderSettings,
} from '@/infrastructure/reminders/preparation-reminder-repository';

const DAY_LABELS: Record<Weekday, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

const DEFAULT_SCHEDULE: PreparationReminderSchedule = {
  weekday: 'sunday',
  hour: 18,
  minute: 0,
};

export default function SettingsScreen() {
  const database = useSQLiteContext();
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getPreparationReminderSettings(database),
      getLocalNotificationPermission(),
    ])
      .then(async ([settings, permission]) => {
        if (!active) return;
        const loaded = {
          weekday: settings.weekday,
          hour: settings.hour,
          minute: settings.minute,
        };
        setSchedule(loaded);
        setPermissionDenied(permission === 'denied');
        if (settings.enabled && permission === 'denied') {
          await cancelPreparationReminders();
          await savePreparationReminderSettings(database, loaded, null);
          if (active)
            setMessage(
              'Le rappel a été désactivé car les notifications ne sont plus autorisées.',
            );
        } else {
          setEnabled(settings.enabled);
        }
      })
      .catch((reason: unknown) => {
        if (active) setMessage(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [database]);

  async function setReminderEnabled(nextEnabled: boolean): Promise<void> {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      if (!nextEnabled) {
        await cancelPreparationReminders();
        await savePreparationReminderSettings(database, schedule, null);
        setEnabled(false);
        setDirty(false);
        setMessage('Rappel désactivé.');
        return;
      }
      const permission = await requestLocalNotificationPermission();
      setPermissionDenied(permission === 'denied');
      if (permission === 'denied') {
        await cancelPreparationReminders();
        await savePreparationReminderSettings(database, schedule, null);
        setEnabled(false);
        setMessage(
          'Permission refusée : aucun rappel n’a été programmé. Vous pouvez l’autoriser dans les réglages Android.',
        );
        return;
      }
      await programReminder();
    } catch (reason: unknown) {
      await cancelPreparationReminders();
      await savePreparationReminderSettings(database, schedule, null);
      setEnabled(false);
      setMessage(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(): Promise<void> {
    if (saving || !enabled) return;
    setSaving(true);
    setMessage(null);
    try {
      await savePreparationReminderSettings(database, schedule, null);
      setEnabled(false);
      await programReminder();
    } catch (reason: unknown) {
      await cancelPreparationReminders();
      await savePreparationReminderSettings(database, schedule, null);
      setEnabled(false);
      setMessage(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function programReminder(): Promise<void> {
    const identifier = await replacePreparationReminder(schedule);
    await savePreparationReminderSettings(database, schedule, identifier);
    setEnabled(true);
    setDirty(false);
    setPermissionDenied(false);
    setMessage(
      `Rappel programmé le ${DAY_LABELS[schedule.weekday].toLowerCase()} à ${formatReminderTime(schedule.hour, schedule.minute)}.`,
    );
  }

  function chooseDay(weekday: Weekday): void {
    setSchedule((current) => ({ ...current, weekday }));
    setDirty(true);
  }

  function chooseTime(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setShowTimePicker(false);
    if (event.type !== 'set' || date === undefined) return;
    setSchedule((current) => ({
      ...current,
      hour: date.getHours(),
      minute: date.getMinutes(),
    }));
    setDirty(true);
  }

  if (loading)
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text>Chargement des réglages…</Text>
      </View>
    );

  const pickerDate = new Date();
  pickerDate.setHours(schedule.hour, schedule.minute, 0, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Réglages' }} />
      <Text style={styles.title}>Rappel de préparation</Text>
      <View style={styles.switchRow}>
        <View style={styles.switchLabel}>
          <Text style={styles.label}>Rappel hebdomadaire</Text>
          <Text style={styles.help}>
            Programmé uniquement sur ce téléphone.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Activer le rappel hebdomadaire"
          disabled={saving}
          onValueChange={(value) => void setReminderEnabled(value)}
          value={enabled}
        />
      </View>

      <Text style={styles.label}>Jour</Text>
      <View style={styles.days}>
        {WEEKDAYS.map((weekday) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: schedule.weekday === weekday }}
            key={weekday}
            onPress={() => chooseDay(weekday)}
            style={[
              styles.day,
              schedule.weekday === weekday && styles.daySelected,
            ]}
          >
            <Text
              style={schedule.weekday === weekday && styles.dayTextSelected}
            >
              {DAY_LABELS[weekday]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Heure</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setShowTimePicker(true)}
        style={styles.timeButton}
      >
        <Text style={styles.timeText}>
          {formatReminderTime(schedule.hour, schedule.minute)}
        </Text>
      </Pressable>
      {showTimePicker ? (
        <>
          <DateTimePicker
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            is24Hour
            mode="time"
            onChange={chooseTime}
            value={pickerDate}
          />
          {Platform.OS === 'ios' ? (
            <Pressable onPress={() => setShowTimePicker(false)}>
              <Text style={styles.linkText}>Fermer</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {enabled && dirty ? (
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void saveSchedule()}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            Enregistrer le nouveau rappel
          </Text>
        </Pressable>
      ) : null}
      {saving ? <ActivityIndicator /> : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {permissionDenied ? (
        <Pressable onPress={() => void Linking.openSettings()}>
          <Text style={styles.linkText}>Ouvrir les réglages Android</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? `Le rappel n’a pas pu être programmé : ${reason.message}`
    : 'Le rappel n’a pas pu être programmé.';
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  container: { gap: 16, padding: 24 },
  day: { borderColor: '#AAB8B4', borderRadius: 8, borderWidth: 1, padding: 10 },
  daySelected: { backgroundColor: '#0F6F70', borderColor: '#0F6F70' },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { color: '#52605C', marginTop: 4 },
  label: { fontSize: 17, fontWeight: '600' },
  linkText: { color: '#0F6F70', fontWeight: '600', paddingVertical: 8 },
  message: { backgroundColor: '#EAF4F1', borderRadius: 8, padding: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    padding: 14,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  switchLabel: { flex: 1 },
  switchRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  timeButton: {
    alignSelf: 'flex-start',
    borderColor: '#AAB8B4',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  timeText: { fontSize: 20, fontVariant: ['tabular-nums'] },
  title: { fontSize: 26, fontWeight: '700' },
});
