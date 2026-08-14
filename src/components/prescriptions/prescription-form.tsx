import medicationReferenceAsset from '../../../assets/medications/medications.db';
import { router, usePathname, useFocusEffect } from 'expo-router';
import {
  SQLiteProvider,
  useSQLiteContext,
  type SQLiteDatabase,
} from 'expo-sqlite';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  assertValidPrescriptionItemDraft,
  type PrescriptionItem,
  type PrescriptionItemDraft,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import { drainCreatedTreatmentForPrescription } from '@/infrastructure/prescriptions/pending-new-treatment-for-prescription';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { AppButton, AppField, Message, spacing, typography } from '@/ui';

import { DateField } from '../treatments/date-field';
import {
  attachTreatmentToLine,
  emptyPrescriptionLine,
  PrescriptionLineEditor,
  type PrescriptionLineDraft,
} from './prescription-line-editor';

export type PrescriptionFormExistingItem = Readonly<{
  item: PrescriptionItem;
  treatment: Treatment;
}>;

export type PrescriptionFormValue = Readonly<{
  label: string;
  issueDate: string;
  validUntil: string | null;
  newLines: readonly Omit<PrescriptionItemDraft, 'prescriptionId'>[];
}>;

type Props = {
  personalDatabase: SQLiteDatabase;
  initialValue: {
    label: string;
    issueDate: string;
    validUntil: string | null;
  };
  /** Lignes déjà enregistrées, affichées en lecture seule (édition uniquement). */
  existingItems?: readonly PrescriptionFormExistingItem[];
  onRemoveExistingItem?: (itemId: number) => Promise<void>;
  submitLabel: string;
  onSubmit: (value: PrescriptionFormValue) => Promise<void>;
};

export function PrescriptionForm({
  personalDatabase,
  initialValue,
  existingItems = [],
  onRemoveExistingItem,
  submitLabel,
  onSubmit,
}: Props) {
  const [label, setLabel] = useState(initialValue.label);
  const [issueDate, setIssueDate] = useState(initialValue.issueDate);
  const [validUntil, setValidUntil] = useState(initialValue.validUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingItemId, setRemovingItemId] = useState<number | null>(null);
  const linesSectionRef = useRef<PrescriptionLinesSectionHandle>(null);

  async function removeExistingItem(itemId: number): Promise<void> {
    if (onRemoveExistingItem === undefined) return;
    setRemovingItemId(itemId);
    setError(null);
    try {
      await onRemoveExistingItem(itemId);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Retrait impossible.',
      );
    } finally {
      setRemovingItemId(null);
    }
  }

  async function submit(): Promise<void> {
    try {
      setSaving(true);
      setError(null);
      const lines = linesSectionRef.current?.getLines() ?? [];
      const newLines = lines.map((line) => buildDraftFromLine(line));
      for (const draft of newLines)
        assertValidPrescriptionItemDraft({ ...draft, prescriptionId: 0 });
      await onSubmit({
        label,
        issueDate,
        validUntil: validUntil.trim() === '' ? null : validUntil,
        newLines,
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <AppField
        label="Intitulé"
        placeholder="Ex. « ordo psychiatre », « ordo généraliste »"
        value={label}
        onChangeText={setLabel}
      />
      <DateField
        label="Date d’émission"
        value={issueDate}
        onChange={setIssueDate}
      />
      <DateField
        label="Fin de validité (optionnelle)"
        value={validUntil}
        onChange={setValidUntil}
      />
      {existingItems.length > 0 ? (
        <>
          <Text style={styles.heading}>Traitements déjà associés</Text>
          {existingItems.map(({ item, treatment }) => (
            <ExistingItemCard
              key={item.id}
              item={item}
              treatment={treatment}
              removing={removingItemId === item.id}
              onRemove={
                onRemoveExistingItem
                  ? () => void removeExistingItem(item.id)
                  : undefined
              }
            />
          ))}
        </>
      ) : null}
      <Text style={styles.heading}>
        {existingItems.length > 0 ? 'Nouvelles lignes' : 'Traitements'}
      </Text>
      {/*
        Connexion dédiée, propre à cette section, qui possède elle-même l'état
        de ses lignes (voir PrescriptionLinesSection) : `SQLiteProvider`
        (expo-sqlite) est un `React.memo` dont le comparateur ne tient pas
        compte de `children`, ce qui gèle silencieusement toute mise à jour
        provenant d'un parent une fois monté. En laissant cette section gérer
        ses propres lignes en interne (et en les exposant au parent via une
        ref plutôt que des props), ses mises à jour proviennent toujours de
        l'intérieur du sous-arbre, jamais d'un re-rendu du parent — donc
        jamais gelées par ce memo.
        `useSuspense` volontairement omis : son mode s'appuie sur un cache
        global partagé entre tous les `SQLiteProvider` du même nom de base,
        quel que soit l'écran — naviguer vers un autre écran ouvrant aussi
        `medication-reference.db` en mode suspense ferme alors cette
        connexion pendant qu'elle est encore utilisée ici (constaté : crash
        « unable to close due to unfinalized statements »).
      */}
      <SQLiteProvider
        databaseName="medication-reference.db"
        assetSource={{
          assetId: medicationReferenceAsset,
          forceOverwrite: true,
        }}
        options={{ useNewConnection: true }}
      >
        <PrescriptionLinesSection
          ref={linesSectionRef}
          personalDatabase={personalDatabase}
        />
      </SQLiteProvider>
      {error ? (
        <Message tone="error" title="Ordonnance non enregistrée">
          {error}
        </Message>
      ) : null}
      <AppButton
        label={submitLabel}
        loading={saving}
        onPress={() => void submit()}
      />
    </View>
  );
}

type PrescriptionLinesSectionHandle = {
  getLines: () => readonly PrescriptionLineDraft[];
};

/**
 * Suppose que la connexion `medication-reference.db` est déjà fournie par un
 * `SQLiteProvider` ancêtre. Possède son propre état (lignes, traitements
 * disponibles) plutôt que de le recevoir en props du parent : voir le
 * commentaire dans `PrescriptionForm` sur le memo de `SQLiteProvider`.
 */
const PrescriptionLinesSection = forwardRef<
  PrescriptionLinesSectionHandle,
  { personalDatabase: SQLiteDatabase }
>(function PrescriptionLinesSection({ personalDatabase }, ref) {
  const referenceDatabase = useSQLiteContext();
  const pathname = usePathname();
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [lines, setLines] = useState<PrescriptionLineDraft[]>([]);
  const nextKeyRef = useRef(0);
  const awaitingLineKeyRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({ getLines: () => lines }), [lines]);

  // Recalculé à chaque focus, pas seulement au montage : l'écran reste monté
  // dans la pile de navigation pendant un aller-retour vers l'ajout d'un
  // nouveau traitement (ticket 46, même pattern que TreatmentForm/ticket 29),
  // un simple useEffect ne se redéclencherait donc jamais au retour.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listTreatments(personalDatabase).then((all) => {
        if (cancelled) return;
        const nonArchived = all.filter((item) => item.archivedAt === null);
        setTreatments(nonArchived);
        const createdTreatmentId = drainCreatedTreatmentForPrescription();
        const awaitingKey = awaitingLineKeyRef.current;
        if (createdTreatmentId === null || awaitingKey === null) return;
        const created = nonArchived.find(
          (item) => item.id === createdTreatmentId,
        );
        awaitingLineKeyRef.current = null;
        if (created === undefined) return;
        setLines((current) =>
          current.map((line) =>
            line.key === awaitingKey
              ? attachTreatmentToLine(line, created)
              : line,
          ),
        );
      });
      return () => {
        cancelled = true;
      };
    }, [personalDatabase]),
  );

  function addLine(): void {
    nextKeyRef.current += 1;
    setLines((current) => [
      ...current,
      emptyPrescriptionLine(`line-${nextKeyRef.current}`),
    ]);
  }

  function requestNewTreatmentFor(lineKey: string): void {
    awaitingLineKeyRef.current = lineKey;
    router.push({
      pathname: '/medications/search',
      params: { returnTo: pathname },
    });
  }

  return (
    <>
      {lines.map((line) => (
        <PrescriptionLineEditor
          key={line.key}
          line={line}
          treatments={treatments}
          referenceDatabase={referenceDatabase}
          onChange={(next) =>
            setLines((current) =>
              current.map((item) => (item.key === next.key ? next : item)),
            )
          }
          onRemove={() =>
            setLines((current) =>
              current.filter((item) => item.key !== line.key),
            )
          }
          onRequestNewTreatment={() => requestNewTreatmentFor(line.key)}
        />
      ))}
      <AppButton
        label="Ajouter une ligne"
        variant="secondary"
        onPress={addLine}
      />
    </>
  );
});

function ExistingItemCard({
  item,
  treatment,
  removing,
  onRemove,
}: {
  item: PrescriptionItem;
  treatment: Treatment;
  removing: boolean;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.existingItem}>
      <Text style={typography.heading}>{treatment.specialtyName}</Text>
      <Text>{describePrescriptionItem(item)}</Text>
      {onRemove ? (
        <AppButton
          label="Retirer ce traitement"
          variant="quiet"
          loading={removing}
          onPress={onRemove}
        />
      ) : null}
    </View>
  );
}

function describePrescriptionItem(item: PrescriptionItem): string {
  const quantity =
    item.quantityKind === 'DURATION'
      ? `Durée : ${item.durationDays} jour(s)`
      : `${item.boxCount} boîte(s)`;
  const dispensing =
    item.dispensingMode === 'FRACTIONAL'
      ? `Délivrance fractionnée (${item.periodicityDays} jours)`
      : 'Délivrance complète';
  return `${quantity} · ${dispensing}`;
}

export function buildDraftFromLine(
  line: PrescriptionLineDraft,
): Omit<PrescriptionItemDraft, 'prescriptionId'> {
  if (line.treatment === null)
    throw new Error('Complétez ou retirez toute ligne sans traitement choisi.');
  const fractional = line.dispensingMode === 'FRACTIONAL';
  return {
    treatmentId: line.treatment.id,
    quantityKind: line.quantityKind,
    durationDays:
      line.quantityKind === 'DURATION'
        ? toNumberOrNull(line.durationDaysText)
        : null,
    boxCount:
      line.quantityKind === 'BOX_COUNT'
        ? toNumberOrNull(line.boxCountText)
        : null,
    dispensingMode: line.dispensingMode,
    periodicityDays: fractional
      ? toNumberOrNull(line.periodicityDaysText)
      : null,
    lastDispensedAt: null,
    theoreticalRenewalDate: null,
    toleranceDays: fractional ? toNumberOrNull(line.toleranceDaysText) : null,
  };
}

function toNumberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return Number(trimmed);
}

const styles = StyleSheet.create({
  existingItem: { gap: spacing.xs, marginTop: spacing.sm },
  form: { gap: spacing.md },
  heading: { ...typography.heading, marginTop: spacing.md },
});
