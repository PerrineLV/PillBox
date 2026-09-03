import { router, usePathname, useFocusEffect } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { todayIso } from '@/domain/inventory/inventory';
import {
  assertValidPrescriptionItemDraft,
  type Prescription,
  type PrescriptionItem,
  type PrescriptionItemDraft,
} from '@/domain/prescriptions/prescription';
import type { Treatment } from '@/domain/treatments/treatment';
import { drainCreatedTreatmentForPrescription } from '@/infrastructure/prescriptions/pending-new-treatment-for-prescription';
import { listActivePrescriptionsCoveringTreatments } from '@/infrastructure/prescriptions/prescription-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import { useMedicationReferenceDatabase } from '@/infrastructure/medications/medication-reference-provider';
import {
  AppCard,
  AppField,
  Message,
  PillButton,
  SectionLabel,
  typography,
} from '@/ui';

import { DateField } from '../treatments/date-field';
import {
  attachTreatmentToLine,
  emptyPrescriptionLine,
  PrescriptionLineEditor,
  type PrescriptionLineDraft,
} from './prescription-line-editor';
import { PrescriptionReplacementConfirmation } from './prescription-replacement-confirmation';

export type PrescriptionFormExistingItem = Readonly<{
  item: PrescriptionItem;
  treatment: Treatment;
}>;

export type PrescriptionFormValue = Readonly<{
  label: string;
  issueDate: string;
  validUntil: string | null;
  newLines: readonly Omit<PrescriptionItemDraft, 'prescriptionId'>[];
  /**
   * Ordonnances actives dont le remplacement par celle-ci a été confirmé
   * explicitement (ticket 48) : à l'appelant de les marquer REPLACED une
   * fois cette ordonnance créée ou mise à jour, jamais avant.
   */
  replacesPrescriptionIds: readonly number[];
}>;

type Props = {
  personalDatabase: SQLiteDatabase;
  initialValue: {
    label: string;
    issueDate: string;
    validUntil: string | null;
  };
  /** `null` en création : rien à exclure de la détection de chevauchement. */
  currentPrescriptionId?: number | null;
  /** Lignes déjà enregistrées, affichées en lecture seule (édition uniquement). */
  existingItems?: readonly PrescriptionFormExistingItem[];
  onRemoveExistingItem?: (itemId: number) => Promise<void>;
  submitLabel: string;
  onSubmit: (value: PrescriptionFormValue) => Promise<void>;
};

/** Ligne construite, en attente de la confirmation explicite d'un ou plusieurs remplacements avant soumission finale. */
type PendingReplacementConfirmation = Readonly<{
  newLines: readonly Omit<PrescriptionItemDraft, 'prescriptionId'>[];
  queue: readonly Prescription[];
  confirmed: readonly number[];
}>;

export function PrescriptionForm({
  personalDatabase,
  initialValue,
  currentPrescriptionId = null,
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
  const [pendingReplacement, setPendingReplacement] =
    useState<PendingReplacementConfirmation | null>(null);
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

      const treatmentIds = [
        ...new Set(newLines.map((draft) => draft.treatmentId)),
      ];
      const overlaps =
        treatmentIds.length > 0
          ? await listActivePrescriptionsCoveringTreatments(
              personalDatabase,
              treatmentIds,
              todayIso(),
              currentPrescriptionId,
            )
          : [];
      if (overlaps.length > 0) {
        // Jamais automatique (ticket 48) : chaque ordonnance déjà active sur
        // l'un des traitements est proposée une par une, avant tout
        // enregistrement.
        setPendingReplacement({ newLines, queue: overlaps, confirmed: [] });
        setSaving(false);
        return;
      }
      await finalizeSubmit(newLines, []);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
      setSaving(false);
    }
  }

  async function finalizeSubmit(
    newLines: readonly Omit<PrescriptionItemDraft, 'prescriptionId'>[],
    replacesPrescriptionIds: readonly number[],
  ): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        label,
        issueDate,
        validUntil: validUntil.trim() === '' ? null : validUntil,
        newLines,
        replacesPrescriptionIds,
      });
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmCurrentReplacement(): void {
    if (!pendingReplacement) return;
    const [current, ...rest] = pendingReplacement.queue;
    const confirmed = [...pendingReplacement.confirmed, current.id];
    if (rest.length === 0) {
      setPendingReplacement(null);
      void finalizeSubmit(pendingReplacement.newLines, confirmed);
      return;
    }
    setPendingReplacement({ ...pendingReplacement, queue: rest, confirmed });
  }

  function skipCurrentReplacement(): void {
    if (!pendingReplacement) return;
    const rest = pendingReplacement.queue.slice(1);
    if (rest.length === 0) {
      setPendingReplacement(null);
      void finalizeSubmit(
        pendingReplacement.newLines,
        pendingReplacement.confirmed,
      );
      return;
    }
    setPendingReplacement({ ...pendingReplacement, queue: rest });
  }

  return (
    <View style={styles.form}>
      <AppField
        label="Intitulé"
        placeholder="Ex. « ordo généraliste »"
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
          <SectionLabel>Traitements déjà associés</SectionLabel>
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
      <SectionLabel>
        {existingItems.length > 0 ? 'Nouvelles lignes' : 'Traitements'}
      </SectionLabel>
      <PrescriptionLinesSection
        ref={linesSectionRef}
        personalDatabase={personalDatabase}
      />
      {error ? (
        <Message tone="error" title="Ordonnance non enregistrée">
          {error}
        </Message>
      ) : null}
      <PillButton
        disabled={saving}
        label={submitLabel}
        onPress={() => void submit()}
      />
      <PrescriptionReplacementConfirmation
        visible={pendingReplacement !== null}
        overlapping={pendingReplacement?.queue[0] ?? null}
        busy={saving}
        onSkip={skipCurrentReplacement}
        onConfirm={confirmCurrentReplacement}
      />
    </View>
  );
}

type PrescriptionLinesSectionHandle = {
  getLines: () => readonly PrescriptionLineDraft[];
};

/**
 * Consomme la connexion BDPM partagée et conserve son propre état pour que le
 * retour depuis la création d'un traitement préserve le formulaire.
 */
const PrescriptionLinesSection = forwardRef<
  PrescriptionLinesSectionHandle,
  { personalDatabase: SQLiteDatabase }
>(function PrescriptionLinesSection({ personalDatabase }, ref) {
  const referenceDatabase = useMedicationReferenceDatabase();
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
      <PillButton
        height={46}
        label="Ajouter une ligne"
        onPress={addLine}
        tone="outline"
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
    <AppCard tone="muted">
      <Text style={styles.itemName}>{treatment.specialtyName}</Text>
      <Text style={typography.detail}>{describePrescriptionItem(item)}</Text>
      {onRemove ? (
        <PillButton
          disabled={removing}
          height={40}
          label="Retirer ce traitement"
          onPress={onRemove}
          tone="destructive"
        />
      ) : null}
    </AppCard>
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
  form: { gap: 12 },
  itemName: { ...typography.itemTitle, fontSize: 14.5, lineHeight: 19 },
});
