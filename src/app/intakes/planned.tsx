import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { OutsidePillboxIntakeBoxChoice } from '@/components/intakes/outside-pillbox-intake-box-choice';
import {
  formatFrenchDateTime,
  formatFullFrenchCivilDate,
} from '@/components/treatments/civil-date';
import { formatSlotTime } from '@/components/home/next-intake-labels';
import {
  canValidateWholeGroup,
  pendingIntakesOfGroup,
  type IntakeRecord,
} from '@/domain/intakes/intake-tracking';
import type { IntakeSlotTimes } from '@/domain/reminders/intake-reminder';
import {
  formatHalfUnits,
  isIntakeSlot,
  type IntakeSlot,
} from '@/domain/treatments/treatment';
import {
  cancelIntakePostponement,
  replaceIntakePostponement,
} from '@/infrastructure/intakes/intake-postponement-service';
import {
  getIntakePostponement,
  listIntakeRecordsForGroups,
  markPendingIntakesTaken,
  updateIntakeStatus,
  type IntakePostponement,
} from '@/infrastructure/intakes/intake-repository';
import { getGlobalIntakeReminderSettings } from '@/infrastructure/reminders/intake-reminder-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppScreen,
  Banner,
  DenseList,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  PillButton,
  StackHeader,
  colors,
  radii,
  sizes,
  typography,
} from '@/ui';

const DEFAULT_SLOT_TIMES: IntakeSlotTimes = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 0 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
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
  const [slotTimes, setSlotTimes] =
    useState<IntakeSlotTimes>(DEFAULT_SLOT_TIMES);
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
  const [outsidePillboxRecord, setOutsidePillboxRecord] =
    useState<IntakeRecord | null>(null);
  const [outsidePillboxTreatmentIds, setOutsidePillboxTreatmentIds] = useState<
    ReadonlySet<number>
  >(new Set());

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
          [...byDate].map(([groupDate, slots]) =>
            listIntakeRecordsForGroups(database, groupDate, slots),
          ),
        )
      ).flat();
      const [reports, treatments, times] = await Promise.all([
        Promise.all(
          groups.map((group) =>
            getIntakePostponement(database, group.date, group.slot),
          ),
        ),
        listTreatments(database),
        getGlobalIntakeReminderSettings(database),
      ]);
      setRecords(loaded);
      setSlotTimes(times);
      setOutsidePillboxTreatmentIds(
        new Set(
          treatments
            .filter(
              (treatment) =>
                treatment.dosageKind === 'SCHEDULED' &&
                !treatment.includedInPillbox,
            )
            .map((treatment) => treatment.id),
        ),
      );
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

  function isOutsidePillbox(record: IntakeRecord): boolean {
    return outsidePillboxTreatmentIds.has(record.treatmentId);
  }

  async function toggle(record: IntakeRecord): Promise<void> {
    if (record.status !== 'TAKEN' && isOutsidePillbox(record)) {
      setOutsidePillboxRecord(record);
      return;
    }
    setBusyKey(record.key);
    setError(null);
    try {
      await updateIntakeStatus(
        database,
        record.key,
        record.status === 'TAKEN' ? 'UNSET' : 'TAKEN',
      );
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function skip(record: IntakeRecord): Promise<void> {
    setBusyKey(record.key);
    setError(null);
    try {
      await updateIntakeStatus(database, record.key, 'SKIPPED');
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function validateGroup(group: {
    date: string;
    slot: IntakeSlot;
  }): Promise<void> {
    const key = groupKey(group);
    setBusyKey(key);
    setError(null);
    try {
      const validated = await markPendingIntakesTaken(
        database,
        group.date,
        group.slot,
      );
      await load();
      if (validated === 0)
        setError('Aucun médicament n’était encore en attente pour ce créneau.');
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

  function chooseReportTime(event: DateTimePickerEvent, chosen?: Date): void {
    if (Platform.OS !== 'ios') setReportPickerVisible(false);
    if (event.type === 'set' && chosen) setReportTime(chosen);
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

  const all = records ?? [];
  const decided = all.filter((record) => record.status !== 'UNSET').length;
  const firstDate = groups[0]?.date;

  return (
    <AppScreen
      header={
        <StackHeader
          right={
            all.length > 0 ? (
              <Text style={styles.progress}>
                {decided}/{all.length}
              </Text>
            ) : undefined
          }
          subtitle={
            firstDate ? formatFullFrenchCivilDate(firstDate) : undefined
          }
          title="Prises du jour"
        />
      }
    >
      <Banner level="ok">
        « Non renseigné » ne signifie pas que la prise n’a pas eu lieu.
      </Banner>
      {error ? <Message tone="error">{error}</Message> : null}
      {records === null && !error ? (
        <LoadingState label="Chargement des prises…" />
      ) : null}
      {records?.length === 0 ? (
        <Banner level="warning">
          Le détail de cette prise n’est pas disponible dans l’historique local.
        </Banner>
      ) : null}

      {groups.map((group) => {
        const items = all.filter(
          (record) => record.date === group.date && record.slot === group.slot,
        );
        if (items.length === 0) return null;
        const report = postponements[groupKey(group)];
        const pending = pendingIntakesOfGroup(items, group).length;
        const canValidate =
          canValidateWholeGroup(items, group) && !items.some(isOutsidePillbox);
        return (
          <View key={groupKey(group)} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupLabel}>
                {INTAKE_SLOT_LABELS[group.slot]}
              </Text>
              <Text style={styles.groupTime}>
                {formatSlotTime(slotTimes[group.slot])}
              </Text>
              <View style={styles.groupRule} />
              {canValidate ? (
                <Pressable
                  accessibilityLabel={`Tout valider pour ${INTAKE_SLOT_LABELS[group.slot].toLowerCase()}`}
                  accessibilityRole="button"
                  disabled={busyKey !== null}
                  onPress={() => void validateGroup(group)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Text style={styles.validateAll}>Tout valider</Text>
                </Pressable>
              ) : null}
            </View>

            <DenseList>
              {items.map((record, index) => (
                <IntakeLine
                  busy={busyKey !== null}
                  first={index === 0}
                  key={record.key}
                  needsBoxChoice={isOutsidePillbox(record)}
                  onSkip={() => void skip(record)}
                  onToggle={() => void toggle(record)}
                  record={record}
                />
              ))}
            </DenseList>

            {report ? (
              <Text style={styles.report}>
                Report programmé le {formatFrenchDateTime(report.scheduledAt)}.
              </Text>
            ) : null}
            <View style={styles.groupActions}>
              <PillButton
                disabled={busyKey !== null || pending === 0}
                height={40}
                label={report ? 'Remplacer le report' : 'Reporter ce créneau'}
                onPress={() => openReport(group)}
                tone="outline"
              />
              {report ? (
                <PillButton
                  disabled={busyKey !== null}
                  height={40}
                  label="Annuler le report"
                  onPress={() => void cancelReport(group)}
                  tone="destructive"
                />
              ) : null}
            </View>

            {reporting && groupKey(reporting) === groupKey(group) ? (
              <View style={styles.reportPicker}>
                <Text style={typography.detail}>
                  Nouvelle heure :{' '}
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
                  <PillButton
                    height={40}
                    label="Modifier l’heure"
                    onPress={() => setReportPickerVisible(true)}
                    tone="outline"
                  />
                )}
                <PillButton
                  disabled={busyKey === groupKey(group)}
                  height={44}
                  label="Programmer le report"
                  onPress={() => void saveReport()}
                />
                <PillButton
                  height={40}
                  label="Fermer"
                  onPress={() => {
                    setReporting(null);
                    setReportPickerVisible(false);
                  }}
                  tone="outline"
                />
              </View>
            ) : null}
          </View>
        );
      })}

      <OutsidePillboxIntakeBoxChoice
        database={database}
        onCancel={() => setOutsidePillboxRecord(null)}
        onTaken={async () => {
          setOutsidePillboxRecord(null);
          await load();
        }}
        record={outsidePillboxRecord}
      />
    </AppScreen>
  );
}

function IntakeLine({
  record,
  first,
  busy,
  needsBoxChoice,
  onToggle,
  onSkip,
}: Readonly<{
  record: IntakeRecord;
  first: boolean;
  busy: boolean;
  needsBoxChoice: boolean;
  onToggle(): void;
  onSkip(): void;
}>) {
  const taken = record.status === 'TAKEN';
  const detail = [
    `${formatHalfUnits(record.quantityHalfUnits)} unité(s)`,
    record.pharmaceuticalForm,
    record.status === 'SKIPPED' ? 'Ignorée' : null,
    needsBoxChoice ? 'Boîte à désigner' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <View style={[styles.line, !first && styles.lineDivided]}>
      <Pressable
        accessibilityLabel={`${record.specialtyName}, ${detail}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: taken, disabled: busy }}
        disabled={busy}
        onPress={onToggle}
        style={({ pressed }) => [styles.lineMain, pressed && styles.pressed]}
      >
        <View style={[styles.checkbox, taken && styles.checkboxChecked]}>
          {taken ? (
            <Text accessibilityElementsHidden style={styles.checkboxMark}>
              ✓
            </Text>
          ) : null}
        </View>
        <View style={styles.lineText}>
          <Text style={[styles.name, taken && styles.nameTaken]}>
            {record.specialtyName}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </Pressable>
      {record.status === 'UNSET' ? (
        <Pressable
          accessibilityLabel={`Marquer ${record.specialtyName} comme ignorée`}
          accessibilityRole="button"
          disabled={busy}
          onPress={onSkip}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.skip}>Ignorer</Text>
        </Pressable>
      ) : null}
    </View>
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
  progress: {
    ...typography.numeric,
    color: colors.brand,
    fontSize: 16,
    lineHeight: 19,
  },
  group: { gap: 9 },
  groupHead: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  groupLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 17,
  },
  groupTime: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  groupRule: {
    backgroundColor: colors.cardBorder,
    flex: 1,
    height: 1,
  },
  validateAll: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  groupActions: { flexDirection: 'row', gap: 7 },
  line: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  lineDivided: { borderTopColor: colors.hairline, borderTopWidth: 1 },
  lineMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 11,
    minWidth: 0,
  },
  lineText: { flex: 1, gap: 3, minWidth: 0 },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxChecked: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  checkboxMark: {
    color: colors.onDark,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 15,
  },
  name: {
    ...typography.itemTitle,
    fontSize: 14.5,
    lineHeight: 18,
  },
  nameTaken: { color: colors.textTertiary },
  detail: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 15,
  },
  skip: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 15,
  },
  report: {
    color: colors.warning,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 15,
  },
  reportPicker: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.banner,
    gap: 9,
    padding: 12,
  },
  pressed: { opacity: 0.72 },
});
