import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import type { BackupSummary, PillBoxBackup } from '@/domain/backup/backup';
import {
  chooseBackupFile,
  sha256,
  shareBackup,
  writeSafetyBackup,
} from '@/infrastructure/backup/backup-files';
import {
  createBackup,
  getLastSuccessfulBackupAt,
  parseAndValidateBackup,
  recordSuccessfulBackup,
  restoreBackup,
} from '@/infrastructure/backup/backup-repository';
import { validateBackupCanRestore } from '@/infrastructure/backup/backup-validator';
import { reconcileIntakePostponements } from '@/infrastructure/intakes/intake-postponement-service';
import {
  cancelPostponedIntakeReminders,
  cancelPreparationReminders,
  replacePreparationReminder,
} from '@/infrastructure/reminders/local-notifications';
import {
  getPreparationReminderSettings,
  savePreparationReminderSettings,
} from '@/infrastructure/reminders/preparation-reminder-repository';
import { synchronizeIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import {
  AppCard,
  AppModal,
  AppScreen,
  ArrowIcon,
  Banner,
  DenseList,
  DenseRow,
  PillButton,
  Section,
  StackHeader,
  Tile,
  TileRow,
  colors,
  typography,
  useToast,
} from '@/ui';

export default function BackupScreen() {
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    backup: PillBoxBackup;
    summary: BackupSummary;
  } | null>(null);
  const [exportVisible, setExportVisible] = useState(false);
  const [restoreVisible, setRestoreVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void getLastSuccessfulBackupAt(database)
      .then((value) => {
        if (active) setLastBackupAt(value);
      })
      .catch(() => {
        if (active)
          showToast(
            'La date de dernière sauvegarde est indisponible.',
            'error',
          );
      });
    return () => {
      active = false;
    };
  }, [database, showToast]);

  async function exportData(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setExportVisible(false);
    try {
      const createdAt = new Date().toISOString();
      const backup = await createBackup(database, createdAt, sha256);
      await shareBackup(backup);
      await recordSuccessfulBackup(database, createdAt);
      setLastBackupAt(createdAt);
      showToast(
        'Sauvegarde exportée. Conservez ce fichier dans un emplacement sûr.',
        'success',
      );
    } catch (reason: unknown) {
      showToast(
        backupErrorMessage('La sauvegarde n’a pas pu être exportée', reason),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function selectBackup(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setPending(null);
    try {
      const serialized = await chooseBackupFile();
      if (serialized === null) return;
      const candidate = await parseAndValidateBackup(serialized, sha256);
      await validateBackupCanRestore(candidate.backup);
      setPending(candidate);
    } catch (reason: unknown) {
      showToast(
        backupErrorMessage('La sauvegarde a été refusée', reason),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  async function performRestore(): Promise<void> {
    if (pending === null || busy) return;
    setBusy(true);
    try {
      const safety = await createBackup(
        database,
        new Date().toISOString(),
        sha256,
      );
      await restoreBackup(database, pending.backup, async () => {
        writeSafetyBackup(safety);
      });
      await cancelPostponedIntakeReminders();
      setLastBackupAt(await getLastSuccessfulBackupAt(database));
      setPending(null);
      setRestoreVisible(false);
      await reprogramReminders(database);
      await reconcileIntakePostponements(database);
      showToast(
        'Sauvegarde restaurée intégralement. Une copie de sécurité de l’ancien état est conservée sur ce téléphone.',
        'success',
      );
    } catch (reason: unknown) {
      showToast(
        backupErrorMessage(
          'La restauration a échoué ; les données précédentes ont été conservées',
          reason,
        ),
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle="Export et restauration locales"
          title="Sauvegardes"
        />
      }
    >
      <AppCard>
        <Text style={typography.sectionLabel}>Dernière sauvegarde</Text>
        <Text style={styles.lastBackup}>
          {lastBackupAt === null ? 'Aucune' : formatBackupDate(lastBackupAt)}
        </Text>
        <PillButton
          disabled={busy}
          icon={<ArrowIcon color={colors.onDark} direction="up" size={17} />}
          label="Exporter une sauvegarde"
          onPress={() => setExportVisible(true)}
        />
      </AppCard>

      <Banner level="warning">
        Le fichier contient vos traitements, posologies, stocks, lots et
        historique. Il n’est pas chiffré : conservez-le dans un emplacement sûr
        et ne le partagez qu’avec une personne de confiance.
      </Banner>

      <Section label="Restaurer">
        <DenseList>
          <DenseRow
            chevron
            detail="Le contenu vérifié du fichier remplacera toutes les données actuelles. Une copie de sécurité est créée avant."
            disabled={busy}
            first
            leading={
              <ArrowIcon color={colors.brand} direction="down" size={19} />
            }
            onPress={() => void selectBackup()}
            title="Restaurer un fichier"
          />
        </DenseList>
      </Section>

      {pending ? (
        <AppCard>
          <Text style={typography.cardTitle}>Sauvegarde vérifiée</Text>
          <Text style={typography.detail}>
            Créée le {formatBackupDate(pending.summary.createdAt)} · schéma
            version {pending.summary.schemaVersion}
          </Text>
          <TileRow>
            <Tile
              label="Traitements"
              value={String(pending.summary.treatments)}
            />
            <Tile label="Boîtes" value={String(pending.summary.boxes)} />
          </TileRow>
          <TileRow>
            <Tile
              label="Mouvements"
              value={String(pending.summary.stockMovements)}
            />
            <Tile
              label="Préparations"
              value={String(pending.summary.preparations)}
            />
          </TileRow>
          <PillButton
            disabled={busy}
            label="Restaurer cette sauvegarde"
            onPress={() => setRestoreVisible(true)}
            tone="destructive"
          />
        </AppCard>
      ) : null}

      <AppModal
        busy={busy}
        onCancel={() => setExportVisible(false)}
        onPrimary={() => void exportData()}
        primaryLabel="Créer et partager la sauvegarde"
        title="Exporter des données sensibles ?"
        visible={exportVisible}
      >
        <Text style={typography.detail}>
          Cette sauvegarde contient notamment vos traitements, posologies,
          stocks, lots et historique. Le fichier n’est pas chiffré : toute
          personne qui y accède peut le lire.
        </Text>
      </AppModal>
      <AppModal
        busy={busy}
        destructive
        onCancel={() => setRestoreVisible(false)}
        onPrimary={() => void performRestore()}
        primaryLabel="Restaurer et remplacer"
        title="Remplacer les données actuelles ?"
        visible={restoreVisible}
      >
        <Text style={typography.detail}>
          Une sauvegarde de sécurité sera créée automatiquement sur ce
          téléphone. Toutes les données actuelles seront ensuite remplacées par
          le contenu vérifié du fichier.
        </Text>
      </AppModal>
    </AppScreen>
  );
}

/**
 * Après restauration, la programmation native ne correspond plus aux réglages
 * restaurés : elle est reconstruite à partir de la base, jamais devinée.
 */
async function reprogramReminders(
  database: Parameters<typeof getPreparationReminderSettings>[0],
): Promise<void> {
  const settings = await getPreparationReminderSettings(database);
  const schedule = {
    weekday: settings.weekday,
    hour: settings.hour,
    minute: settings.minute,
  };
  await cancelPreparationReminders();
  if (settings.enabled) {
    const identifier = await replacePreparationReminder(schedule);
    await savePreparationReminderSettings(database, schedule, identifier);
  }
  await synchronizeIntakeReminders(database);
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

const styles = StyleSheet.create({
  lastBackup: {
    ...typography.numeric,
    fontSize: 20,
    lineHeight: 24,
  },
});
