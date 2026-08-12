import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import {
  parseGs1Expiration,
  todayIso,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import {
  effectiveUsableBoxes,
  evaluateBoxAvailability,
  listBoxesForMedication,
  matchScannedBox,
  verifyPreparationBox,
  type BoxVerification,
  type BoxVerificationMethod,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  completePendingItem,
  getPendingCompletionCases,
  type PendingCompletionCase,
} from '@/infrastructure/preparations/preparation-repository';
import { cancelPendingCompletionReminderFor } from '@/infrastructure/reminders/pending-completion-reminder-scheduler';
import { listGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  AppButton,
  Badge,
  Card,
  EmptyState,
  INTAKE_SLOT_LABELS,
  Message,
  Screen,
  SectionTitle,
  colors,
  radii,
  spacing,
  typography,
  useToast,
} from '@/ui';

type PendingBox = Readonly<{
  method: BoxVerificationMethod;
  raw: string | null;
  verification: Extract<BoxVerification, { status: 'VALID' | 'PARTIAL' }>;
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

/**
 * Complète une case « en attente de complément » (ticket 30b) sans reprendre
 * tout le flux de préparation. Contrairement à `preparations/new.tsx`, ne
 * propose la boîte que si elle correspond exactement au CIS attendu ou à une
 * équivalence générique déjà confirmée pour ce traitement : la confirmation
 * d'une nouvelle équivalence reste réservée au flux de préparation complet et
 * à la fiche du traitement, pour ne pas dupliquer ce parcours ici.
 */
export default function CompletePendingCaseScreen() {
  const { preparationId: preparationIdParameter, specialtyCis } =
    useLocalSearchParams<{ preparationId?: string; specialtyCis?: string }>();
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  const [pendingCase, setPendingCase] = useState<PendingCompletionCase | null>(
    null,
  );
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [confirmedEquivalenceCis, setConfirmedEquivalenceCis] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState<PendingBox | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preparationId = Number(preparationIdParameter);
  const validCis = typeof specialtyCis === 'string' ? specialtyCis : null;

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(preparationId) || validCis === null) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    try {
      const [cases, inventory] = await Promise.all([
        getPendingCompletionCases(database),
        listMedicationBoxes(database),
      ]);
      const found =
        cases.find(
          (item) =>
            item.preparationId === preparationId &&
            item.specialtyCis === validCis,
        ) ?? null;
      setPendingCase(found);
      setNotFound(found === null);
      setBoxes(inventory);
      if (found) {
        const confirmations = await listGenericEquivalenceConfirmations(
          database,
          found.treatmentId,
        );
        setConfirmedEquivalenceCis(
          new Map(confirmations.map((item) => [item.cis, item.specialtyName])),
        );
      }
    } catch (reason: unknown) {
      setError(message(reason, 'Chargement impossible.'));
    } finally {
      setLoading(false);
    }
  }, [database, preparationId, validCis]);

  useEffect(() => {
    void load();
  }, [load]);

  const effectiveBoxes = effectiveUsableBoxes(boxes, []);

  function beginScan(): void {
    setError(null);
    setPending(null);
    setChoosing(false);
    setScanning(true);
  }

  function beginChoice(): void {
    setError(null);
    setPending(null);
    setChoosing(true);
  }

  function rejectBox(reason: string, method: BoxVerificationMethod): void {
    setScanning(false);
    setChoosing(method === 'MANUAL');
    setError(reason);
  }

  function verifyBox(
    box: MedicationBox,
    method: BoxVerificationMethod,
    raw: string | null,
  ): void {
    if (!pendingCase) return;
    if (box.specialtyCis === pendingCase.specialtyCis) {
      runVerification(box, method, raw, null);
      return;
    }
    const matchedSpecialtyName = confirmedEquivalenceCis.get(box.specialtyCis);
    if (matchedSpecialtyName === undefined) {
      rejectBox(
        `Produit différent détecté : ${box.specialtyName}. Boîte refusée. ` +
          'Une équivalence générique doit être confirmée depuis la fiche du ' +
          'traitement ou pendant une préparation avant de pouvoir être ' +
          'utilisée ici.',
        method,
      );
      return;
    }
    runVerification(box, method, raw, box.specialtyCis);
  }

  function runVerification(
    box: MedicationBox,
    method: BoxVerificationMethod,
    raw: string | null,
    matchedCis: string | null,
  ): void {
    if (!pendingCase) return;
    const verification = verifyPreparationBox(
      pendingCase.specialtyCis,
      pendingCase.pendingHalfUnits,
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
        'Cette boîte ne contient plus aucune quantité utilisable pour ce médicament. Choisissez une autre boîte.',
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

  function handleScan(result: BarcodeScanningResult): void {
    if (!pendingCase) return;
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
      { presentationCip13: cip13, lot: parsed.fields.lot, expirationDate },
      effectiveBoxes,
    );
    if (match.status !== 'MATCHED') {
      rejectBox(
        'Cette boîte ne correspond exactement à aucune boîte du stock local.',
        'SCAN',
      );
      return;
    }
    verifyBox(match.box, 'SCAN', result.data);
  }

  async function confirmContribution(): Promise<void> {
    if (!pending || !pendingCase || saving) return;
    setSaving(true);
    setError(null);
    try {
      const isFullyResolved = await completePendingItem(
        database,
        preparationId,
        pendingCase.specialtyCis,
        {
          boxId: pending.verification.box.id,
          quantityHalfUnits: pending.verification.quantityHalfUnits,
          verification: pending.method,
          scanRaw: pending.raw,
          matchedCis: pending.matchedCis,
          matchedSpecialtyName: pending.matchedSpecialtyName,
        },
        todayIso(),
      );
      if (isFullyResolved) {
        await cancelPendingCompletionReminderFor(
          database,
          preparationId,
          pendingCase.specialtyCis,
        );
        setResolved(true);
        showToast(
          'Case complétée : plus rien en attente pour ce médicament.',
          'success',
        );
      } else {
        showToast('Complément enregistré.', 'success');
      }
      setPending(null);
      await load();
    } catch (reason: unknown) {
      setError(message(reason, 'Complément impossible.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Centered text="Chargement…" />;
  if (notFound)
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Compléter' }} />
        <EmptyState
          title="Rien à compléter"
          description="Cette case n’est plus en attente de complément, ou n’existe pas."
        />
      </Screen>
    );

  if (resolved || (pendingCase && pendingCase.pendingHalfUnits === 0)) {
    return (
      <Screen>
        <Stack.Screen options={{ headerShown: true, title: 'Compléter' }} />
        <Message tone="success" title="Case complétée">
          Il ne reste plus aucune case en attente de complément pour ce
          médicament sur cette préparation.
        </Message>
      </Screen>
    );
  }

  if (!pendingCase) return null;

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
        </Centered>
      );
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={handleScan}
          style={StyleSheet.absoluteFillObject}
        />
        <AppButton
          label="Annuler"
          variant="secondary"
          onPress={() => setScanning(false)}
        />
      </View>
    );
  }

  return (
    <Screen
      stickyFooter={
        !pending && !choosing ? (
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
      <Stack.Screen options={{ headerShown: true, title: 'Compléter' }} />
      <SectionTitle>{pendingCase.specialtyName}</SectionTitle>
      {pendingCase.theoreticalRenewalDate ? (
        <Text style={typography.caption}>
          Renouvellement théorique (délivrance encadrée) :{' '}
          {formatLongFrenchCivilDate(pendingCase.theoreticalRenewalDate)}
        </Text>
      ) : null}
      <Text style={typography.body}>
        Reste à couvrir : {formatHalfUnits(pendingCase.pendingHalfUnits)}
      </Text>
      <Text style={styles.casesTitle}>Cases encore en attente</Text>
      {pendingCase.pendingItems.map((item) => (
        <Text key={`${item.date}-${item.slot}`} style={typography.caption}>
          • {formatLongFrenchCivilDate(item.date)} ·{' '}
          {INTAKE_SLOT_LABELS[item.slot]}
        </Text>
      ))}
      {error ? (
        <Message tone="error" title="Action impossible">
          {error}
        </Message>
      ) : null}
      {choosing && !pending ? (
        <StockBoxChoice
          boxes={listBoxesForMedication(
            pendingCase.specialtyCis,
            pendingCase.pendingHalfUnits,
            effectiveBoxes,
            todayIso(),
            [...confirmedEquivalenceCis.keys()],
          )}
          expectedSpecialtyCis={pendingCase.specialtyCis}
          requiredHalfUnits={pendingCase.pendingHalfUnits}
          onCancel={() => setChoosing(false)}
          onSelect={(box) => verifyBox(box, 'MANUAL', null)}
        />
      ) : null}
      {pending ? (
        <BoxConfirmation
          pending={pending}
          saving={saving}
          onRestart={pending.method === 'SCAN' ? beginScan : beginChoice}
          onConfirm={() => void confirmContribution()}
        />
      ) : null}
    </Screen>
  );
}

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
      {boxes.length === 0 ? (
        <Text>
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
            {box.specialtyCis !== expectedSpecialtyCis ? (
              <Badge
                label={`Équivalence générique déjà confirmée : ${box.specialtyName}`}
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
  onConfirm,
}: {
  pending: PendingBox;
  saving: boolean;
  onRestart(): void;
  onConfirm(): void;
}) {
  const { verification } = pending;
  const scanned = pending.method === 'SCAN';
  const isPartial = verification.status === 'PARTIAL';
  return (
    <View style={styles.verified}>
      <Text style={styles.warningTitle}>
        {isPartial
          ? 'Boîte insuffisante seule : contribution partielle'
          : 'Boîte vérifiée'}
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
        Lot {verification.box.lot ?? 'non renseigné'} · péremption{' '}
        {formatLongFrenchCivilDate(verification.box.expirationDate)}
      </Text>
      {pending.matchedSpecialtyName ? (
        <Badge
          label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
          tone="warning"
        />
      ) : null}
      <Text>
        Cette boîte couvre {formatHalfUnits(verification.quantityHalfUnits)}
        {isPartial
          ? ` ; il restera ${formatHalfUnits(verification.remainingAfterHalfUnits)} à couvrir ensuite.`
          : '.'}
      </Text>
      <AppButton
        loading={saving}
        label="Compléter avec cette boîte"
        onPress={onConfirm}
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
      <Text>{text}</Text>
      {children}
    </View>
  );
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1, gap: spacing.sm, padding: spacing.md },
  card: { gap: spacing.sm },
  casesTitle: { fontWeight: '700', marginTop: spacing.sm },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  footerActions: { gap: spacing.sm },
  stockOption: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  stockOptionTitle: { fontWeight: '700' },
  verified: {
    backgroundColor: colors.brandSoft,
    borderRadius: radii.lg,
    gap: spacing.sm,
    padding: spacing.md,
  },
  warningTitle: { fontWeight: '700' },
});
