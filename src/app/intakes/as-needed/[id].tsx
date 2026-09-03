import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { formatFrenchDateTime } from '@/components/treatments/civil-date';
import {
  asNeededDayState,
  intakesOnLocalDay,
  type AsNeededDayState,
} from '@/domain/intakes/as-needed-availability';
import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import { formatHalfUnits, type Treatment } from '@/domain/treatments/treatment';
import {
  listAsNeededIntakes,
  recordAsNeededIntake,
} from '@/infrastructure/intakes/as-needed-intake-repository';
import { getTreatment } from '@/infrastructure/treatments/treatment-repository';
import {
  AppScreen,
  DenseList,
  DenseRow,
  LoadingState,
  Message,
  PillButton,
  Section,
  StackHeader,
  Stepper,
  colors,
  onDarkSurfaces,
  radii,
  typography,
  useToast,
} from '@/ui';

const RECENT_LIMIT = 8;

/** Enregistrer une prise ponctuelle, sans calendrier attendu. */
export default function AsNeededIntakeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const treatmentId = Number(id);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  const [intakes, setIntakes] = useState<AsNeededIntakeRecord[]>([]);
  const [quantityUnits, setQuantityUnits] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const [backdating, setBackdating] = useState(false);
  const [takenAt, setTakenAt] = useState(() => new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(treatmentId)) {
      setError('Identifiant de traitement invalide.');
      return;
    }
    const loaded = await getTreatment(database, treatmentId);
    if (loaded === null || loaded.dosageKind !== 'AS_NEEDED') {
      setError('Traitement si besoin introuvable.');
      return;
    }
    setTreatment(loaded);
    setIntakes(await listAsNeededIntakes(database, treatmentId));
    setNow(new Date());
    setError(null);
  }, [database, treatmentId]);

  useEffect(() => {
    void load().catch((reason: unknown) =>
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      ),
    );
  }, [load]);

  const state: AsNeededDayState | null = treatment
    ? asNeededDayState({
        now,
        limits: treatment.asNeededInfo,
        intakesToday: intakesOnLocalDay(intakes, now),
        lastIntake: intakes[0] ?? null,
      })
    : null;
  const archived = treatment?.archivedAt !== null;
  const blocked = state !== null && state.availability.status !== 'AVAILABLE';

  function chooseDate(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setDatePickerVisible(false);
    if (event.type !== 'set' || date === undefined) return;
    setTakenAt((previous) => {
      const next = new Date(previous);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }

  function chooseTime(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setTimePickerVisible(false);
    if (event.type !== 'set' || date === undefined) return;
    setTakenAt((previous) => {
      const next = new Date(previous);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  async function record(at: Date = new Date()): Promise<void> {
    if (saving || treatment === null) return;
    setSaving(true);
    try {
      await recordAsNeededIntake(database, {
        treatmentId: treatment.id,
        takenAt: at.toISOString(),
        quantityHalfUnits: Math.round(quantityUnits * 2),
        note: null,
      });
      setBackdating(false);
      setTakenAt(new Date());
      await load();
      showToast('Prise enregistrée.', 'success');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle={treatment?.pharmaceuticalForm ?? undefined}
          title={treatment?.specialtyName ?? 'Prise si besoin'}
        />
      }
    >
      {error ? <Message tone="error">{error}</Message> : null}
      {!error && treatment === null ? (
        <LoadingState label="Chargement du traitement…" />
      ) : null}

      {treatment && state ? (
        <>
          <View style={styles.panel}>
            <Text style={styles.eyebrow}>Aujourd’hui</Text>
            <View style={styles.counterRow}>
              <Text style={styles.counter}>
                {formatHalfUnits(state.takenHalfUnits)}
              </Text>
              <Text style={styles.context}>
                {contextLabel(treatment, state)}
              </Text>
            </View>
            {archived ? null : (
              <>
                <View style={styles.quantityRow}>
                  <Text style={styles.quantityLabel}>
                    Quantité à enregistrer
                  </Text>
                  <Stepper
                    disabled={saving}
                    format={(value) => formatHalfUnits(Math.round(value * 2))}
                    label="quantité prise"
                    min={0.5}
                    onChange={setQuantityUnits}
                    step={0.5}
                    value={quantityUnits}
                  />
                </View>
                <PillButton
                  disabled={blocked || saving}
                  height={50}
                  label="Enregistrer une prise maintenant"
                  onPress={() => void record()}
                  tone="onDark"
                />
              </>
            )}
          </View>

          {archived ? null : (
            <Section>
              <DenseList tone="muted">
                <DenseRow
                  accessibilityLabel="Enregistrer une prise passée"
                  chevron
                  detail="Choisir la date et l’heure réelles de la prise."
                  first
                  onPress={() => setBackdating((current) => !current)}
                  title="Prise déjà passée"
                />
              </DenseList>
              {backdating ? (
                <View style={styles.backdating}>
                  <PillButton
                    height={44}
                    label={`Date : ${takenAt.toLocaleDateString('fr-FR')}`}
                    onPress={() => setDatePickerVisible(true)}
                    tone="outline"
                  />
                  <PillButton
                    height={44}
                    label={`Heure : ${takenAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                    onPress={() => setTimePickerVisible(true)}
                    tone="outline"
                  />
                  {datePickerVisible ? (
                    <DateTimePicker
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      locale="fr-FR"
                      maximumDate={new Date()}
                      mode="date"
                      onChange={chooseDate}
                      value={takenAt}
                    />
                  ) : null}
                  {timePickerVisible ? (
                    <DateTimePicker
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      is24Hour
                      mode="time"
                      onChange={chooseTime}
                      value={takenAt}
                    />
                  ) : null}
                  <PillButton
                    disabled={saving}
                    label="Enregistrer cette prise"
                    onPress={() => void record(takenAt)}
                  />
                </View>
              ) : null}
            </Section>
          )}

          <Section aside={String(intakes.length)} label="Prises enregistrées">
            {intakes.length === 0 ? (
              <Text style={typography.detail}>
                Aucune prise enregistrée pour l’instant.
              </Text>
            ) : (
              <DenseList>
                {intakes.slice(0, RECENT_LIMIT).map((intake, index) => (
                  <DenseRow
                    first={index === 0}
                    key={intake.id}
                    leading={<View style={styles.dot} />}
                    title={
                      <Text style={styles.intakeTime}>
                        {formatFrenchDateTime(intake.takenAt)}
                      </Text>
                    }
                    trailing={
                      <Text style={styles.intakeQuantity}>
                        {formatHalfUnits(intake.quantityHalfUnits)} unité(s)
                      </Text>
                    }
                  />
                ))}
              </DenseList>
            )}
          </Section>
        </>
      ) : null}
    </AppScreen>
  );
}

function contextLabel(treatment: Treatment, state: AsNeededDayState): string {
  const max = treatment.asNeededInfo.maxQuantityPerDayHalfUnits;
  const taken =
    max === null
      ? 'unité(s) prise(s) aujourd’hui'
      : `unité(s) sur ${formatHalfUnits(max)} aujourd’hui`;
  if (state.availability.status === 'MAX_REACHED')
    return `${taken} · maximum atteint aujourd’hui`;
  if (state.availability.status === 'TOO_SOON')
    return `${taken} · prochaine possible à ${formatTime(state.availability.nextPossibleAt)}`;
  return taken;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.headerDark,
    borderRadius: radii.card,
    gap: 14,
    padding: 18,
  },
  eyebrow: { ...typography.sectionLabel, color: colors.onDarkMuted },
  counterRow: { alignItems: 'baseline', flexDirection: 'row', gap: 9 },
  counter: {
    ...typography.numeric,
    color: colors.onDark,
    fontSize: 30,
    lineHeight: 32,
  },
  context: {
    color: colors.onDarkMuted,
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 17,
    minWidth: 0,
  },
  quantityRow: {
    alignItems: 'center',
    backgroundColor: onDarkSurfaces.panel,
    borderColor: onDarkSurfaces.panelBorder,
    borderRadius: radii.tile,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  quantityLabel: {
    color: colors.onDarkMuted,
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 16,
    minWidth: 0,
  },
  backdating: { gap: 9 },
  dot: {
    backgroundColor: colors.onDarkMuted,
    borderRadius: radii.pill,
    height: 8,
    width: 8,
  },
  intakeTime: {
    ...typography.itemTitle,
    fontSize: 13.5,
    lineHeight: 17,
  },
  intakeQuantity: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
  },
});
