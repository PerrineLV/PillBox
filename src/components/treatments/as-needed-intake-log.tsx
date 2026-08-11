import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

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
  spacing,
  typography,
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
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function submit(): Promise<void> {
    try {
      setSaving(true);
      setError(null);
      const normalized = quantityText.trim().replace(',', '.');
      const quantityHalfUnits = Math.round(Number(normalized) * 2);
      await recordAsNeededIntake(database, {
        treatmentId,
        takenAt: takenAt.toISOString(),
        quantityHalfUnits,
        note: note.trim() === '' ? null : note.trim(),
      });
      setNote('');
      setTakenAt(new Date());
      await load();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
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
          <Text style={styles.label}>Enregistrer une prise</Text>
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
          <AppField
            label="Note (optionnel)"
            value={note}
            onChangeText={setNote}
          />
          {error ? <Message tone="error">{error}</Message> : null}
          <AppButton
            label="Enregistrer la prise"
            loading={saving}
            onPress={() => void submit()}
          />
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
  recent: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { fontWeight: '600' },
});
