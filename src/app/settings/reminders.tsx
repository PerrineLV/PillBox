import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import {
  formatReminderTime,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';
import type { SlotTime } from '@/domain/reminders/intake-reminder';
import {
  INTAKE_SLOTS,
  type IntakeSlot,
  type Weekday,
} from '@/domain/treatments/treatment';
import {
  cancelPreparationReminders,
  getLocalNotificationPermission,
  replacePreparationReminder,
  requestLocalNotificationPermission,
} from '@/infrastructure/reminders/local-notifications';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
  saveGlobalIntakeReminderSettings,
  setIntakeRemindersEnabled,
  type GlobalIntakeReminderSettings,
} from '@/infrastructure/reminders/intake-reminder-repository';
import {
  getPreparationReminderSettings,
  savePreparationReminderSettings,
} from '@/infrastructure/reminders/preparation-reminder-repository';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import {
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  INTAKE_SLOT_LABELS,
  LoadingState,
  PillButton,
  Section,
  SelectField,
  StackHeader,
  Toggle,
  WEEKDAY_LABELS,
  WEEKDAY_OPTIONS,
  colors,
  typography,
  useToast,
} from '@/ui';

const DEFAULT_SCHEDULE: PreparationReminderSchedule = {
  weekday: 'sunday',
  hour: 18,
  minute: 0,
};
const DEFAULT_SLOT_TIMES: GlobalIntakeReminderSettings = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};

export default function RemindersScreen() {
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [slotTimes, setSlotTimes] = useState(DEFAULT_SLOT_TIMES);
  const [slotTimesDirty, setSlotTimesDirty] = useState(false);
  const [activeSlot, setActiveSlot] = useState<IntakeSlot | null>(null);
  const [intakeEnabled, setIntakeEnabled] = useState(false);
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [preparationEnabled, setPreparationEnabled] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getPreparationReminderSettings(database),
      getLocalNotificationPermission(),
      getGlobalIntakeReminderSettings(database),
      isIntakeRemindersEnabled(database),
    ])
      .then(async ([settings, permission, globalTimes, enabled]) => {
        if (!active) return;
        const loaded = {
          weekday: settings.weekday,
          hour: settings.hour,
          minute: settings.minute,
        };
        setSchedule(loaded);
        setSlotTimes(globalTimes);
        setPermissionDenied(permission !== 'granted');
        if (enabled && permission !== 'granted') {
          // Seul moment où la programmation locale est supprimée sans
          // permission : la désactivation est explicite et annoncée.
          await setIntakeRemindersEnabled(database, false);
          await synchronizeIntakeReminders(database);
          setIntakeEnabled(false);
          showToast(
            'Les rappels ont été désactivés car les notifications ne sont plus autorisées.',
            'warning',
          );
        } else {
          setIntakeEnabled(enabled);
        }
        if (settings.enabled && permission !== 'granted') {
          await cancelPreparationReminders();
          await savePreparationReminderSettings(database, loaded, null);
          showToast(
            'Le rappel de préparation a été désactivé car les notifications ne sont plus autorisées.',
            'warning',
          );
        } else {
          setPreparationEnabled(settings.enabled);
        }
      })
      .catch(() => {
        if (active) showToast(REMINDER_ERROR, 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [database, showToast]);

  async function updateIntakeReminders(next: boolean): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      if (next && !(await ensurePermission())) return;
      await setIntakeRemindersEnabled(database, next);
      await synchronizeIntakeReminders(database);
      setIntakeEnabled(next);
      showToast(
        next
          ? 'Rappels de prise activés pour tous les traitements non archivés.'
          : 'Rappels de prise désactivés.',
        'success',
      );
    } catch {
      showToast(REMINDER_ERROR, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function ensurePermission(): Promise<boolean> {
    const permission = await requestLocalNotificationPermission();
    setPermissionDenied(permission !== 'granted');
    if (permission === 'granted') return true;
    showToast(
      permission === 'blocked'
        ? 'Les notifications sont définitivement refusées. Autorisez-les dans les réglages Android.'
        : 'Permission refusée : aucun rappel n’a été programmé.',
      'warning',
    );
    return false;
  }

  function chooseSlotTime(
    slot: IntakeSlot,
    event: DateTimePickerEvent,
    date?: Date,
  ): void {
    if (Platform.OS !== 'ios') setActiveSlot(null);
    if (event.type !== 'set' || date === undefined) return;
    setSlotTimes((current) => ({
      ...current,
      [slot]: { hour: date.getHours(), minute: date.getMinutes() },
    }));
    setSlotTimesDirty(true);
  }

  async function saveSlotTimes(): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      await saveGlobalIntakeReminderSettings(database, slotTimes);
      await synchronizeIntakeReminders(database);
      setSlotTimesDirty(false);
      showToast('Heures des rappels de prise enregistrées.', 'success');
    } catch {
      showToast(REMINDER_ERROR, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function updatePreparationReminder(next: boolean): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      if (!next) {
        await cancelPreparationReminders();
        await savePreparationReminderSettings(database, schedule, null);
        setPreparationEnabled(false);
        setScheduleDirty(false);
        showToast('Rappel de préparation désactivé.', 'success');
        return;
      }
      if (!(await ensurePermission())) {
        await cancelPreparationReminders();
        await savePreparationReminderSettings(database, schedule, null);
        setPreparationEnabled(false);
        return;
      }
      await programPreparationReminder();
    } catch {
      await cancelPreparationReminders();
      await savePreparationReminderSettings(database, schedule, null);
      setPreparationEnabled(false);
      showToast(REMINDER_ERROR, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveSchedule(): Promise<void> {
    if (saving || !preparationEnabled) return;
    setSaving(true);
    try {
      await savePreparationReminderSettings(database, schedule, null);
      await programPreparationReminder();
    } catch {
      await cancelPreparationReminders();
      await savePreparationReminderSettings(database, schedule, null);
      setPreparationEnabled(false);
      showToast(REMINDER_ERROR, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function programPreparationReminder(): Promise<void> {
    const identifier = await replacePreparationReminder(schedule);
    await savePreparationReminderSettings(database, schedule, identifier);
    setPreparationEnabled(true);
    setScheduleDirty(false);
    setPermissionDenied(false);
    showToast(
      `Rappel programmé le ${WEEKDAY_LABELS[schedule.weekday].toLowerCase()} à ${formatReminderTime(schedule.hour, schedule.minute)}.`,
      'success',
    );
  }

  function chooseDay(weekday: Weekday): void {
    setSchedule((current) => ({ ...current, weekday }));
    setScheduleDirty(true);
  }

  function chooseScheduleTime(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setShowTimePicker(false);
    if (event.type !== 'set' || date === undefined) return;
    setSchedule((current) => ({
      ...current,
      hour: date.getHours(),
      minute: date.getMinutes(),
    }));
    setScheduleDirty(true);
  }

  if (loading) {
    return (
      <AppScreen header={<StackHeader title="Rappels" />}>
        <LoadingState label="Chargement des rappels…" />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle="Programmés uniquement sur ce téléphone"
          title="Rappels"
        />
      }
    >
      <Section label="Heures des rappels de prise">
        <DenseList>
          <Toggle
            help="S’applique à tous les traitements non archivés."
            label="Rappels de prise"
            onChange={(next) => void updateIntakeReminders(next)}
            value={intakeEnabled}
          />
          {INTAKE_SLOTS.map((slot) => (
            <View key={slot}>
              <DenseRow
                accessibilityLabel={`${INTAKE_SLOT_LABELS[slot]}, ${formatReminderTime(slotTimes[slot].hour, slotTimes[slot].minute)}. Ouvre le sélecteur d’heure.`}
                chevron
                onPress={() => setActiveSlot(slot)}
                title={
                  <Text style={styles.slotLabel}>
                    {INTAKE_SLOT_LABELS[slot]}
                  </Text>
                }
                trailing={
                  <Text style={styles.slotTime}>
                    {formatReminderTime(
                      slotTimes[slot].hour,
                      slotTimes[slot].minute,
                    )}
                  </Text>
                }
              />
              {activeSlot === slot ? (
                <View style={styles.picker}>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    is24Hour
                    mode="time"
                    onChange={(event, date) =>
                      chooseSlotTime(slot, event, date)
                    }
                    value={pickerDate(slotTimes[slot])}
                  />
                  {Platform.OS === 'ios' ? (
                    <PillButton
                      height={44}
                      label="Valider cette heure"
                      onPress={() => setActiveSlot(null)}
                      tone="outline"
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </DenseList>
        <Text style={typography.micro}>
          Une même heure s’applique à tous les traitements utilisant le créneau.
          Les médicaments prévus ensemble sont regroupés dans une seule
          notification.
        </Text>
        {slotTimesDirty ? (
          <PillButton
            disabled={saving}
            label="Enregistrer les heures de prise"
            onPress={() => void saveSlotTimes()}
          />
        ) : null}
      </Section>

      <Section label="Rappel de préparation">
        <DenseList>
          <Toggle
            help={
              preparationEnabled
                ? `Chaque ${WEEKDAY_LABELS[schedule.weekday].toLowerCase()} à ${formatReminderTime(schedule.hour, schedule.minute)}`
                : 'Aucun rappel de préparation programmé.'
            }
            label="Me rappeler de préparer"
            onChange={(next) => void updatePreparationReminder(next)}
            value={preparationEnabled}
          />
          <DenseRow
            accessibilityLabel={`Heure du rappel, ${formatReminderTime(schedule.hour, schedule.minute)}. Ouvre le sélecteur d’heure.`}
            chevron
            onPress={() => setShowTimePicker(true)}
            title={<Text style={styles.slotLabel}>Heure</Text>}
            trailing={
              <Text style={styles.slotTime}>
                {formatReminderTime(schedule.hour, schedule.minute)}
              </Text>
            }
          />
        </DenseList>
        <SelectField
          accessibilityLabel="Jour de préparation"
          label="Jour"
          onChange={chooseDay}
          options={WEEKDAY_OPTIONS}
          value={schedule.weekday}
        />
        {showTimePicker ? (
          <View style={styles.picker}>
            <DateTimePicker
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              is24Hour
              mode="time"
              onChange={chooseScheduleTime}
              value={pickerDate(schedule)}
            />
            {Platform.OS === 'ios' ? (
              <PillButton
                height={44}
                label="Fermer"
                onPress={() => setShowTimePicker(false)}
                tone="outline"
              />
            ) : null}
          </View>
        ) : null}
        {preparationEnabled && scheduleDirty ? (
          <PillButton
            disabled={saving}
            label="Enregistrer le nouveau rappel"
            onPress={() => void saveSchedule()}
          />
        ) : null}
        <Text style={typography.micro}>
          La programmation est locale : aucun serveur n’est contacté et les
          rappels disparaissent si l’application est désinstallée.
        </Text>
      </Section>

      {permissionDenied ? (
        <Banner level="warning" title="Notifications non autorisées">
          Aucun rappel ne peut être affiché tant qu’Android ne les autorise pas.
        </Banner>
      ) : null}
      {permissionDenied ? (
        <PillButton
          label="Ouvrir les réglages Android"
          onPress={() => void Linking.openSettings()}
          tone="outline"
        />
      ) : null}
    </AppScreen>
  );
}

const REMINDER_ERROR =
  'Le rappel n’a pas pu être programmé. Vérifiez les autorisations Android puis réessayez.';

function pickerDate(time: SlotTime): Date {
  const value = new Date();
  value.setHours(time.hour, time.minute, 0, 0);
  return value;
}

const styles = StyleSheet.create({
  slotLabel: {
    ...typography.itemTitle,
    fontSize: 14.5,
    lineHeight: 19,
  },
  slotTime: {
    ...typography.numeric,
    color: colors.brand,
    fontSize: 15,
    lineHeight: 18,
  },
  picker: { gap: 9, paddingHorizontal: 14, paddingVertical: 9 },
});
