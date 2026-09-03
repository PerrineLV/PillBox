import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView } from 'expo-camera';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useBarcodeScanner } from '@/components/scanning/use-barcode-scanner';
import { StockBoxChoice } from '@/components/preparations/stock-box-choice';
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
  AppCard,
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  EmptyState,
  INTAKE_SLOT_LABELS,
  Message,
  PillButton,
  Section,
  SeverityBadge,
  StackHeader,
  Tile,
  TileRow,
  colors,
  radii,
  typography,
  useToast,
} from '@/ui';
import { ScanHeader, Viewfinder } from '@/components/scanning/viewfinder';

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
  const scanner = useBarcodeScanner();
  const insets = useSafeAreaInsets();
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
    scanner.unlock();
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
    if (!scanner.lockOnce()) return;
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
      <AppScreen header={<StackHeader title="Compléter" />}>
        <EmptyState
          description="Cette case n’est plus en attente de complément, ou n’existe pas."
          title="Rien à compléter"
        />
      </AppScreen>
    );

  if (resolved || (pendingCase && pendingCase.pendingHalfUnits === 0)) {
    return (
      <AppScreen header={<StackHeader title="Compléter" />}>
        <Banner level="ok" title="Case complétée">
          Il ne reste plus aucune case en attente de complément pour ce
          médicament sur cette préparation.
        </Banner>
      </AppScreen>
    );
  }

  if (!pendingCase) return null;

  if (scanning) {
    if (scanner.permission === null)
      return <Centered text="Vérification de la caméra…" />;
    if (!scanner.permission.granted)
      return (
        <Centered text="La caméra est nécessaire pour vérifier la boîte.">
          <PillButton
            label="Autoriser la caméra"
            onPress={() => void scanner.requestPermission()}
          />
          <PillButton
            label="Annuler"
            onPress={() => setScanning(false)}
            tone="outline"
          />
        </Centered>
      );
    return (
      <View style={styles.cameraContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ height: insets.top }} />
        <ScanHeader
          onBack={() => setScanning(false)}
          title="Compléter la case"
        />
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={handleScan}
          style={styles.camera}
        >
          <Viewfinder caption="Scannez la boîte qui complète cette case" />
        </CameraView>
      </View>
    );
  }

  return (
    <AppScreen
      footer={
        !pending && !choosing ? (
          <View style={styles.footerActions}>
            <PillButton
              height={54}
              label="Scanner la boîte utilisée"
              onPress={beginScan}
              tone="accent"
            />
            <PillButton
              height={46}
              label="Choisir la boîte dans le stock"
              onPress={beginChoice}
              tone="outline"
            />
            <Text style={styles.stockNotice}>
              Le stock ne sera décrémenté qu’à la validation de ce complément.
            </Text>
          </View>
        ) : undefined
      }
      header={
        <StackHeader
          subtitle={pendingCase.specialtyName}
          title="Compléter une case"
        />
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <AppCard>
        <TileRow>
          <Tile
            label="Reste à couvrir"
            tone="tint"
            value={formatHalfUnits(pendingCase.pendingHalfUnits)}
          />
          <Tile
            label="Cases"
            tone="tint"
            value={String(pendingCase.pendingItems.length)}
          />
        </TileRow>
        {pendingCase.theoreticalRenewalDate ? (
          <Text style={typography.micro}>
            Renouvellement théorique (délivrance encadrée) :{' '}
            {formatLongFrenchCivilDate(pendingCase.theoreticalRenewalDate)}.
            Cette date est indicative et ne garantit pas une délivrance.
          </Text>
        ) : null}
      </AppCard>
      <Section
        aside={String(pendingCase.pendingItems.length)}
        label="Cases encore en attente"
      >
        <DenseList>
          {pendingCase.pendingItems.map((item, index) => (
            <DenseRow
              first={index === 0}
              key={`${item.date}-${item.slot}`}
              title={`${formatLongFrenchCivilDate(item.date)} · ${INTAKE_SLOT_LABELS[item.slot]}`}
            />
          ))}
        </DenseList>
      </Section>
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
    </AppScreen>
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
      <Text style={styles.verifiedTitle}>
        {isPartial
          ? 'Boîte insuffisante seule : contribution partielle'
          : `Boîte vérifiée · lot ${verification.box.lot ?? 'non renseigné'}`}
      </Text>
      <SeverityBadge
        label={
          scanned
            ? 'Vérifiée par scan DataMatrix'
            : 'Choisie dans le stock, sans scan'
        }
        level={scanned ? 'ok' : 'warning'}
      />
      <Text style={styles.verifiedBody}>
        {scanned
          ? 'Vérifiez le lot et la péremption imprimés sur la boîte que vous avez en main.'
          : 'Boîte choisie dans le stock : vérifiez le lot et la péremption sur la boîte que vous avez en main.'}{' '}
        Péremption {formatLongFrenchCivilDate(verification.box.expirationDate)}.
      </Text>
      {pending.matchedSpecialtyName ? (
        <SeverityBadge
          label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
          level="warning"
        />
      ) : null}
      <Text style={styles.verifiedBody}>
        Cette boîte couvre {formatHalfUnits(verification.quantityHalfUnits)}
        {isPartial
          ? ` ; il restera ${formatHalfUnits(verification.remainingAfterHalfUnits)} à couvrir ensuite.`
          : '.'}
      </Text>
      <PillButton
        disabled={saving}
        height={54}
        label="Compléter avec cette boîte"
        onPress={onConfirm}
        tone="accent"
      />
      <PillButton
        height={44}
        label={scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'}
        onPress={onRestart}
        tone="outline"
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
      <Text style={typography.detail}>{text}</Text>
      {children}
    </View>
  );
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

const styles = StyleSheet.create({
  camera: { flex: 1 },
  cameraContainer: { backgroundColor: colors.headerDark, flex: 1 },
  centered: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 20,
  },
  footerActions: { gap: 9 },
  stockNotice: { ...typography.micro, textAlign: 'center' },
  verified: {
    backgroundColor: colors.brandSoft,
    borderRadius: radii.card,
    gap: 9,
    padding: 14,
  },
  verifiedTitle: {
    color: colors.brandPressed,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  verifiedBody: {
    color: colors.brandPressed,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
  },
});
