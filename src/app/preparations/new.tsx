import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import {
  parseGs1Expiration,
  todayIso,
  type MedicationBox,
} from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import {
  generatePreparationSnapshot,
  matchScannedBox,
  preparationStartDate,
  verifyPreparationBox,
  type BoxVerification,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';
import {
  formatHalfUnits,
  type IntakeSlot,
} from '@/domain/treatments/treatment';
import { listMedicationBoxes } from '@/infrastructure/inventory/inventory-repository';
import {
  createPreparation,
  completePreparation,
  getLatestDraftPreparation,
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
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

const SLOT_LABELS: Record<IntakeSlot, string> = {
  morning: 'matin',
  noon: 'midi',
  evening: 'soir',
  bedtime: 'coucher',
};

type PendingScan = Readonly<{
  raw: string;
  verification: Extract<BoxVerification, { status: 'VALID' }>;
}>;

export default function NewPreparationScreen() {
  const database = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [snapshot, setSnapshot] = useState<PreparationSnapshot | null>(null);
  const [preparationId, setPreparationId] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<MedicationBox[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [finalConfirmationVisible, setFinalConfirmationVisible] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanLocked = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getLatestDraftPreparation(database),
      listMedicationBoxes(database),
    ])
      .then(([saved, inventory]) => {
        if (!active) return;
        setBoxes(inventory);
        if (saved) {
          setSnapshot(saved.snapshot);
          setPreparationId(saved.id);
          setCompleted(
            new Set(saved.progress.map((item) => item.specialtyCis)),
          );
        }
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
  }, [database]);

  const current = useMemo(
    () =>
      snapshot?.requirements.find(
        (item) => !completed.has(item.specialtyCis),
      ) ?? null,
    [completed, snapshot],
  );

  async function generate(): Promise<void> {
    if (loading || preparationId !== null) return;
    setLoading(true);
    setError(null);
    try {
      const referenceDate = todayIso();
      const treatments = await listTreatments(database);
      const generated = generatePreparationSnapshot(
        treatments,
        boxes,
        preparationStartDate(referenceDate),
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
  }

  function beginScan(): void {
    setError(null);
    setPending(null);
    scanLocked.current = false;
    setScanning(true);
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
      rejectScan(
        'Scan incomplet ou invalide : produit, lot et péremption sont requis.',
      );
      return;
    }
    const match = matchScannedBox(
      {
        presentationCip13: cip13,
        lot: parsed.fields.lot,
        serialNumber: parsed.fields.serialNumber ?? null,
        expirationDate,
      },
      boxes,
    );
    if (match.status !== 'MATCHED') {
      rejectScan(
        match.status === 'AMBIGUOUS'
          ? 'Plusieurs boîtes correspondent : impossible de savoir laquelle est utilisée.'
          : 'Cette boîte ne correspond exactement à aucune boîte du stock local.',
      );
      return;
    }
    const verification = verifyPreparationBox(
      current.specialtyCis,
      current.requiredHalfUnits,
      match.box,
      boxes,
      todayIso(),
    );
    if (verification.status === 'EXPIRED') {
      rejectScan(
        `Boîte périmée depuis le ${verification.box.expirationDate} : utilisation bloquée.`,
      );
    } else if (verification.status === 'WRONG_MEDICATION') {
      rejectScan(
        `Produit différent détecté : ${verification.box.specialtyName}. Scan refusé.`,
      );
    } else if (verification.status === 'INSUFFICIENT') {
      rejectScan(
        'Cette boîte ne contient pas assez de médicament pour ce traitement.',
      );
    } else {
      setScanning(false);
      setPending({ raw: result.data, verification });
    }
  }

  function rejectScan(reason: string): void {
    setScanning(false);
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
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Préparer mon pilulier' }}
      />
      <Text style={styles.intro}>
        Préparation sur 7 jours. La progression est sauvegardée après chaque
        médicament. Aucun stock n’est encore décrémenté.
      </Text>
      {preparationId === null ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void generate()}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>
            Générer la préparation de 7 jours
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Message tone="error" title="Action impossible">
          {error}
        </Message>
      ) : null}
      {snapshot ? (
        <>
          <Text style={styles.period}>
            Du {snapshot.startDate} au {snapshot.endDate}
          </Text>
          <Text style={styles.progress}>
            {completed.size} / {snapshot.requirements.length} médicaments
            préparés
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
      {current && !pending ? (
        <AppButton label="Scanner la boîte utilisée" onPress={beginScan} />
      ) : null}
      {pending && current ? (
        <ScanConfirmation
          pending={pending}
          saving={saving}
          onRescan={beginScan}
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
        <Message tone="success" title="Préparation validée">
          Le stock et les lots utilisés ont été enregistrés dans l’historique.
        </Message>
      ) : null}
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
    </ScrollView>
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
          <Text style={styles.dayTitle}>{date}</Text>
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
      <Text style={styles.total}>
        Quantité totale : {formatHalfUnits(requiredHalfUnits)}
      </Text>
      <Text style={styles.casesTitle}>Cases concernées</Text>
      {cases.map((item, index) => (
        <Text key={`${item.date}-${item.slot}-${index}`} style={styles.case}>
          • {item.date} · {SLOT_LABELS[item.slot]} :{' '}
          {formatHalfUnits(item.quantityHalfUnits)}
        </Text>
      ))}
    </Card>
  );
}

function ScanConfirmation({
  pending,
  saving,
  onRescan,
  onValidate,
}: {
  pending: PendingScan;
  saving: boolean;
  onRescan(): void;
  onValidate(acknowledgeNonFefo: boolean): Promise<void>;
}) {
  const { box, isFefo, recommendedBox } = pending.verification;
  return (
    <View style={isFefo ? styles.verified : styles.warning}>
      <Text style={styles.warningTitle}>
        {isFefo ? 'Boîte vérifiée' : 'Boîte valide, mais non FEFO'}
      </Text>
      <Text>
        Lot {box.lot} · péremption {box.expirationDate}
      </Text>
      {!isFefo ? (
        <Text>
          Lot recommandé : {recommendedBox.lot} · péremption{' '}
          {recommendedBox.expirationDate}. Vous pouvez continuer en confirmant
          cet avertissement.
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
        label="Scanner une autre boîte"
        variant="secondary"
        onPress={onRescan}
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
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  finalCheck: { gap: 12, marginVertical: 12 },
  day: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 8 },
  dayTitle: { fontSize: 16, fontWeight: '800' },
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
  period: { fontSize: 19, fontWeight: '800', marginTop: 18 },
  primary: {
    backgroundColor: '#0F6F70',
    borderRadius: 8,
    marginTop: 20,
    padding: 14,
  },
  primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
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
