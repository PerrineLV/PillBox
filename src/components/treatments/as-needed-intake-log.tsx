import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AsNeededIntakeRecord } from '@/domain/intakes/as-needed-intake';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  getLastAsNeededIntake,
  listAsNeededIntakes,
  recordAsNeededIntake,
} from '@/infrastructure/intakes/as-needed-intake-repository';
import { formatFrenchDateTime } from './civil-date';
import {
  AppButton,
  AppField,
  Card,
  LoadingState,
  Message,
  SectionTitle,
  colors,
  radii,
  sizes,
  spacing,
  typography,
  useToast,
} from '@/ui';

const RECENT_HISTORY_LIMIT = 5;

export function AsNeededIntakeLog({
  treatmentId,
  canRecord,
}: {
  treatmentId: number;
  canRecord: boolean;
}) {
  const database = useSQLiteContext();
  const [last, setLast] = useState<AsNeededIntakeRecord | null | undefined>(
    undefined,
  );
  const [history, setHistory] = useState<AsNeededIntakeRecord[]>([]);
  const [takenAt, setTakenAt] = useState(() => new Date());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [quantityText, setQuantityText] = useState('1');
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const [lastIntake, records] = await Promise.all([
      getLastAsNeededIntake(database, treatmentId),
      listAsNeededIntakes(database, treatmentId),
    ]);
    setLast(lastIntake);
    setHistory(records.slice(0, RECENT_HISTORY_LIMIT));
  }, [database, treatmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseDate(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setDatePickerVisible(false);
    if (event.type !== 'set' || !date) return;
    setTakenAt((previous) => {
      const next = new Date(previous);
      next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      return next;
    });
  }

  function chooseTime(event: DateTimePickerEvent, date?: Date): void {
    if (Platform.OS !== 'ios') setTimePickerVisible(false);
    if (event.type !== 'set' || !date) return;
    setTakenAt((previous) => {
      const next = new Date(previous);
      next.setHours(date.getHours(), date.getMinutes(), 0, 0);
      return next;
    });
  }

  async function submit({
    takenAt: nextTakenAt,
    quantityHalfUnits,
  }: {
    takenAt: Date;
    quantityHalfUnits: number;
  }): Promise<void> {
    try {
      setSaving(true);
      setError(null);
      await recordAsNeededIntake(database, {
        treatmentId,
        takenAt: nextTakenAt.toISOString(),
        quantityHalfUnits,
        note: null,
      });
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

  function saveImmediate(): void {
    void submit({ takenAt: new Date(), quantityHalfUnits: 2 });
  }

  function saveDetails(): void {
    const normalized = quantityText.trim().replace(',', '.');
    void submit({
      takenAt,
      quantityHalfUnits: Math.round(Number(normalized) * 2),
    });
  }

  return (
    <View style={styles.section}>
      <SectionTitle>Prise ponctuelle</SectionTitle>
      {last === undefined ? (
        <LoadingState label="Chargement de la dernière prise…" />
      ) : null}
      {last === null ? (
        <Text style={typography.body}>
          Aucune prise enregistrée pour l’instant.
        </Text>
      ) : null}
      {last ? (
        <Card>
          <Text style={typography.label}>Dernière prise</Text>
          <Text style={typography.body}>
            {formatFrenchDateTime(last.takenAt)} ·{' '}
            {formatHalfUnits(last.quantityHalfUnits)} unité(s)
          </Text>
          {last.note ? (
            <Text style={typography.caption}>{last.note}</Text>
          ) : null}
        </Card>
      ) : null}
      {canRecord ? (
        <View style={styles.recorder}>
          <AppButton
            label="Prise maintenant"
            loading={saving}
            onPress={saveImmediate}
          />
          {error ? <Message tone="error">{error}</Message> : null}
          <Pressable
            accessibilityLabel={
              detailsExpanded
                ? 'Masquer les options de prise personnalisée'
                : 'Modifier la date, l’heure ou la quantité'
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsExpanded }}
            onPress={() => setDetailsExpanded((current) => !current)}
            style={styles.detailsButton}
          >
            <Text style={styles.detailsTitle}>
              {detailsExpanded
                ? 'Masquer les options de prise personnalisée'
                : 'Modifier la date, l’heure ou la quantité'}
            </Text>
          </Pressable>
          {detailsExpanded ? (
            <View style={styles.details}>
              <View style={styles.row}>
                <AppButton
                  label={`Date : ${takenAt.toLocaleDateString('fr-FR')}`}
                  variant="secondary"
                  onPress={() => setDatePickerVisible(true)}
                />
                <AppButton
                  label={`Heure : ${takenAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`}
                  variant="secondary"
                  onPress={() => setTimePickerVisible(true)}
                />
              </View>
              {datePickerVisible ? (
                <DateTimePicker
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  locale="fr-FR"
                  mode="date"
                  maximumDate={new Date()}
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
              <AppField
                label="Quantité prise"
                inputMode="decimal"
                value={quantityText}
                onChangeText={setQuantityText}
              />
              <AppButton
                label="Enregistrer"
                loading={saving}
                onPress={saveDetails}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {history.length > 1 ? (
        <View style={styles.recent}>
          <Text style={styles.label}>Prises récentes</Text>
          {history.map((item) => (
            <Text key={item.id} style={typography.caption}>
              {formatFrenchDateTime(item.takenAt)} ·{' '}
              {formatHalfUnits(item.quantityHalfUnits)} unité(s)
              {item.note ? ` · ${item.note}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  recorder: { gap: spacing.sm },
  details: { gap: spacing.sm },
  detailsButton: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: sizes.touch,
    paddingHorizontal: spacing.md,
  },
  detailsTitle: { ...typography.label, textAlign: 'center' },
  recent: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { fontWeight: '600' },
});
