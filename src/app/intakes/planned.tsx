import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import {
  formatFrenchDateTime,
  formatFullFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  formatHalfUnits,
  isIntakeSlot,
  type IntakeSlot,
} from '@/domain/treatments/treatment';
import {
  getIntakePostponement,
  listIntakeRecordsForGroups,
  updateIntakeGroupStatus,
  updateIntakeStatus,
  type IntakePostponement,
} from '@/infrastructure/intakes/intake-repository';
import {
  cancelIntakePostponement,
  replaceIntakePostponement,
} from '@/infrastructure/intakes/intake-postponement-service';
import {
  AppButton,
  AppModal,
  Badge,
  Card,
  Divider,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  spacing,
  typography,
} from '@/ui';

const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'Matin',
  noon: 'Midi',
  evening: 'Soir',
  bedtime: 'Coucher',
};
const STATUS_LABELS: Record<IntakeStatus, string> = {
  UNSET: 'Non renseigné',
  TAKEN: 'Pris',
  SKIPPED: 'Ignoré',
};

export default function PlannedIntakeScreen() {
  const {
    groups: groupsParameter,
    date,
    slot,
  } = useLocalSearchParams<{
    groups?: string;
    date?: string;
    slot?: string;
  }>();
  const database = useSQLiteContext();
  const [records, setRecords] = useState<IntakeRecord[] | null>(null);
  const [postponements, setPostponements] = useState<
    Record<string, IntakePostponement | null>
  >({});
  const [reporting, setReporting] = useState<{
    date: string;
    slot: IntakeSlot;
  } | null>(null);
  const [reportTime, setReportTime] = useState(
    () => new Date(Date.now() + 30 * 60_000),
  );
  const [reportPickerVisible, setReportPickerVisible] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState<{
    date: string;
    slot: IntakeSlot;
  } | null>(null);
  const groups = useMemo(
    () => resolveGroups({ groups: groupsParameter, date, slot }),
    [date, groupsParameter, slot],
  );

  const load = useCallback(async () => {
    if (groups.length === 0) {
      setError('Rappel invalide ou incomplet.');
      return;
    }
    try {
      const byDate = new Map<string, IntakeSlot[]>();
      for (const group of groups)
        byDate.set(group.date, [...(byDate.get(group.date) ?? []), group.slot]);
      const loaded = (
        await Promise.all(
          [...byDate].map(([date, slots]) =>
            listIntakeRecordsForGroups(database, date, slots),
          ),
        )
      ).flat();
      const reports = await Promise.all(
        groups.map((group) =>
          getIntakePostponement(database, group.date, group.slot),
        ),
      );
      setRecords(loaded);
      setPostponements(
        Object.fromEntries(
          groups.map((group, index) => [groupKey(group), reports[index]]),
        ),
      );
      setError(null);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    }
  }, [database, groups]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(
    record: IntakeRecord,
    status: IntakeStatus,
  ): Promise<void> {
    setBusyKey(record.key);
    setError(null);
    try {
      await updateIntakeStatus(database, record.key, status);
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function markWholeGroupTaken(): Promise<void> {
    if (!confirmGroup) return;
    const key = groupKey(confirmGroup);
    setBusyKey(key);
    setError(null);
    try {
      await updateIntakeGroupStatus(
        database,
        confirmGroup.date,
        confirmGroup.slot,
        'TAKEN',
      );
      setConfirmGroup(null);
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Validation de la prise impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  function openReport(group: { date: string; slot: IntakeSlot }): void {
    const existing = postponements[groupKey(group)];
    setReportTime(
      existing
        ? new Date(existing.scheduledAt)
        : new Date(Date.now() + 30 * 60_000),
    );
    setReporting(group);
    setReportPickerVisible(true);
  }

  function chooseReportTime(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setReportPickerVisible(false);
    if (event.type === 'set' && date) setReportTime(date);
  }

  async function saveReport(): Promise<void> {
    if (!reporting) return;
    const [year, month, day] = reporting.date.split('-').map(Number);
    const scheduledAt = new Date(
      year,
      month - 1,
      day,
      reportTime.getHours(),
      reportTime.getMinutes(),
      0,
      0,
    );
    setBusyKey(groupKey(reporting));
    setError(null);
    try {
      await replaceIntakePostponement(
        database,
        reporting.date,
        reporting.slot,
        scheduledAt,
      );
      setReporting(null);
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Report impossible.');
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelReport(group: {
    date: string;
    slot: IntakeSlot;
  }): Promise<void> {
    setBusyKey(groupKey(group));
    setError(null);
    try {
      await cancelIntakePostponement(database, group.date, group.slot);
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Annulation impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: 'Prise prévue' }} />
      <Text style={typography.title}>Prise prévue</Text>
      <Message>
        Ce suivi est une aide personnelle. « Non renseigné » ne signifie pas que
        la prise n’a pas eu lieu.
      </Message>
      {error ? <Message tone="error">{error}</Message> : null}
      {records === null && !error ? <LoadingState /> : null}
      {records?.length === 0 ? (
        <Message tone="warning">
          Le détail de cette prise n’est pas disponible dans l’historique local.
        </Message>
      ) : null}
      {groups.map((group) => {
        const items =
          records?.filter(
            (record) =>
              record.date === group.date && record.slot === group.slot,
          ) ?? [];
        const report = postponements[groupKey(group)];
        return (
          <View key={groupKey(group)} style={styles.group}>
            <SectionTitle>
              {SLOT_LABELS[group.slot]} ·{' '}
              {formatFullFrenchCivilDate(group.date)}
            </SectionTitle>
            {items.length > 0 ? (
              <AppButton
                label={
                  items.every((record) => record.status === 'TAKEN')
                    ? 'Tous les médicaments sont marqués comme pris'
                    : 'Marquer toute la prise comme prise'
                }
                disabled={
                  busyKey !== null ||
                  items.every((record) => record.status === 'TAKEN')
                }
                onPress={() => setConfirmGroup(group)}
              />
            ) : null}
            {items.map((record) => (
              <Card key={record.key}>
                <Text style={typography.label}>{record.specialtyName}</Text>
                <Text style={typography.body}>
                  {formatHalfUnits(record.quantityHalfUnits)} unité(s)
                  {record.pharmaceuticalForm
                    ? ` · ${record.pharmaceuticalForm}`
                    : ''}
                </Text>
                <Badge
                  label={STATUS_LABELS[record.status]}
                  tone={
                    record.status === 'TAKEN'
                      ? 'success'
                      : record.status === 'SKIPPED'
                        ? 'warning'
                        : 'neutral'
                  }
                />
                <View style={styles.actions}>
                  <AppButton
                    label="Marquer comme pris"
                    variant={
                      record.status === 'TAKEN' ? 'primary' : 'secondary'
                    }
                    disabled={busyKey !== null}
                    onPress={() => void changeStatus(record, 'TAKEN')}
                  />
                  <AppButton
                    label="Marquer comme ignoré"
                    variant="secondary"
                    disabled={busyKey !== null}
                    onPress={() => void changeStatus(record, 'SKIPPED')}
                  />
                  {record.status !== 'UNSET' ? (
                    <AppButton
                      label="Remettre non renseigné"
                      variant="quiet"
                      disabled={busyKey !== null}
                      onPress={() => void changeStatus(record, 'UNSET')}
                    />
                  ) : null}
                </View>
              </Card>
            ))}
            {report ? (
              <Message tone="success">
                Report programmé le {formatFrenchDateTime(report.scheduledAt)}.
              </Message>
            ) : null}
            <AppButton
              label={report ? 'Remplacer le report' : 'Reporter ce créneau'}
              variant="secondary"
              disabled={busyKey !== null || items.length === 0}
              onPress={() => openReport(group)}
            />
            {report ? (
              <AppButton
                label="Annuler le report"
                variant="quiet"
                disabled={busyKey !== null}
                onPress={() => void cancelReport(group)}
              />
            ) : null}
            {reporting && groupKey(reporting) === groupKey(group) ? (
              <Card>
                <Text style={typography.label}>
                  Nouvelle heure pour {SLOT_LABELS[group.slot].toLowerCase()}
                </Text>
                <Text style={typography.body}>
                  Heure choisie :{' '}
                  {reportTime.toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                {reportPickerVisible ? (
                  <DateTimePicker
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    is24Hour
                    mode="time"
                    onChange={chooseReportTime}
                    value={reportTime}
                  />
                ) : (
                  <AppButton
                    label="Modifier l’heure"
                    variant="secondary"
                    onPress={() => setReportPickerVisible(true)}
                  />
                )}
                <AppButton
                  label="Programmer le report"
                  loading={busyKey === groupKey(group)}
                  onPress={() => void saveReport()}
                />
                <AppButton
                  label="Fermer"
                  variant="quiet"
                  onPress={() => {
                    setReporting(null);
                    setReportPickerVisible(false);
                  }}
                />
              </Card>
            ) : null}
            <Divider />
          </View>
        );
      })}
      <AppModal
        visible={confirmGroup !== null}
        title="Confirmer toute la prise ?"
        primaryLabel="Tout marquer comme pris"
        busy={confirmGroup !== null && busyKey === groupKey(confirmGroup)}
        onCancel={() => setConfirmGroup(null)}
        onPrimary={() => void markWholeGroupTaken()}
      >
        <Text style={typography.body}>
          Tous les médicaments de ce créneau seront marqués comme pris. Vous
          pourrez ensuite corriger chaque médicament individuellement.
        </Text>
      </AppModal>
    </Screen>
  );
}

function resolveGroups(params: {
  groups?: string;
  date?: string;
  slot?: string;
}): { date: string; slot: IntakeSlot }[] {
  if (params.date && params.slot && isIntakeSlot(params.slot))
    return [{ date: params.date, slot: params.slot }];
  if (!params.groups) return [];
  return params.groups.split(',').flatMap((value) => {
    const match = /^(\d{4}-\d{2}-\d{2}):(morning|noon|evening|bedtime)$/.exec(
      value,
    );
    return match && isIntakeSlot(match[2])
      ? [{ date: match[1], slot: match[2] }]
      : [];
  });
}
function groupKey(group: { date: string; slot: IntakeSlot }): string {
  return `${group.date}:${group.slot}`;
}
const styles = StyleSheet.create({
  group: { gap: spacing.md },
  actions: { gap: spacing.sm },
});
