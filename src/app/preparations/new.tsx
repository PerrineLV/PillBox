import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import {
  formatFrenchCivilPeriod,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  isExpired,
  parseGs1Expiration,
  todayIso,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import {
  generatePreparationSnapshot,
  listBoxesForMedication,
  matchScannedBox,
  preparationWeeks,
  preparationWeekState,
  verifyPreparationBox,
  type BoxVerification,
  type BoxVerificationMethod,
  type KnownPreparation,
  type PreparationSnapshot,
  type PreparationWeek,
  type PreparationWeekChoice,
  type PreparationWeekState,
} from '@/domain/preparations/preparation';
import {
  formatHalfUnits,
  type IntakeSlot,
} from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  cancelPreparation,
  createPreparation,
  completePreparation,
  getLatestDraftPreparation,
  listPreparationWeeks,
  savePreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppButton,
  AppModal,
  Badge,
  Card,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

const WEEK_LABELS: Record<PreparationWeekChoice, string> = {
  CURRENT: 'Semaine à venir',
  NEXT: 'Semaine suivante',
};

const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'matin',
  noon: 'midi',
  evening: 'soir',
  bedtime: 'coucher',
};

type PendingBox = Readonly<{
  method: BoxVerificationMethod;
  /** Preuve brute du DataMatrix, absente lorsque la boîte est choisie dans le stock. */
  raw: string | null;
  verification: Extract<BoxVerification, { status: 'VALID' }>;
}>;

export default function NewPreparationScreen() {
  const database = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [snapshot, setSnapshot] = useState<PreparationSnapshot | null>(null);
  const [preparationId, setPreparationId] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [weeks, setWeeks] = useState<KnownPreparation[]>([]);
  const [choice, setChoice] = useState<PreparationWeekChoice>('CURRENT');
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingBox | null>(null);
  const [scanning, setScanning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [finalConfirmationVisible, setFinalConfirmationVisible] =
    useState(false);
  const [cancelConfirmationVisible, setCancelConfirmationVisible] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanLocked = useRef(false);
  const options = useMemo(() => preparationWeeks(todayIso()), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      getLatestDraftPreparation(database),
      listMedicationBoxes(database),
      listPreparationWeeks(database),
    ])
      .then(([saved, inventory, knownWeeks]) => {
        if (!active) return;
        setBoxes(inventory);
        setWeeks(knownWeeks);
        if (saved) {
          setSnapshot(saved.snapshot);
          setPreparationId(saved.id);
          setCompleted(
            new Set(saved.progress.map((item) => item.specialtyCis)),
          );
          return;
        }
        const available = options.find(
          (option) =>
            preparationWeekState(option.startDate, knownWeeks) === 'AVAILABLE',
        );
        setChoice(available?.choice ?? 'CURRENT');
      })
      .catch((reason: unknown) => {
        if (active)
          setError(message(reason, 'Chargement de la préparation impossible.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [database, options]);

  const current = useMemo(
    () =>
      snapshot?.requirements.find(
        (item) => !completed.has(item.specialtyCis),
      ) ?? null,
    [completed, snapshot],
  );

  const selectedWeek =
    options.find((week) => week.choice === choice) ?? options[0];
  const selectedWeekState = preparationWeekState(selectedWeek.startDate, weeks);

  async function generate(): Promise<void> {
    if (loading || preparationId !== null) return;
    if (selectedWeekState !== 'AVAILABLE') return;
    setLoading(true);
    setError(null);
    try {
      const referenceDate = todayIso();
      const treatments = await listTreatments(database);
      const generated = generatePreparationSnapshot(
        treatments,
        boxes,
        selectedWeek.startDate,
        referenceDate,
      );
      const id = await createPreparation(database, generated);
      setSnapshot(generated);
      setPreparationId(id);
    } catch (reason: unknown) {
      setError(message(reason, 'Génération impossible.'));
    } finally {
      setLoading(false);
    }
    // Après une création comme après un refus de doublon, l'écran doit refléter
    // l'état réel de la base locale.
    try {
      setWeeks(await listPreparationWeeks(database));
    } catch {
      // Les semaines déjà chargées restent affichées.
    }
  }

  /** Ramène l'écran au choix de la semaine sans toucher au stock. */
  function resetToWeekChoice(): void {
    setSnapshot(null);
    setPreparationId(null);
    setCompleted(new Set());
    setPending(null);
    setChoosing(false);
    setScanning(false);
    setFinalized(false);
    setError(null);
  }

  /** La semaine à venir reste le défaut tant qu'elle n'est pas déjà préparée. */
  function selectFirstAvailableWeek(known: readonly KnownPreparation[]): void {
    const available = options.find(
      (option) => preparationWeekState(option.startDate, known) === 'AVAILABLE',
    );
    setChoice(available?.choice ?? 'CURRENT');
  }

  function requestCancel(): void {
    if (preparationId === null || saving) return;
    if (completed.size > 0 || pending !== null) {
      setCancelConfirmationVisible(true);
      return;
    }
    void cancelCurrentPreparation();
  }

  async function cancelCurrentPreparation(): Promise<void> {
    if (preparationId === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await cancelPreparation(database, preparationId);
      setCancelConfirmationVisible(false);
      resetToWeekChoice();
      const known = await listPreparationWeeks(database);
      setWeeks(known);
      selectFirstAvailableWeek(known);
    } catch (reason: unknown) {
      setError(message(reason, 'Annulation impossible.'));
    } finally {
      setSaving(false);
    }
  }

  async function prepareAnotherWeek(): Promise<void> {
    resetToWeekChoice();
    try {
      const known = await listPreparationWeeks(database);
      setWeeks(known);
      selectFirstAvailableWeek(known);
    } catch (reason: unknown) {
      setError(message(reason, 'Chargement des semaines impossible.'));
    }
  }

  function beginScan(): void {
    setError(null);
    setPending(null);
    setChoosing(false);
    scanLocked.current = false;
    setScanning(true);
  }

  function beginChoice(): void {
    setError(null);
    setPending(null);
    setChoosing(true);
  }

  /**
   * Applique les mêmes contrôles de médicament, de lot et de péremption quelle
   * que soit la manière dont la boîte a été désignée.
   */
  function verifyBox(
    box: MedicationBox,
    method: BoxVerificationMethod,
    raw: string | null,
  ): void {
    if (current === null) return;
    const verification = verifyPreparationBox(
      current.specialtyCis,
      current.requiredHalfUnits,
      box,
      boxes,
      todayIso(),
    );
    if (verification.status === 'EXPIRED') {
      rejectBox(
        `Boîte périmée depuis le ${formatLongFrenchCivilDate(verification.box.expirationDate)} : utilisation bloquée.`,
      );
    } else if (verification.status === 'WRONG_MEDICATION') {
      rejectBox(
        `Produit différent détecté : ${verification.box.specialtyName}. Boîte refusée.`,
      );
    } else if (verification.status === 'INSUFFICIENT') {
      rejectBox(
        'Cette boîte ne contient pas assez de médicament pour ce traitement.',
      );
    } else {
      setScanning(false);
      setChoosing(false);
      setPending({ method, raw, verification });
    }
  }

  function handleScan(result: BarcodeScanningResult): void {
    if (scanLocked.current || current === null) return;
    scanLocked.current = true;
    const parsed = parseGs1DataMatrix(result.data);
    const cip13 = parsed.fields.gtin
      ? normalizeScannedGtinToCip13(parsed.fields.gtin)
      : null;
    const expirationDate = parsed.fields.expiration
      ? parseGs1Expiration(parsed.fields.expiration)
      : null;
    if (
      !cip13 ||
      !parsed.fields.lot ||
      !expirationDate ||
      parsed.errors.length > 0
    ) {
      rejectBox(
        'Scan incomplet ou invalide : produit, lot et péremption sont requis.',
      );
      return;
    }
    const match = matchScannedBox(
      {
        presentationCip13: cip13,
        lot: parsed.fields.lot,
        expirationDate,
      },
      boxes,
    );
    if (match.status !== 'MATCHED') {
      rejectBox(
        match.status === 'AMBIGUOUS'
          ? 'Plusieurs boîtes correspondent : impossible de savoir laquelle est utilisée.'
          : 'Cette boîte ne correspond exactement à aucune boîte du stock local.',
      );
      return;
    }
    verifyBox(match.box, 'SCAN', result.data);
  }

  function rejectBox(reason: string): void {
    setScanning(false);
    setChoosing(false);
    setError(reason);
  }

  async function validateMedication(
    acknowledgeNonFefo: boolean,
  ): Promise<void> {
    if (!pending || !current || preparationId === null || saving) return;
    if (!pending.verification.isFefo && !acknowledgeNonFefo) return;
    setSaving(true);
    setError(null);
    try {
      await savePreparationProgress(database, preparationId, {
        specialtyCis: current.specialtyCis,
        boxId: pending.verification.box.id,
        verification: pending.method,
        scanRaw: pending.raw,
        nonFefoAcknowledged: acknowledgeNonFefo,
      });
      setCompleted((previous) => new Set(previous).add(current.specialtyCis));
      setPending(null);
    } catch (reason: unknown) {
      setError(message(reason, 'Sauvegarde de la progression impossible.'));
    } finally {
      setSaving(false);
    }
  }

  async function validateFinalPreparation(): Promise<void> {
    if (preparationId === null || saving || finalized) return;
    setSaving(true);
    setError(null);
    try {
      await completePreparation(database, preparationId, todayIso());
      setFinalized(true);
      setFinalConfirmationVisible(false);
      setBoxes(await listMedicationBoxes(database));
    } catch (reason: unknown) {
      setError(message(reason, 'Validation finale impossible.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <Centered text="Chargement de la préparation…">
        <LoadingState label="Chargement de la préparation…" />
      </Centered>
    );
  if (scanning) {
    if (permission === null)
      return <Centered text="Vérification de la caméra…" />;
    if (!permission.granted)
      return (
        <Centered text="La caméra est nécessaire pour vérifier la boîte.">
          <AppButton
            label="Autoriser la caméra"
            onPress={() => void requestPermission()}
          />
          <AppButton
            label="Annuler"
            variant="quiet"
            onPress={() => setScanning(false)}
          />
        </Centered>
      );
    return (
      <View style={styles.cameraContainer}>
        <Stack.Screen
          options={{ headerShown: true, title: 'Vérifier la boîte' }}
        />
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={handleScan}
        >
          <View style={styles.guide}>
            <Text style={styles.guideText}>
              Scannez la boîte réellement utilisée
            </Text>
            {snapshot ? (
              <Text style={styles.guideText}>
                Semaine{' '}
                {formatFrenchCivilPeriod(snapshot.startDate, snapshot.endDate)}
              </Text>
            ) : null}
          </View>
        </CameraView>
        <AppButton
          label="Annuler le scan"
          variant="quiet"
          onPress={() => setScanning(false)}
        />
      </View>
    );
  }

  return (
    <Screen
      fixedHeader={
        snapshot ? (
          <View style={styles.periodHeader}>
            <Badge
              label={finalized ? 'Semaine validée' : 'Semaine en préparation'}
              tone={finalized ? 'success' : 'warning'}
            />
            <Text accessibilityRole="header" style={styles.period}>
              Semaine{' '}
              {formatFrenchCivilPeriod(snapshot.startDate, snapshot.endDate)}
            </Text>
          </View>
        ) : undefined
      }
      stickyFooter={
        current && !pending && !choosing ? (
          <View style={styles.footerActions}>
            <AppButton label="Scanner la boîte utilisée" onPress={beginScan} />
            <AppButton
              label="Choisir la boîte dans le stock"
              variant="secondary"
              onPress={beginChoice}
            />
          </View>
        ) : undefined
      }
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Préparer mon pilulier' }}
      />
      <Text style={styles.intro}>
        Préparation sur 7 jours. La progression est sauvegardée après chaque
        médicament. Aucun stock n’est encore décrémenté.
      </Text>
      {preparationId === null ? (
        <WeekChoice
          options={options}
          weeks={weeks}
          choice={choice}
          selectedState={selectedWeekState}
          onChoose={setChoice}
          onStart={() => void generate()}
        />
      ) : null}
      {error ? (
        <Message tone="error" title="Action impossible">
          {error}
        </Message>
      ) : null}
      {snapshot ? (
        <>
          <Text style={styles.periodDetail}>
            Du {formatLongFrenchCivilDate(snapshot.startDate)} au{' '}
            {formatLongFrenchCivilDate(snapshot.endDate)}
          </Text>
          <Text accessibilityRole="header" style={styles.progress}>
            {completed.size + (current ? 1 : 0)} sur{' '}
            {snapshot.requirements.length}
          </Text>
          <Text style={typography.caption}>
            {completed.size} médicament{completed.size > 1 ? 's' : ''} déjà
            vérifié
            {completed.size > 1 ? 's' : ''}
          </Text>
          {completed.size > 0 && current ? (
            <Badge label="Préparation reprise" tone="success" />
          ) : null}
        </>
      ) : null}
      {snapshot?.hasShortages ? (
        <Message
          tone="warning"
          title="Stock total insuffisant signalé lors de la génération"
        >
          La validation reste bloquée si la boîte scannée ne couvre pas le
          besoin.
        </Message>
      ) : null}
      {snapshot && snapshot.requirements.length === 0 ? (
        <Text>Aucune prise prévue pour cette période.</Text>
      ) : null}
      {current ? (
        <MedicationStep
          snapshot={snapshot!}
          specialtyCis={current.specialtyCis}
          name={current.specialtyName}
          requiredHalfUnits={current.requiredHalfUnits}
        />
      ) : null}
      {choosing && current && !pending ? (
        <StockBoxChoice
          boxes={listBoxesForMedication(
            current.specialtyCis,
            boxes,
            todayIso(),
          )}
          onCancel={() => setChoosing(false)}
          onSelect={(box) => verifyBox(box, 'MANUAL', null)}
        />
      ) : null}
      {pending && current ? (
        <BoxConfirmation
          pending={pending}
          saving={saving}
          onRestart={pending.method === 'SCAN' ? beginScan : beginChoice}
          onValidate={validateMedication}
        />
      ) : null}
      {snapshot && current === null && !finalized ? (
        <Card style={styles.success}>
          <Text style={styles.successTitle}>Contrôle final jour par jour</Text>
          <Text>
            Vérifiez le contenu attendu de chaque case avant de décrémenter le
            stock.
          </Text>
          <DailyFinalCheck snapshot={snapshot} />
          <Message tone="warning">
            Cette validation décrémentera le stock une seule fois. Contrôlez
            chaque case avant de continuer.
          </Message>
          <AppButton
            label="Valider définitivement la préparation"
            loading={saving}
            onPress={() => setFinalConfirmationVisible(true)}
          />
        </Card>
      ) : null}
      {finalized ? (
        <>
          <Message tone="success" title="Préparation validée">
            Le stock et les lots utilisés ont été enregistrés dans l’historique.
          </Message>
          <AppButton
            label="Préparer une autre semaine"
            variant="secondary"
            onPress={() => void prepareAnotherWeek()}
          />
        </>
      ) : null}
      {preparationId !== null && !finalized ? (
        <View style={styles.cancelArea}>
          <AppButton
            label="Annuler la préparation"
            variant="quiet"
            disabled={saving}
            onPress={requestCancel}
            accessibilityHint="Abandonne la préparation en cours sans modifier le stock"
          />
          <Text style={typography.caption}>
            L’annulation n’enregistre rien : aucun stock n’est modifié et aucune
            préparation n’apparaît dans l’historique.
          </Text>
        </View>
      ) : null}
      <AppModal
        visible={cancelConfirmationVisible}
        title="Annuler cette préparation ?"
        primaryLabel="Annuler la préparation"
        destructive
        busy={saving}
        onCancel={() => setCancelConfirmationVisible(false)}
        onPrimary={() => void cancelCurrentPreparation()}
      >
        <Text style={styles.intro}>
          {completed.size === 0
            ? 'La boîte désignée mais pas encore validée sera oubliée.'
            : completed.size > 1
              ? `Les ${completed.size} médicaments déjà vérifiés seront oubliés.`
              : 'Le médicament déjà vérifié sera oublié.'}{' '}
          Aucun stock n’est décrémenté et rien n’est ajouté à l’historique.
        </Text>
      </AppModal>
      <AppModal
        visible={finalConfirmationVisible}
        title="Valider la préparation ?"
        primaryLabel="Valider et décrémenter le stock"
        busy={saving}
        onCancel={() => setFinalConfirmationVisible(false)}
        onPrimary={() => void validateFinalPreparation()}
      >
        <Text style={styles.intro}>
          Cette action enregistre définitivement les lots utilisés et décrémente
          leur stock. Elle ne peut être effectuée qu’une fois.
        </Text>
      </AppModal>
    </Screen>
  );
}

/**
 * Choix explicite de la semaine à préparer. La semaine à venir reste
 * sélectionnée par défaut ; une semaine déjà validée ne peut pas être relancée.
 */
function WeekChoice({
  options,
  weeks,
  choice,
  selectedState,
  onChoose,
  onStart,
}: {
  options: readonly PreparationWeek[];
  weeks: readonly KnownPreparation[];
  choice: PreparationWeekChoice;
  selectedState: PreparationWeekState;
  onChoose(choice: PreparationWeekChoice): void;
  onStart(): void;
}) {
  return (
    <Card style={styles.card}>
      <SectionTitle>Quelle semaine préparer ?</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.weekOptions}>
        {options.map((option) => {
          const state = preparationWeekState(option.startDate, weeks);
          const selected = option.choice === choice;
          return (
            <Pressable
              accessibilityLabel={`${WEEK_LABELS[option.choice]}, semaine ${formatFrenchCivilPeriod(option.startDate, option.endDate)}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={option.choice}
              onPress={() => onChoose(option.choice)}
              style={[styles.weekOption, selected && styles.weekOptionSelected]}
            >
              <Text style={styles.weekOptionTitle}>
                {WEEK_LABELS[option.choice]}
              </Text>
              <Text style={styles.weekOptionPeriod}>
                Semaine{' '}
                {formatFrenchCivilPeriod(option.startDate, option.endDate)}
              </Text>
              {state === 'ALREADY_PREPARED' ? (
                <Badge label="Déjà préparée" tone="success" />
              ) : null}
              {state === 'IN_PROGRESS' ? (
                <Badge label="Préparation en cours" tone="warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {selectedState === 'ALREADY_PREPARED' ? (
        <Message tone="warning" title="Semaine déjà préparée">
          Une préparation validée existe déjà pour cette période. Choisissez une
          autre semaine plutôt que de créer un doublon.
        </Message>
      ) : null}
      {selectedState === 'IN_PROGRESS' ? (
        <Message tone="warning" title="Préparation déjà commencée">
          Une préparation incomplète existe pour cette période. Reprenez-la
          depuis l’accueil plutôt que d’en créer une nouvelle.
        </Message>
      ) : null}
      <AppButton
        label="Générer la préparation de 7 jours"
        disabled={selectedState !== 'AVAILABLE'}
        onPress={onStart}
      />
    </Card>
  );
}

function DailyFinalCheck({ snapshot }: { snapshot: PreparationSnapshot }) {
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${snapshot.startDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
  return (
    <View style={styles.finalCheck}>
      {dates.map((date) => (
        <View key={date} style={styles.day}>
          <Text style={styles.dayTitle}>{formatLongFrenchCivilDate(date)}</Text>
          {snapshot.items
            .filter((item) => item.date === date)
            .map((item, index) => (
              <Text
                key={`${item.slot}-${item.specialtyCis}-${index}`}
                style={styles.case}
              >
                • {SLOT_LABELS[item.slot]} · {item.specialtyName} :{' '}
                {formatHalfUnits(item.quantityHalfUnits)}
              </Text>
            ))}
          {snapshot.items.every((item) => item.date !== date) ? (
            <Text style={styles.case}>Aucune prise</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MedicationStep({
  snapshot,
  specialtyCis,
  name,
  requiredHalfUnits,
}: {
  snapshot: PreparationSnapshot;
  specialtyCis: string;
  name: string;
  requiredHalfUnits: number;
}) {
  const cases = snapshot.items.filter(
    (item) => item.specialtyCis === specialtyCis,
  );
  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{name}</Text>
      {cases[0]?.pharmaceuticalForm ? (
        <Text style={typography.body}>{cases[0].pharmaceuticalForm}</Text>
      ) : null}
      <Text style={styles.total}>
        Quantité totale : {formatHalfUnits(requiredHalfUnits)}
      </Text>
      <Text style={styles.casesTitle}>Cases concernées</Text>
      {cases.map((item, index) => (
        <Text key={`${item.date}-${item.slot}-${index}`} style={styles.case}>
          • {formatLongFrenchCivilDate(item.date)} · {SLOT_LABELS[item.slot]} :{' '}
          {formatHalfUnits(item.quantityHalfUnits)}
        </Text>
      ))}
    </Card>
  );
}

/**
 * Boîtes déjà enregistrées pour ce médicament. Les boîtes inutilisables restent
 * visibles mais explicitement signalées : rien n'est masqué silencieusement.
 */
function StockBoxChoice({
  boxes,
  onCancel,
  onSelect,
}: {
  boxes: readonly MedicationBox[];
  onCancel(): void;
  onSelect(box: MedicationBox): void;
}) {
  const today = todayIso();
  return (
    <Card style={styles.card}>
      <Text style={styles.casesTitle}>Boîtes enregistrées dans le stock</Text>
      <Text style={typography.caption}>
        Aucune lecture de DataMatrix ne sera enregistrée : les contrôles de
        médicament, de lot et de péremption restent appliqués.
      </Text>
      {boxes.length === 0 ? (
        <Text style={styles.case}>
          Aucune boîte de ce médicament n’est enregistrée dans le stock.
        </Text>
      ) : null}
      {boxes.map((box) => {
        const expired = isExpired(box.expirationDate, today);
        return (
          <Pressable
            accessibilityRole="button"
            key={box.id}
            onPress={() => onSelect(box)}
            style={styles.stockOption}
          >
            <Text style={styles.stockOptionTitle}>
              Boîte #{box.id} · lot {box.lot ?? 'non renseigné'}
            </Text>
            <Text>
              Péremption {formatLongFrenchCivilDate(box.expirationDate)} · reste{' '}
              {box.remainingQuantity}
            </Text>
            {expired ? <Badge label="Périmée" tone="danger" /> : null}
            {box.origin === 'MANUAL' ? (
              <Badge label="Ajoutée sans DataMatrix" />
            ) : null}
          </Pressable>
        );
      })}
      <AppButton label="Annuler" variant="quiet" onPress={onCancel} />
    </Card>
  );
}

function BoxConfirmation({
  pending,
  saving,
  onRestart,
  onValidate,
}: {
  pending: PendingBox;
  saving: boolean;
  onRestart(): void;
  onValidate(acknowledgeNonFefo: boolean): Promise<void>;
}) {
  const { box, isFefo, recommendedBox } = pending.verification;
  const scanned = pending.method === 'SCAN';
  return (
    <View style={isFefo ? styles.verified : styles.warning}>
      <Text style={styles.warningTitle}>
        {isFefo ? 'Boîte vérifiée' : 'Boîte valide, mais non FEFO'}
      </Text>
      <Badge
        label={
          scanned
            ? 'Vérifiée par scan DataMatrix'
            : 'Choisie dans le stock, sans scan'
        }
        tone={scanned ? 'success' : 'warning'}
      />
      <Text>
        Lot {box.lot ?? 'non renseigné'} · péremption{' '}
        {formatLongFrenchCivilDate(box.expirationDate)}
      </Text>
      {!isFefo ? (
        <Text>
          Lot recommandé : {recommendedBox.lot ?? 'non renseigné'} · péremption{' '}
          {formatLongFrenchCivilDate(recommendedBox.expirationDate)}. Vous
          pouvez continuer en confirmant cet avertissement.
        </Text>
      ) : null}
      <AppButton
        loading={saving}
        label={
          isFefo ? 'Valider ce médicament' : 'Utiliser quand même cette boîte'
        }
        onPress={() => void onValidate(!isFefo)}
      />
      <AppButton
        label={scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'}
        variant="secondary"
        onPress={onRestart}
      />
    </View>
  );
}

function Centered({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.centered}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Préparer mon pilulier' }}
      />
      <Text>{text}</Text>
      {children}
    </View>
  );
}
function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

const styles = StyleSheet.create({
  camera: { flex: 1 },
  cameraContainer: { flex: 1 },
  case: { color: colors.textMuted, marginTop: 5 },
  casesTitle: { fontWeight: '700', marginTop: 14 },
  card: {
    borderColor: colors.border,
    marginBottom: 16,
    padding: 14,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  finalCheck: { gap: 12, marginVertical: 12 },
  footerActions: { gap: 10 },
  day: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 8 },
  dayTitle: { fontSize: 16, fontWeight: '800' },
  stockOption: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    marginTop: 10,
    padding: 12,
  },
  stockOptionTitle: { fontWeight: '700' },
  guide: {
    borderColor: '#fff',
    borderWidth: 2,
    left: '10%',
    padding: 12,
    position: 'absolute',
    right: '10%',
    top: '35%',
  },
  guideText: {
    backgroundColor: '#0009',
    color: '#fff',
    padding: 6,
    textAlign: 'center',
  },
  intro: typography.body,
  name: typography.title,
  period: typography.heading,
  periodHeader: { gap: spacing.xs },
  periodDetail: { ...typography.caption, marginTop: spacing.sm },
  cancelArea: { gap: spacing.xs, marginTop: spacing.lg },
  weekOptions: { gap: spacing.sm },
  weekOption: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  weekOptionSelected: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  weekOptionTitle: typography.label,
  weekOptionPeriod: { fontSize: 17, fontWeight: '800' },
  progress: { marginBottom: 16, marginTop: 4 },
  success: { backgroundColor: colors.surface },
  successTitle: {
    color: colors.success,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 5,
  },
  total: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  verified: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 10,
    marginTop: 14,
    padding: 12,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 10,
    marginBottom: 16,
    padding: 12,
  },
  warningTitle: { color: colors.warning, fontWeight: '800' },
});
