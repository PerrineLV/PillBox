import medicationReferenceAsset from '../../../assets/medications/medications.db';
import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GenericMatchConfirmation } from '@/components/medications/generic-match-confirmation';
import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import {
  formatFrenchCivilPeriod,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import {
  parseGs1Expiration,
  todayIso,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import {
  effectiveUsableBoxes,
  evaluateBoxAvailability,
  generatePreparationSnapshot,
  listBoxesForMedication,
  matchScannedBox,
  preparationWeeks,
  preparationWeekState,
  remainingHalfUnitsFor,
  verifyPreparationBox,
  type BoxVerification,
  type BoxVerificationMethod,
  type KnownPreparation,
  type MedicationRequirement,
  type PreparationSnapshot,
  type PreparationWeek,
  type PreparationWeekChoice,
  type PreparationWeekState,
} from '@/domain/preparations/preparation';
import {
  formatHalfUnits,
  type IntakeSlot,
  type Treatment,
} from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  getGenericGroupMembers,
  type GenericGroupMember,
} from '@/infrastructure/medications/medication-reference';
import {
  cancelPreparation,
  createPreparation,
  completePreparation,
  getLatestDraftPreparation,
  listPreparationWeeks,
  savePreparationProgress,
  type SavedPreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';
import { schedulePendingCompletionReminderFor } from '@/infrastructure/reminders/pending-completion-reminder-scheduler';
import {
  confirmGenericEquivalence,
  isGenericEquivalenceConfirmed,
  listAllGenericEquivalenceConfirmations,
} from '@/infrastructure/treatments/generic-equivalence-repository';
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
  verification: Extract<BoxVerification, { status: 'VALID' | 'PARTIAL' }>;
  /** Renseigné lorsque la boîte est un autre membre du groupe générique attendu, confirmé. */
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

/** Boîte en attente d'une confirmation explicite de correspondance générique. */
type PendingGenericMatch = Readonly<{
  box: MedicationBox;
  method: BoxVerificationMethod;
  raw: string | null;
  treatmentId: number;
  groupLabel: string;
}>;

/**
 * Médicament en cours de vérification : le besoin restant tient compte des
 * boîtes déjà retenues dans cette préparation, lorsque la première s'est
 * terminée avant de couvrir toute la semaine.
 */
type CurrentRequirement = MedicationRequirement & {
  remainingHalfUnits: number;
  contributions: readonly SavedPreparationProgress[];
};

/**
 * Ouvre une seconde connexion, vers le référentiel médicaments en lecture
 * seule (`medication-reference.db`, distinct de `pillbox.db`), nécessaire
 * pour reconnaître un autre membre du même groupe générique officiel (BDPM)
 * lors de la vérification d'une boîte.
 */
export default function NewPreparationScreen() {
  const personalDatabase = useSQLiteContext();
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <NewPreparationScreenContent personalDatabase={personalDatabase} />
    </SQLiteProvider>
  );
}

function NewPreparationScreenContent({
  personalDatabase,
}: {
  personalDatabase: SQLiteDatabase;
}) {
  const referenceDatabase = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [snapshot, setSnapshot] = useState<PreparationSnapshot | null>(null);
  const [preparationId, setPreparationId] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [weeks, setWeeks] = useState<KnownPreparation[]>([]);
  const [choice, setChoice] = useState<PreparationWeekChoice>('CURRENT');
  const [progress, setProgress] = useState<SavedPreparationProgress[]>([]);
  const [pending, setPending] = useState<PendingBox | null>(null);
  const [scanning, setScanning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalized, setFinalized] = useState(false);
  /**
   * CIS explicitement laissés sans couverture complète pour un traitement à
   * délivrance encadrée (ticket 30b) : transitoire, comme `pending`/`choosing`
   * ci-dessus. Non persisté — une reprise après fermeture de l'application
   * redemande la décision, sans perte de progression réelle.
   */
  const [skippedCis, setSkippedCis] = useState<ReadonlySet<string>>(new Set());
  const [pendingAfterValidation, setPendingAfterValidation] = useState<
    readonly string[]
  >([]);
  const [finalConfirmationVisible, setFinalConfirmationVisible] =
    useState(false);
  const [cancelConfirmationVisible, setCancelConfirmationVisible] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genericCandidates, setGenericCandidates] = useState<
    readonly GenericGroupMember[]
  >([]);
  const [pendingGenericMatch, setPendingGenericMatch] =
    useState<PendingGenericMatch | null>(null);
  const [confirmingGenericMatch, setConfirmingGenericMatch] = useState(false);
  const scanLocked = useRef(false);
  const options = useMemo(() => preparationWeeks(todayIso()), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      getLatestDraftPreparation(personalDatabase),
      listMedicationBoxes(personalDatabase),
      listPreparationWeeks(personalDatabase),
      listTreatments(personalDatabase),
    ])
      .then(([saved, inventory, knownWeeks, allTreatments]) => {
        if (!active) return;
        setBoxes(inventory);
        setWeeks(knownWeeks);
        setTreatments(allTreatments);
        if (saved) {
          setSnapshot(saved.snapshot);
          setPreparationId(saved.id);
          setProgress([...saved.progress]);
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
  }, [personalDatabase, options]);

  /**
   * CIS des traitements dont l'indicateur de délivrance encadrée est actif
   * (ticket 30) : seuls eux peuvent être laissés en attente de complément
   * (ticket 30b), jamais un traitement sans ce dispositif.
   */
  const controlledDispensingActiveCis = useMemo(
    () =>
      new Set(
        treatments
          .filter((treatment) => treatment.controlledDispensing?.enabled)
          .map((treatment) => treatment.specialtyCis),
      ),
    [treatments],
  );

  const current = useMemo<CurrentRequirement | null>(() => {
    if (!snapshot) return null;
    for (const requirement of snapshot.requirements) {
      if (skippedCis.has(requirement.specialtyCis)) continue;
      const contributions = progress.filter(
        (item) => item.specialtyCis === requirement.specialtyCis,
      );
      const remainingHalfUnits = remainingHalfUnitsFor(
        requirement.requiredHalfUnits,
        contributions,
      );
      if (remainingHalfUnits > 0) {
        return { ...requirement, remainingHalfUnits, contributions };
      }
    }
    return null;
  }, [progress, snapshot, skippedCis]);

  /**
   * Laisse le médicament courant sans couverture complète, réservé aux
   * traitements à délivrance encadrée active : la case concernée passera à
   * l'état « en attente de complément » à la validation finale (ticket 30b).
   * Transitoire (voir `skippedCis`) : jamais persisté avant la validation.
   */
  function skipCurrentMedication(): void {
    if (!current || !controlledDispensingActiveCis.has(current.specialtyCis))
      return;
    setSkippedCis((previous) => new Set([...previous, current.specialtyCis]));
  }

  const currentSpecialtyCis = current?.specialtyCis ?? null;
  useEffect(() => {
    let active = true;
    if (currentSpecialtyCis === null) {
      setGenericCandidates([]);
      return;
    }
    getGenericGroupMembers(referenceDatabase, currentSpecialtyCis)
      .then((members) => {
        if (active) setGenericCandidates(members);
      })
      .catch(() => {
        // Purement informatif : si le référentiel des groupes génériques est
        // indisponible, la vérification se comporte comme avant ce ticket
        // (CIS différent toujours refusé), sans bloquer la préparation.
        if (active) setGenericCandidates([]);
      });
    return () => {
      active = false;
    };
  }, [referenceDatabase, currentSpecialtyCis]);

  const genericCandidatesByCis = useMemo(
    () => new Map(genericCandidates.map((member) => [member.cis, member])),
    [genericCandidates],
  );

  /** Traitement à l'origine du besoin pour ce CIS, pour mémoriser une équivalence à son nom. */
  function treatmentIdForSpecialty(specialtyCis: string): number | null {
    return (
      snapshot?.items.find((item) => item.specialtyCis === specialtyCis)
        ?.treatmentId ?? null
    );
  }

  /**
   * Vue du stock où chaque boîte déjà retenue par cette préparation (en tout
   * ou en partie) voit sa quantité restante réduite d'autant : le stock en
   * base n'est décrémenté qu'à la validation finale, mais une même boîte ne
   * doit jamais paraître disponible deux fois au sein d'une même préparation.
   */
  const effectiveBoxes = useMemo(
    () => effectiveUsableBoxes(boxes, progress),
    [boxes, progress],
  );

  const completedRequirementsCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.requirements.filter(
      (requirement) =>
        skippedCis.has(requirement.specialtyCis) ||
        remainingHalfUnitsFor(
          requirement.requiredHalfUnits,
          progress.filter(
            (item) => item.specialtyCis === requirement.specialtyCis,
          ),
        ) === 0,
    ).length;
  }, [progress, snapshot, skippedCis]);

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
      const currentTreatments = await listTreatments(personalDatabase);
      const equivalenceConfirmations =
        await listAllGenericEquivalenceConfirmations(personalDatabase);
      const generated = generatePreparationSnapshot(
        currentTreatments,
        boxes,
        selectedWeek.startDate,
        referenceDate,
        equivalenceConfirmations.map((confirmation) => ({
          treatmentId: confirmation.treatmentId,
          cis: confirmation.cis,
        })),
      );
      const id = await createPreparation(personalDatabase, generated);
      setTreatments(currentTreatments);
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
      setWeeks(await listPreparationWeeks(personalDatabase));
    } catch {
      // Les semaines déjà chargées restent affichées.
    }
  }

  /** Ramène l'écran au choix de la semaine sans toucher au stock. */
  function resetToWeekChoice(): void {
    setSnapshot(null);
    setPreparationId(null);
    setProgress([]);
    setPending(null);
    setChoosing(false);
    setScanning(false);
    setFinalized(false);
    setSkippedCis(new Set());
    setPendingAfterValidation([]);
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
    if (progress.length > 0 || pending !== null) {
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
      await cancelPreparation(personalDatabase, preparationId);
      setCancelConfirmationVisible(false);
      resetToWeekChoice();
      const known = await listPreparationWeeks(personalDatabase);
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
      const known = await listPreparationWeeks(personalDatabase);
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
   * que soit la manière dont la boîte a été désignée. Un CIS différent de
   * celui attendu n'est jamais accepté silencieusement : s'il appartient au
   * même groupe générique officiel (BDPM), une confirmation explicite est
   * exigée la première fois, puis mémorisée pour ce couple (traitement, CIS).
   */
  async function verifyBox(
    box: MedicationBox,
    method: BoxVerificationMethod,
    raw: string | null,
  ): Promise<void> {
    if (current === null) return;
    if (box.specialtyCis === current.specialtyCis) {
      runVerification(box, method, raw, null);
      return;
    }
    const candidate = genericCandidatesByCis.get(box.specialtyCis);
    if (candidate === undefined) {
      rejectBox(
        `Produit différent détecté : ${box.specialtyName}. Boîte refusée.`,
        method,
      );
      return;
    }
    const treatmentId = treatmentIdForSpecialty(current.specialtyCis);
    if (treatmentId === null) {
      // Ne devrait jamais arriver : chaque besoin provient d'au moins une
      // ligne de préparation_items rattachée à un traitement.
      rejectBox(
        `Produit différent détecté : ${box.specialtyName}. Boîte refusée.`,
        method,
      );
      return;
    }
    try {
      const alreadyConfirmed = await isGenericEquivalenceConfirmed(
        personalDatabase,
        treatmentId,
        box.specialtyCis,
      );
      if (alreadyConfirmed) {
        runVerification(box, method, raw, box.specialtyCis);
        return;
      }
      setScanning(false);
      setChoosing(false);
      setPendingGenericMatch({
        box,
        method,
        raw,
        treatmentId,
        groupLabel: candidate.groupLabel,
      });
    } catch (reason: unknown) {
      setError(
        message(reason, 'Vérification de la correspondance impossible.'),
      );
    }
  }

  function runVerification(
    box: MedicationBox,
    method: BoxVerificationMethod,
    raw: string | null,
    matchedCis: string | null,
  ): void {
    if (current === null) return;
    const verification = verifyPreparationBox(
      current.specialtyCis,
      current.remainingHalfUnits,
      box,
      effectiveBoxes,
      todayIso(),
      matchedCis,
    );
    if (verification.status === 'EXPIRED') {
      rejectBox(
        `Boîte périmée depuis le ${formatLongFrenchCivilDate(verification.box.expirationDate)} : utilisation bloquée.`,
        method,
      );
    } else if (verification.status === 'WRONG_MEDICATION') {
      rejectBox(
        `Produit différent détecté : ${verification.box.specialtyName}. Boîte refusée.`,
        method,
      );
    } else if (verification.status === 'INSUFFICIENT') {
      rejectBox(
        'Cette boîte ne contient plus aucune quantité utilisable pour ce traitement. Choisissez une autre boîte.',
        method,
      );
    } else {
      setScanning(false);
      setChoosing(false);
      setPending({
        method,
        raw,
        verification,
        matchedCis,
        matchedSpecialtyName: matchedCis !== null ? box.specialtyName : null,
      });
    }
  }

  async function confirmGenericMatch(): Promise<void> {
    if (!pendingGenericMatch) return;
    setConfirmingGenericMatch(true);
    setError(null);
    try {
      await confirmGenericEquivalence(personalDatabase, {
        treatmentId: pendingGenericMatch.treatmentId,
        cis: pendingGenericMatch.box.specialtyCis,
        specialtyName: pendingGenericMatch.box.specialtyName,
        groupLabel: pendingGenericMatch.groupLabel,
      });
      const { box, method, raw } = pendingGenericMatch;
      setPendingGenericMatch(null);
      runVerification(box, method, raw, box.specialtyCis);
    } catch (reason: unknown) {
      setError(message(reason, 'Confirmation impossible.'));
    } finally {
      setConfirmingGenericMatch(false);
    }
  }

  function cancelGenericMatch(): void {
    if (!pendingGenericMatch) return;
    setPendingGenericMatch(null);
    rejectBox(
      `Produit différent détecté : ${pendingGenericMatch.box.specialtyName}. Boîte refusée.`,
      pendingGenericMatch.method,
    );
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
        'SCAN',
      );
      return;
    }
    const match = matchScannedBox(
      {
        presentationCip13: cip13,
        lot: parsed.fields.lot,
        expirationDate,
      },
      effectiveBoxes,
    );
    if (match.status !== 'MATCHED') {
      rejectBox(
        'Cette boîte ne correspond exactement à aucune boîte du stock local.',
        'SCAN',
      );
      return;
    }
    void verifyBox(match.box, 'SCAN', result.data);
  }

  /**
   * Une boîte refusée depuis la liste du stock y reste affichée : passer à
   * une seconde boîte se fait alors en un seul geste, sans devoir rouvrir la
   * liste. Un scan refusé referme la caméra, qui doit être relancée.
   */
  function rejectBox(reason: string, method: BoxVerificationMethod): void {
    setScanning(false);
    setChoosing(method === 'MANUAL');
    setError(reason);
  }

  async function validateMedication(
    acknowledgeNonFefo: boolean,
  ): Promise<void> {
    if (!pending || !current || preparationId === null || saving) return;
    const { verification } = pending;
    if (
      verification.status === 'VALID' &&
      !verification.isFefo &&
      !acknowledgeNonFefo
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const entry: SavedPreparationProgress = {
        specialtyCis: current.specialtyCis,
        boxId: verification.box.id,
        quantityHalfUnits: verification.quantityHalfUnits,
        verification: pending.method,
        scanRaw: pending.raw,
        nonFefoAcknowledged:
          verification.status === 'VALID' ? acknowledgeNonFefo : false,
        matchedCis: pending.matchedCis,
        matchedSpecialtyName: pending.matchedSpecialtyName,
      };
      await savePreparationProgress(personalDatabase, preparationId, entry);
      setProgress((previous) => [...previous, entry]);
      setPending(null);
      // Une contribution partielle laisse le médicament ouvert : les boutons
      // scanner/choisir réapparaissent pour couvrir le reste, sans imposer la
      // liste manuelle alors qu'un second scan suffit le plus souvent.
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
      const referenceDate = todayIso();
      const pendingSpecialtyCis = await completePreparation(
        personalDatabase,
        preparationId,
        referenceDate,
      );
      // Un rappel dédié par médicament laissé en attente (ticket 30b),
      // distinct du rappel hebdomadaire de préparation et des rappels
      // quotidiens de prise : jamais fondu avec eux.
      for (const specialtyCis of pendingSpecialtyCis) {
        const treatment = treatments.find(
          (item) =>
            item.specialtyCis === specialtyCis &&
            item.controlledDispensing?.enabled,
        );
        await schedulePendingCompletionReminderFor(
          personalDatabase,
          preparationId,
          specialtyCis,
          treatment?.controlledDispensing?.theoreticalRenewalDate ?? null,
          referenceDate,
        );
      }
      setPendingAfterValidation(pendingSpecialtyCis);
      setFinalized(true);
      setFinalConfirmationVisible(false);
      setBoxes(await listMedicationBoxes(personalDatabase));
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
            {controlledDispensingActiveCis.has(current.specialtyCis) ? (
              <AppButton
                label="Aucun stock disponible : laisser en attente de complément"
                variant="quiet"
                onPress={skipCurrentMedication}
                accessibilityHint="Passe au médicament suivant sans couverture complète ; réservé aux traitements à délivrance encadrée"
              />
            ) : null}
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
            {completedRequirementsCount + (current ? 1 : 0)} sur{' '}
            {snapshot.requirements.length}
          </Text>
          <Text style={typography.caption}>
            {completedRequirementsCount} médicament
            {completedRequirementsCount > 1 ? 's' : ''} déjà vérifié
            {completedRequirementsCount > 1 ? 's' : ''}
          </Text>
          {progress.length > 0 && current ? (
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
          besoin, sauf pour un traitement à délivrance encadrée (stupéfiants et
          assimilés) explicitement laissé en attente de complément.
        </Message>
      ) : null}
      {snapshot && snapshot.requirements.length === 0 ? (
        <Text>Aucune prise prévue pour cette période.</Text>
      ) : null}
      {current ? (
        <MedicationStep snapshot={snapshot!} current={current} boxes={boxes} />
      ) : null}
      {choosing && current && !pending ? (
        <StockBoxChoice
          boxes={listBoxesForMedication(
            current.specialtyCis,
            current.remainingHalfUnits,
            effectiveBoxes,
            todayIso(),
            [...genericCandidatesByCis.keys()],
          )}
          expectedSpecialtyCis={current.specialtyCis}
          requiredHalfUnits={current.remainingHalfUnits}
          onCancel={() => setChoosing(false)}
          onSelect={(box) => void verifyBox(box, 'MANUAL', null)}
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
      {pendingGenericMatch && current ? (
        <GenericMatchConfirmation
          visible
          expectedSpecialtyName={current.specialtyName}
          scannedSpecialtyName={pendingGenericMatch.box.specialtyName}
          groupLabel={pendingGenericMatch.groupLabel}
          busy={confirmingGenericMatch}
          onCancel={cancelGenericMatch}
          onConfirm={() => void confirmGenericMatch()}
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
          <Text style={styles.casesTitle}>Lots retenus pour cette semaine</Text>
          <UsageSummary snapshot={snapshot} progress={progress} boxes={boxes} />
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
          {pendingAfterValidation.length > 0 ? (
            <Message tone="warning" title="Cases en attente de complément">
              {pendingAfterValidation.length} médicament
              {pendingAfterValidation.length > 1 ? 's' : ''} à délivrance
              encadrée n’ont pas pu être entièrement couvert
              {pendingAfterValidation.length > 1 ? 's' : ''}. Complétez-les dès
              que du stock est disponible, depuis l’historique. Un rappel dédié
              vous préviendra.
            </Message>
          ) : null}
          <AppButton
            label="Voir l’historique"
            variant="secondary"
            onPress={() => router.push('/preparations/history')}
          />
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
          {(() => {
            const touched = new Set(progress.map((item) => item.specialtyCis))
              .size;
            if (touched === 0)
              return 'La boîte désignée mais pas encore validée sera oubliée.';
            return touched > 1
              ? `Les ${touched} médicaments déjà touchés seront oubliés.`
              : 'Le médicament déjà touché sera oublié.';
          })()}{' '}
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
  current,
  boxes,
}: {
  snapshot: PreparationSnapshot;
  current: CurrentRequirement;
  boxes: readonly MedicationBox[];
}) {
  const cases = snapshot.items.filter(
    (item) => item.specialtyCis === current.specialtyCis,
  );
  return (
    <Card style={styles.card}>
      <Text style={styles.name}>{current.specialtyName}</Text>
      {cases[0]?.pharmaceuticalForm ? (
        <Text style={typography.body}>{cases[0].pharmaceuticalForm}</Text>
      ) : null}
      <Text style={styles.total}>
        Quantité totale : {formatHalfUnits(current.requiredHalfUnits)}
      </Text>
      {current.contributions.length > 0 ? (
        <Message
          tone="warning"
          title="Boîte précédente épuisée : reste à couvrir"
        >
          {current.contributions.map((contribution) => {
            const box = boxes.find((item) => item.id === contribution.boxId);
            return (
              <Text key={contribution.boxId} style={styles.case}>
                • Lot {box?.lot ?? 'non renseigné'} :{' '}
                {formatHalfUnits(contribution.quantityHalfUnits)} déjà attribués
              </Text>
            );
          })}
          <Text style={styles.case}>
            Reste à couvrir avec une seconde boîte :{' '}
            {formatHalfUnits(current.remainingHalfUnits)}
          </Text>
        </Message>
      ) : null}
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
 * Récapitulatif des lots réellement retenus pour chaque médicament, affiché
 * juste avant la validation finale : lorsque plusieurs boîtes couvrent un
 * même médicament, les deux doivent être visibles avant la décrémentation.
 */
function UsageSummary({
  snapshot,
  progress,
  boxes,
}: {
  snapshot: PreparationSnapshot;
  progress: readonly SavedPreparationProgress[];
  boxes: readonly MedicationBox[];
}) {
  return (
    <View style={styles.finalCheck}>
      {snapshot.requirements.map((requirement) => {
        const contributions = progress.filter(
          (item) => item.specialtyCis === requirement.specialtyCis,
        );
        return (
          <View key={requirement.specialtyCis} style={styles.day}>
            <Text style={styles.dayTitle}>{requirement.specialtyName}</Text>
            {contributions.map((contribution) => {
              const box = boxes.find((item) => item.id === contribution.boxId);
              return (
                <Text key={contribution.boxId} style={styles.case}>
                  • Lot {box?.lot ?? 'non renseigné'} · péremption{' '}
                  {box ? formatLongFrenchCivilDate(box.expirationDate) : '—'} ·{' '}
                  {formatHalfUnits(contribution.quantityHalfUnits)} ·{' '}
                  {contribution.verification === 'SCAN'
                    ? 'vérifiée par scan'
                    : 'choisie sans scan'}
                </Text>
              );
            })}
            {contributions.length === 0 ? (
              <Text style={styles.case}>Aucune boîte retenue</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Boîtes déjà enregistrées pour ce médicament, du lot à utiliser en priorité
 * vers les boîtes inutilisables. Rien n'est masqué silencieusement : une
 * quantité insuffisante est signalée avant même la sélection, pour permettre
 * de choisir directement une seconde boîte lorsque la première est presque
 * terminée plutôt que de découvrir le problème après validation.
 */
function StockBoxChoice({
  boxes,
  expectedSpecialtyCis,
  requiredHalfUnits,
  onCancel,
  onSelect,
}: {
  boxes: readonly MedicationBox[];
  expectedSpecialtyCis: string;
  requiredHalfUnits: number;
  onCancel(): void;
  onSelect(box: MedicationBox): void;
}) {
  const today = todayIso();
  return (
    <Card style={styles.card}>
      <Text style={styles.casesTitle}>Boîtes enregistrées dans le stock</Text>
      <Text style={typography.caption}>
        Aucune lecture de DataMatrix ne sera enregistrée : les contrôles de
        médicament, de lot et de péremption restent appliqués. Un autre membre
        du même groupe générique officiel exige une confirmation explicite.
      </Text>
      {boxes.length === 0 ? (
        <Text style={styles.case}>
          Aucune boîte de ce médicament n’est enregistrée dans le stock.
        </Text>
      ) : null}
      {boxes.map((box) => {
        const availability = evaluateBoxAvailability(
          box,
          requiredHalfUnits,
          today,
        );
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
            {availability === 'EXPIRED' ? (
              <Badge label="Périmée" tone="danger" />
            ) : null}
            {availability === 'INSUFFICIENT' ? (
              <Badge label="Quantité insuffisante seule" tone="warning" />
            ) : null}
            {box.origin === 'MANUAL' ? (
              <Badge label="Ajoutée sans DataMatrix" />
            ) : null}
            {box.specialtyCis !== expectedSpecialtyCis ? (
              <Badge
                label={`Autre spécialité du même groupe générique : ${box.specialtyName}`}
                tone="warning"
              />
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
  const { verification } = pending;
  const scanned = pending.method === 'SCAN';

  if (verification.status === 'PARTIAL') {
    const { box, quantityHalfUnits, remainingAfterHalfUnits } = verification;
    return (
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>
          Boîte insuffisante seule : contribution partielle
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
        {pending.matchedSpecialtyName ? (
          <Badge
            label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
            tone="warning"
          />
        ) : null}
        <Text>
          Cette boîte couvre {formatHalfUnits(quantityHalfUnits)}. Il restera{' '}
          {formatHalfUnits(remainingAfterHalfUnits)} à couvrir avec une seconde
          boîte.
        </Text>
        <AppButton
          loading={saving}
          label="Utiliser cette boîte entièrement"
          onPress={() => void onValidate(false)}
        />
        <AppButton
          label={
            scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'
          }
          variant="secondary"
          onPress={onRestart}
        />
      </View>
    );
  }

  const { box, isFefo, recommendedBox } = verification;
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
      {pending.matchedSpecialtyName ? (
        <Badge
          label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
          tone="warning"
        />
      ) : null}
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
