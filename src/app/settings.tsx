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
import type { SlotTime } from '@/domain/reminders/intake-reminder';

import {
  formatReminderTime,
  type PreparationReminderSchedule,
} from '@/domain/reminders/preparation-reminder';
import {
  INTAKE_SLOTS,
  WEEKDAYS,
  type IntakeSlot,
  type Weekday,
} from '@/domain/treatments/treatment';
import {
  cancelPreparationReminders,
  cancelPostponedIntakeReminders,
  getLocalNotificationPermission,
  replacePreparationReminder,
  requestLocalNotificationPermission,
} from '@/infrastructure/reminders/local-notifications';
import {
  getPreparationReminderSettings,
  savePreparationReminderSettings,
} from '@/infrastructure/reminders/preparation-reminder-repository';
import {
  getGlobalIntakeReminderSettings,
  isIntakeRemindersEnabled,
  saveGlobalIntakeReminderSettings,
  setIntakeRemindersEnabled,
  type GlobalIntakeReminderSettings,
} from '@/infrastructure/reminders/intake-reminder-repository';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { reconcileIntakePostponements } from '@/infrastructure/intakes/intake-postponement-service';
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
  isAppLockEnabled,
  setAppLockEnabled,
} from '@/infrastructure/privacy/app-lock-repository';
import {
  authenticateLocally,
  getLocalAuthAvailability,
} from '@/infrastructure/privacy/local-authentication';
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
const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};
const DEFAULT_SLOT_TIMES: GlobalIntakeReminderSettings = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};

export default function SettingsScreen() {
  const database = useSQLiteContext();
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
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
  const [exportConfirmationVisible, setExportConfirmationVisible] =
    useState(false);
  const [appLockEnabled, setAppLockEnabledState] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [slotTimes, setSlotTimes] = useState(DEFAULT_SLOT_TIMES);
  const [activeIntakeSlot, setActiveIntakeSlot] = useState<IntakeSlot | null>(
    null,
  );
  const [slotTimesDirty, setSlotTimesDirty] = useState(false);
  const [intakeRemindersEnabled, setIntakeRemindersEnabledState] =
    useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getPreparationReminderSettings(database),
      getLocalNotificationPermission(),
      getLastSuccessfulBackupAt(database),
      isAppLockEnabled(database),
      getGlobalIntakeReminderSettings(database),
      isIntakeRemindersEnabled(database),
    ])
      .then(
        async ([
          settings,
          permission,
          backupAt,
          lockEnabled,
          globalTimes,
          intakeEnabled,
        ]) => {
          if (!active) return;
          const loaded = {
            weekday: settings.weekday,
            hour: settings.hour,
            minute: settings.minute,
          };
          setSchedule(loaded);
          setPermissionDenied(permission !== 'granted');
          setLastBackupAt(backupAt);
          setAppLockEnabledState(lockEnabled);
          setSlotTimes(globalTimes);
          if (intakeEnabled && permission !== 'granted') {
            await setIntakeRemindersEnabled(database, false);
            setIntakeRemindersEnabledState(false);
            if (active)
              setMessage(
                'Les rappels ont été désactivés car les notifications ne sont plus autorisées.',
              );
          } else {
            setIntakeRemindersEnabledState(intakeEnabled);
          }
          if (settings.enabled && permission !== 'granted') {
            await cancelPreparationReminders();
            await savePreparationReminderSettings(database, loaded, null);
            if (active)
              setMessage(
                'Le rappel a été désactivé car les notifications ne sont plus autorisées.',
              );
          } else {
            setEnabled(settings.enabled);
          }
        },
      )
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
      setPermissionDenied(permission !== 'granted');
      if (permission !== 'granted') {
        await cancelPreparationReminders();
        await savePreparationReminderSettings(database, schedule, null);
        setEnabled(false);
        setMessage(
          permission === 'blocked'
            ? 'Les notifications sont définitivement refusées. Autorisez-les dans les réglages Android.'
            : 'Permission refusée : aucun rappel n’a été programmé. Vous pouvez l’autoriser dans les réglages Android.',
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

  function chooseIntakeSlotTime(
    slot: IntakeSlot,
    event: DateTimePickerEvent,
    date?: Date,
  ): void {
    if (Platform.OS !== 'ios') setActiveIntakeSlot(null);
    if (event.type !== 'set' || date === undefined) return;
    setSlotTimes((current) => ({
      ...current,
      [slot]: { hour: date.getHours(), minute: date.getMinutes() },
    }));
    setSlotTimesDirty(true);
  }

  async function saveIntakeSlotTimes(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveGlobalIntakeReminderSettings(database, slotTimes);
      await synchronizeIntakeReminders(database);
      setSlotTimesDirty(false);
      setMessage('Heures des rappels de prise enregistrées.');
    } catch (reason: unknown) {
      setMessage(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function updateIntakeRemindersEnabled(
    nextEnabled: boolean,
  ): Promise<void> {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      if (nextEnabled) {
        const permission = await requestLocalNotificationPermission();
        setPermissionDenied(permission !== 'granted');
        if (permission !== 'granted') {
          setMessage(
            permission === 'blocked'
              ? 'Les notifications sont définitivement refusées. Autorisez-les dans les réglages Android.'
              : 'Permission refusée : aucun rappel de prise n’a été programmé.',
          );
          return;
        }
      }
      await setIntakeRemindersEnabled(database, nextEnabled);
      await synchronizeIntakeReminders(database);
      setIntakeRemindersEnabledState(nextEnabled);
      setMessage(
        nextEnabled
          ? 'Rappels de prise activés pour tous les traitements non archivés.'
          : 'Rappels de prise désactivés.',
      );
    } catch (reason: unknown) {
      setMessage(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function exportData(): Promise<void> {
    if (backupBusy) return;
    setBackupBusy(true);
    setExportConfirmationVisible(false);
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

  async function updateAppLock(nextEnabled: boolean): Promise<void> {
    if (privacyBusy) return;
    setPrivacyBusy(true);
    setMessage(null);
    try {
      if (nextEnabled) {
        const availability = await getLocalAuthAvailability();
        if (availability !== 'available') {
          setMessage(
            availability === 'not-enrolled'
              ? 'Configurez d’abord une biométrie sécurisée dans Android.'
              : 'L’authentification locale sécurisée n’est pas disponible sur cet appareil.',
          );
          return;
        }
        const result = await authenticateLocally();
        if (!result.success) {
          setMessage(
            'Activation annulée : votre identité n’a pas été vérifiée.',
          );
          return;
        }
      }
      await setAppLockEnabled(database, nextEnabled);
      setAppLockEnabledState(nextEnabled);
      setMessage(
        nextEnabled
          ? 'Verrouillage local activé.'
          : 'Verrouillage local désactivé.',
      );
    } catch {
      setMessage('Le réglage de verrouillage n’a pas pu être enregistré.');
    } finally {
      setPrivacyBusy(false);
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
      await cancelPostponedIntakeReminders();
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
        setSlotTimes(await getGlobalIntakeReminderSettings(database));
        setIntakeRemindersEnabledState(
          await isIntakeRemindersEnabled(database),
        );
        setSlotTimesDirty(false);
        await synchronizeIntakeReminders(database);
        await reconcileIntakePostponements(database);
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
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Réglages' }} />
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text>Chargement des réglages…</Text>
        </View>
      </>
    );

  const pickerDate = new Date();
  pickerDate.setHours(schedule.hour, schedule.minute, 0, 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Réglages' }} />
      <SectionTitle>Confidentialité locale</SectionTitle>
      <View style={styles.switchRow}>
        <View style={styles.switchLabel}>
          <Text style={styles.label}>Verrouiller PillBox</Text>
          <Text style={styles.help}>
            Demande la biométrie sécurisée ou la sécurité de l’appareil via
            Android. Aucun code ni secret n’est stocké par PillBox.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Verrouiller PillBox avec Android"
          disabled={privacyBusy}
          onValueChange={(value) => void updateAppLock(value)}
          value={appLockEnabled}
        />
      </View>
      <Text style={styles.help}>
        Ce verrou protège l’accès courant à l’application ; il ne chiffre pas la
        base SQLite ni les fichiers exportés.
      </Text>

      <Divider />
      <SectionTitle>Heures des rappels de prise</SectionTitle>
      <View style={styles.switchRow}>
        <View style={styles.switchLabel}>
          <Text style={styles.label}>Rappels de prise</Text>
          <Text style={styles.help}>
            S’applique à tous les traitements non archivés.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Activer les rappels de prise"
          disabled={saving}
          onValueChange={(value) => void updateIntakeRemindersEnabled(value)}
          value={intakeRemindersEnabled}
        />
      </View>
      <Text style={styles.help}>
        Une même heure s’applique à tous les traitements utilisant le créneau.
        Les médicaments prévus ensemble sont regroupés dans une seule
        notification.
      </Text>
      <View style={styles.slotGrid}>
        {INTAKE_SLOTS.map((slot) => {
          const time = slotTimes[slot];
          const value = slotTimePickerDate(time);
          return (
            <View key={slot} style={styles.slotTimeField}>
              <Text style={styles.label}>{SLOT_LABELS[slot]}</Text>
              <Pressable
                accessibilityLabel={`${SLOT_LABELS[slot]}, ${formatReminderTime(time.hour, time.minute)}`}
                accessibilityHint="Ouvre le sélecteur d’heure"
                accessibilityRole="button"
                onPress={() => setActiveIntakeSlot(slot)}
                style={styles.timeButton}
              >
                <Text style={styles.timeText}>
                  {formatReminderTime(time.hour, time.minute)}
                </Text>
              </Pressable>
              {activeIntakeSlot === slot ? (
                <>
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    is24Hour
                    mode="time"
                    onChange={(event, date) =>
                      chooseIntakeSlotTime(slot, event, date)
                    }
                    value={value}
                  />
                  {Platform.OS === 'ios' ? (
                    <AppButton
                      label="Valider cette heure"
                      variant="secondary"
                      onPress={() => setActiveIntakeSlot(null)}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          );
        })}
      </View>
      {slotTimesDirty ? (
        <AppButton
          label="Enregistrer les heures de prise"
          loading={saving}
          onPress={() => void saveIntakeSlotTimes()}
        />
      ) : null}

      <Divider />
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
      <Pressable
        accessibilityLabel={`Jour de préparation, ${DAY_LABELS[schedule.weekday]}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: dayPickerOpen }}
        onPress={() => setDayPickerOpen((open) => !open)}
        style={styles.selectButton}
      >
        <Text style={styles.selectText}>{DAY_LABELS[schedule.weekday]}</Text>
        <Text accessibilityElementsHidden style={styles.selectChevron}>
          {dayPickerOpen ? '⌃' : '⌄'}
        </Text>
      </Pressable>
      {dayPickerOpen ? (
        <Card style={styles.dayMenu}>
          {WEEKDAYS.map((weekday) => {
            const selected = schedule.weekday === weekday;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected }}
                key={weekday}
                onPress={() => {
                  chooseDay(weekday);
                  setDayPickerOpen(false);
                }}
                style={[styles.dayOption, selected && styles.dayOptionSelected]}
              >
                <Text
                  style={[
                    styles.dayOptionText,
                    selected && styles.dayOptionTextSelected,
                  ]}
                >
                  {DAY_LABELS[weekday]}
                </Text>
                {selected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

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
        onPress={() => setExportConfirmationVisible(true)}
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
        visible={exportConfirmationVisible}
        title="Exporter des données sensibles ?"
        primaryLabel="Créer et partager la sauvegarde"
        busy={backupBusy}
        onCancel={() => setExportConfirmationVisible(false)}
        onPrimary={() => void exportData()}
      >
        <Text style={styles.help}>
          Cette sauvegarde contient notamment vos traitements, posologies,
          stocks, lots et historique. Le fichier n’est pas chiffré : toute
          personne qui y accède peut le lire. Choisissez un emplacement sûr.
        </Text>
      </AppModal>
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

function errorMessage(_reason: unknown): string {
  return 'Le rappel n’a pas pu être programmé. Vérifiez les autorisations Android puis réessayez.';
}

function backupErrorMessage(prefix: string, _reason: unknown): string {
  return `${prefix}. Le fichier n’a pas été affiché ni enregistré dans les journaux.`;
}

function formatBackupDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function slotTimePickerDate(time: SlotTime): Date {
  const value = new Date();
  value.setHours(time.hour, time.minute, 0, 0);
  return value;
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
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  slotTimeField: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    minWidth: 140,
    padding: spacing.md,
    width: '48%',
  },
  selectButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.lg,
  },
  selectText: { ...typography.body, flex: 1, fontWeight: '700' },
  selectChevron: { color: colors.brand, fontSize: 22 },
  dayMenu: { gap: 0, padding: spacing.xs },
  dayOption: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexDirection: 'row',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
  },
  dayOptionSelected: { backgroundColor: colors.brandSoft },
  dayOptionText: { ...typography.body, flex: 1 },
  dayOptionTextSelected: { color: colors.brand, fontWeight: '700' },
  check: { color: colors.success, fontSize: 18, fontWeight: '800' },
  help: { ...typography.caption, marginTop: 4 },
  label: typography.label,
  linkText: { color: '#0F6F70', fontWeight: '600', paddingVertical: 8 },
  restoreSummary: { backgroundColor: colors.surface },
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
});
