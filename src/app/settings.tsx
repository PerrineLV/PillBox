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

import type { PillBoxBackup, BackupSummary } from '@/domain/backup/backup';

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
import {
  createBackup,
  getLastSuccessfulBackupAt,
  parseAndValidateBackup,
  recordSuccessfulBackup,
  restoreBackup,
} from '@/infrastructure/backup/backup-repository';
import { validateBackupCanRestore } from '@/infrastructure/backup/backup-validator';
import {
  chooseBackupFile,
  sha256,
  shareBackup,
  writeSafetyBackup,
} from '@/infrastructure/backup/backup-files';
import {
  AppButton,
  AppModal,
  Card,
  Divider,
  Message,
  SectionTitle,
  colors,
  radii,
  sizes,
  spacing,
  typography,
} from '@/ui';

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
  const [backupBusy, setBackupBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    backup: PillBoxBackup;
    summary: BackupSummary;
  } | null>(null);
  const [restoreConfirmationVisible, setRestoreConfirmationVisible] =
    useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getPreparationReminderSettings(database),
      getLocalNotificationPermission(),
      getLastSuccessfulBackupAt(database),
    ])
      .then(async ([settings, permission, backupAt]) => {
        if (!active) return;
        const loaded = {
          weekday: settings.weekday,
          hour: settings.hour,
          minute: settings.minute,
        };
        setSchedule(loaded);
        setPermissionDenied(permission === 'denied');
        setLastBackupAt(backupAt);
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

  async function exportData(): Promise<void> {
    if (backupBusy) return;
    setBackupBusy(true);
    setMessage(null);
    try {
      const createdAt = new Date().toISOString();
      const backup = await createBackup(database, createdAt, sha256);
      await shareBackup(backup);
      await recordSuccessfulBackup(database, createdAt);
      setLastBackupAt(createdAt);
      setMessage(
        'Sauvegarde exportée avec succès. Conservez ce fichier dans un emplacement sûr.',
      );
    } catch (reason: unknown) {
      setMessage(
        backupErrorMessage('La sauvegarde n’a pas pu être exportée', reason),
      );
    } finally {
      setBackupBusy(false);
    }
  }

  async function selectBackup(): Promise<void> {
    if (backupBusy) return;
    setBackupBusy(true);
    setMessage(null);
    setPendingRestore(null);
    try {
      const serialized = await chooseBackupFile();
      if (serialized === null) return;
      const candidate = await parseAndValidateBackup(serialized, sha256);
      await validateBackupCanRestore(candidate.backup);
      setPendingRestore(candidate);
    } catch (reason: unknown) {
      setMessage(backupErrorMessage('La sauvegarde a été refusée', reason));
    } finally {
      setBackupBusy(false);
    }
  }

  function confirmRestore(): void {
    if (pendingRestore === null || backupBusy) return;
    setRestoreConfirmationVisible(true);
  }

  async function performRestore(): Promise<void> {
    if (pendingRestore === null || backupBusy) return;
    setBackupBusy(true);
    setMessage(null);
    try {
      const safety = await createBackup(
        database,
        new Date().toISOString(),
        sha256,
      );
      await restoreBackup(database, pendingRestore.backup, async () => {
        writeSafetyBackup(safety);
      });
      setLastBackupAt(await getLastSuccessfulBackupAt(database));
      setPendingRestore(null);
      setRestoreConfirmationVisible(false);
      try {
        const restoredSettings = await getPreparationReminderSettings(database);
        const restoredSchedule = {
          weekday: restoredSettings.weekday,
          hour: restoredSettings.hour,
          minute: restoredSettings.minute,
        };
        setSchedule(restoredSchedule);
        setDirty(false);
        await cancelPreparationReminders();
        if (restoredSettings.enabled) {
          const identifier = await replacePreparationReminder(restoredSchedule);
          await savePreparationReminderSettings(
            database,
            restoredSchedule,
            identifier,
          );
          setEnabled(true);
        } else {
          setEnabled(false);
        }
        setMessage(
          'Sauvegarde restaurée intégralement. Une copie de sécurité de l’ancien état est conservée sur ce téléphone.',
        );
      } catch (reason: unknown) {
        try {
          await cancelPreparationReminders();
          const restoredSettings =
            await getPreparationReminderSettings(database);
          await savePreparationReminderSettings(
            database,
            restoredSettings,
            null,
          );
        } catch {
          // Les données restaurées restent valides ; le prochain chargement
          // réconciliera à nouveau le rappel natif avec le réglage local.
        }
        setEnabled(false);
        setMessage(
          backupErrorMessage(
            'Les données ont bien été restaurées, mais le rappel local doit être reconfiguré',
            reason,
          ),
        );
      }
    } catch (reason: unknown) {
      setMessage(
        backupErrorMessage(
          'La restauration a échoué ; les données précédentes ont été conservées',
          reason,
        ),
      );
    } finally {
      setBackupBusy(false);
    }
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
      <SectionTitle>Rappel de préparation</SectionTitle>
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
        <AppButton
          label="Enregistrer le nouveau rappel"
          loading={saving}
          onPress={() => void saveSchedule()}
        />
      ) : null}
      {saving ? <ActivityIndicator /> : null}
      {message ? <Message>{message}</Message> : null}
      {permissionDenied ? (
        <Pressable onPress={() => void Linking.openSettings()}>
          <Text style={styles.linkText}>Ouvrir les réglages Android</Text>
        </Pressable>
      ) : null}

      <Divider />
      <SectionTitle>Sauvegarde des données</SectionTitle>
      <Text style={styles.help}>
        Le fichier contient vos traitements et d’autres données personnelles
        sensibles. Il n’est pas chiffré : conservez-le dans un emplacement sûr
        et ne le partagez qu’avec une personne de confiance.
      </Text>
      <Text style={styles.help}>
        Dernière sauvegarde réussie :{' '}
        {lastBackupAt === null ? 'aucune' : formatBackupDate(lastBackupAt)}
      </Text>
      <AppButton
        label="Exporter mes données"
        loading={backupBusy}
        onPress={() => void exportData()}
      />
      <AppButton
        label="Choisir une sauvegarde à restaurer"
        variant="secondary"
        disabled={backupBusy}
        onPress={() => void selectBackup()}
      />
      {backupBusy ? <ActivityIndicator /> : null}
      {pendingRestore ? (
        <Card style={styles.restoreSummary}>
          <Text style={styles.label}>Sauvegarde vérifiée</Text>
          <Text>
            Créée le {formatBackupDate(pendingRestore.summary.createdAt)}
          </Text>
          <Text>
            Schéma PillBox : version {pendingRestore.summary.schemaVersion}
          </Text>
          <Text>
            {pendingRestore.summary.treatments} traitement(s),{' '}
            {pendingRestore.summary.boxes} boîte(s)
          </Text>
          <Text>
            {pendingRestore.summary.stockMovements} mouvement(s) de stock,{' '}
            {pendingRestore.summary.preparations} préparation(s)
          </Text>
          <AppButton
            label="Restaurer cette sauvegarde"
            variant="danger"
            disabled={backupBusy}
            onPress={confirmRestore}
          />
        </Card>
      ) : null}
      <AppModal
        visible={restoreConfirmationVisible}
        title="Remplacer les données actuelles ?"
        primaryLabel="Restaurer et remplacer"
        destructive
        busy={backupBusy}
        onCancel={() => setRestoreConfirmationVisible(false)}
        onPrimary={() => void performRestore()}
      >
        <Text style={styles.help}>
          Une sauvegarde de sécurité sera créée automatiquement sur ce
          téléphone. Toutes les données actuelles seront ensuite remplacées par
          le contenu vérifié du fichier.
        </Text>
      </AppModal>
    </ScrollView>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? `Le rappel n’a pas pu être programmé : ${reason.message}`
    : 'Le rappel n’a pas pu être programmé.';
}

function backupErrorMessage(prefix: string, reason: unknown): string {
  return reason instanceof Error
    ? `${prefix} : ${reason.message}`
    : `${prefix}.`;
}

function formatBackupDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
  },
  container: {
    backgroundColor: colors.background,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#9E2A2B',
    borderRadius: 8,
    marginTop: 8,
    padding: 14,
  },
  divider: { backgroundColor: '#D8E0DE', height: 1, marginVertical: 8 },
  day: {
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: sizes.touch,
    padding: 10,
  },
  daySelected: { backgroundColor: '#0F6F70', borderColor: '#0F6F70' },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '700' },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { ...typography.caption, marginTop: 4 },
  label: typography.label,
  linkText: { color: '#0F6F70', fontWeight: '600', paddingVertical: 8 },
  message: { backgroundColor: '#EAF4F1', borderRadius: 8, padding: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    padding: 14,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '700' },
  restoreSummary: { backgroundColor: colors.surface },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#0F6F70',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  secondaryButtonText: { color: '#0F6F70', fontWeight: '700' },
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
