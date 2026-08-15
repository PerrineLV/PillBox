import medicationReferenceAsset from '../../../assets/medications/medications.db';
import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView } from 'expo-camera';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  SQLiteProvider,
  type SQLiteDatabase,
  useSQLiteContext,
} from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DuplicateLotConfirmation } from '@/components/inventory/duplicate-lot-confirmation';
import { ExpirationField } from '@/components/inventory/expiration-field';
import { useDuplicateLotGate } from '@/components/inventory/use-duplicate-lot-gate';
import { GenericMatchConfirmation } from '@/components/medications/generic-match-confirmation';
import { useDraftGenericEquivalencePrompt } from '@/components/medications/use-draft-generic-equivalence-prompt';
import { useGenericEquivalenceGate } from '@/components/medications/use-generic-equivalence-gate';
import { useBarcodeScanner } from '@/components/scanning/use-barcode-scanner';
import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import { buildAttachedSpecialtyCisSet } from '@/domain/inventory/box-attachment';
import { parseGs1Expiration } from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import { addMedicationBox } from '@/infrastructure/inventory/inventory-repository';
import {
  findMedicationPresentationByCip13,
  searchMedicationReference,
  type IdentifiedMedicationPresentation,
  type MedicationSearchResult,
} from '@/infrastructure/medications/medication-reference';
import { listAllGenericEquivalenceConfirmations } from '@/infrastructure/treatments/generic-equivalence-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppButton,
  AppField,
  Card,
  EmptyState,
  LoadingState,
  Message,
  Screen,
  colors,
  radii,
  spacing,
  typography,
  useToast,
  type ToastTone,
} from '@/ui';

/**
 * Signale, sans jamais bloquer l'ajout ni créer de lien, qu'une boîte vient
 * d'être ajoutée pour un médicament sans traitement actif ni équivalence
 * générique mémorisée (ticket 28). Recalculé à chaque ajout à partir de
 * l'état courant : ne préjuge jamais qu'un traitement sera créé ensuite.
 */
async function notifyIfOrphanMedication(
  personalDatabase: SQLiteDatabase,
  specialtyCis: string,
  showToast: (message: string, tone?: ToastTone) => void,
): Promise<void> {
  const [treatments, confirmations] = await Promise.all([
    listTreatments(personalDatabase),
    listAllGenericEquivalenceConfirmations(personalDatabase),
  ]);
  const attachedCis = buildAttachedSpecialtyCisSet(
    treatments,
    confirmations.map((confirmation) => ({
      treatmentId: confirmation.treatmentId,
      cis: confirmation.cis,
    })),
  );
  if (!attachedCis.has(specialtyCis)) {
    showToast(
      'Boîte ajoutée : aucun traitement actif ne correspond à ce médicament pour le moment.',
      'warning',
    );
  }
}

type AddBoxMode = 'CHOICE' | 'SCAN' | 'MANUAL';

const SCREEN_TITLE = 'Ajouter une boîte';

export default function AddBoxScreen() {
  const personalDatabase = useSQLiteContext();
  const { draftTreatmentCis, draftTreatmentName } = useLocalSearchParams<{
    draftTreatmentCis?: string;
    draftTreatmentName?: string;
  }>();
  return (
    // `useSuspense` volontairement omis : son mode s'appuie sur un cache
    // global partagé entre tous les `SQLiteProvider` du même nom de base,
    // quel que soit l'écran — naviguer vers un autre écran ouvrant aussi
    // `medication-reference.db` en mode suspense ferme alors cette connexion
    // pendant qu'elle est encore utilisée ici (constaté : crash « unable to
    // close due to unfinalized statements »).
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{
        assetId: medicationReferenceAsset,
        forceOverwrite: true,
      }}
      options={{ useNewConnection: true }}
    >
      <AddBox
        personalDatabase={personalDatabase}
        draftTreatmentCis={draftTreatmentCis}
        draftTreatmentName={draftTreatmentName}
      />
    </SQLiteProvider>
  );
}

function AddBox({
  personalDatabase,
  draftTreatmentCis,
  draftTreatmentName,
}: {
  personalDatabase: SQLiteDatabase;
  draftTreatmentCis?: string;
  draftTreatmentName?: string;
}) {
  const [mode, setMode] = useState<AddBoxMode>('CHOICE');

  if (mode === 'SCAN')
    return (
      <ScanBox
        personalDatabase={personalDatabase}
        draftTreatmentCis={draftTreatmentCis}
        draftTreatmentName={draftTreatmentName}
        onLeave={() => setMode('CHOICE')}
      />
    );
  if (mode === 'MANUAL')
    return (
      <ManualBox
        personalDatabase={personalDatabase}
        draftTreatmentCis={draftTreatmentCis}
        draftTreatmentName={draftTreatmentName}
        onLeave={() => setMode('CHOICE')}
      />
    );
  return <ModeChoice onSelect={setMode} />;
}

/** Le scan reste la voie rapide, sans jamais devenir la seule voie possible. */
function ModeChoice({ onSelect }: { onSelect(mode: AddBoxMode): void }) {
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: SCREEN_TITLE }} />
      <Card>
        <Text style={typography.heading}>Scanner le DataMatrix</Text>
        <Text style={typography.body}>
          Préremplit le produit, le lot et la péremption depuis la boîte.
        </Text>
        <AppButton
          label="Scanner le DataMatrix"
          onPress={() => onSelect('SCAN')}
        />
      </Card>
      <Card>
        <Text style={typography.heading}>Ajouter sans DataMatrix</Text>
        <Text style={typography.body}>
          Pour une boîte sans code lisible : choisissez le médicament dans le
          référentiel, puis saisissez vous-même le lot et la péremption.
        </Text>
        <AppButton
          label="Ajouter sans DataMatrix"
          variant="secondary"
          onPress={() => onSelect('MANUAL')}
        />
      </Card>
    </Screen>
  );
}

function ManualBox({
  personalDatabase,
  draftTreatmentCis,
  draftTreatmentName,
  onLeave,
}: {
  personalDatabase: SQLiteDatabase;
  draftTreatmentCis?: string;
  draftTreatmentName?: string;
  onLeave(): void;
}) {
  const referenceDatabase = useSQLiteContext();
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [medication, setMedication] =
    useState<IdentifiedMedicationPresentation | null>(null);
  const [lot, setLot] = useState('');
  const [expiration, setExpiration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const genericGate = useGenericEquivalenceGate(
    personalDatabase,
    referenceDatabase,
  );
  const draftPrompt = useDraftGenericEquivalencePrompt(
    referenceDatabase,
    draftTreatmentCis,
    draftTreatmentName,
  );
  const duplicateLotGate = useDuplicateLotGate(personalDatabase);

  useEffect(() => {
    if (medication !== null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(query.trim().length > 0);
      searchMedicationReference(referenceDatabase, query)
        .then((found) => {
          if (!cancelled) setResults(found);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setError('Recherche dans le référentiel impossible.');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [medication, query, referenceDatabase]);

  async function save(): Promise<void> {
    if (medication === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      await genericGate.checkBeforeSave(medication.cis, medication.name);
      const draftOutcome = await draftPrompt.checkBeforeSave(
        medication.cis,
        medication.name,
      );
      const proceed = await duplicateLotGate.checkBeforeSave(
        medication.cip13,
        lot,
      );
      if (!proceed) return;
      await addMedicationBox(personalDatabase, {
        specialtyCis: medication.cis,
        specialtyName: medication.name,
        pharmaceuticalForm: medication.pharmaceuticalForm,
        presentationCip13: medication.cip13,
        presentationLabel: medication.label,
        lot,
        expirationDate: expiration,
        initialQuantity: Number(quantity),
        origin: 'MANUAL',
        scanRaw: null,
      });
      if (draftOutcome !== 'confirmed')
        await notifyIfOrphanMedication(
          personalDatabase,
          medication.cis,
          showToast,
        );
      if (router.canGoBack()) router.back();
      else router.replace('/inventory');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: SCREEN_TITLE }} />
      <Message tone="info" title="Ajout sans DataMatrix">
        La boîte sera enregistrée comme saisie manuelle. PillBox ne complétera
        aucune information absente de la boîte.
      </Message>
      {error ? (
        <Message tone="error" title="Boîte non enregistrée">
          {error}
        </Message>
      ) : null}
      {medication === null ? (
        <>
          <AppField
            label="Rechercher le médicament"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Nom, dosage ou forme"
            value={query}
          />
          {searching ? <LoadingState label="Recherche en cours…" /> : null}
          {!searching && query.trim().length > 0 && results.length === 0 ? (
            <EmptyState
              title="Aucun médicament trouvé"
              description="Vérifiez l’orthographe, le dosage ou la forme. PillBox ne propose aucune correspondance incertaine."
            />
          ) : null}
          {results.map((result) => (
            <Card key={result.cis} style={styles.result}>
              <Text style={typography.heading}>{result.name}</Text>
              {result.pharmaceuticalForm === null ? null : (
                <Text style={typography.caption}>
                  {result.pharmaceuticalForm}
                </Text>
              )}
              <Text style={typography.caption}>
                Choisissez la présentation exacte de votre boîte.
              </Text>
              {result.presentations.map((presentation) => (
                <Pressable
                  accessibilityRole="button"
                  key={presentation.cip13}
                  onPress={() =>
                    setMedication({
                      cip13: presentation.cip13,
                      label: presentation.label,
                      cis: result.cis,
                      name: result.name,
                      pharmaceuticalForm: result.pharmaceuticalForm,
                    })
                  }
                  style={styles.presentation}
                >
                  <Text style={typography.body}>{presentation.label}</Text>
                  <Text style={typography.caption}>
                    CIP13 {presentation.cip13}
                  </Text>
                </Pressable>
              ))}
            </Card>
          ))}
        </>
      ) : (
        <>
          <Card>
            <Text style={typography.heading}>{medication.name}</Text>
            <Text>{medication.label}</Text>
            <Text>CIP13 {medication.cip13}</Text>
            <AppButton
              label="Changer de médicament"
              variant="quiet"
              onPress={() => setMedication(null)}
            />
          </Card>
          <AppField
            label="Lot"
            help="Requis : il identifie la boîte dans les préparations et l’historique."
            onChangeText={setLot}
            placeholder="Tel qu’imprimé sur la boîte"
            value={lot}
          />
          <ExpirationField
            label="Péremption"
            value={expiration}
            onChange={setExpiration}
          />
          <AppField
            label="Quantité initiale"
            help="Nombre d’unités présentes dans la boîte."
            keyboardType="number-pad"
            onChangeText={setQuantity}
            placeholder="Ex. 30"
            value={quantity}
          />
          <AppButton
            label="Ajouter cette boîte"
            loading={saving}
            disabled={
              saving ||
              lot.trim() === '' ||
              expiration === '' ||
              quantity.trim() === ''
            }
            onPress={() => void save()}
          />
        </>
      )}
      <AppButton
        label="Revenir au choix"
        variant="quiet"
        onPress={onLeave}
        disabled={saving}
      />
      {genericGate.pendingMatch ? (
        <GenericMatchConfirmation
          visible
          expectedSpecialtyName={genericGate.pendingMatch.expectedSpecialtyName}
          scannedSpecialtyName={genericGate.pendingMatch.scannedSpecialtyName}
          groupLabel={genericGate.pendingMatch.groupLabel}
          busy={genericGate.busy}
          onCancel={genericGate.skipCurrent}
          onConfirm={() => void genericGate.confirmCurrent()}
        />
      ) : null}
      {draftPrompt.pendingMatch ? (
        <GenericMatchConfirmation
          visible
          expectedSpecialtyName={draftPrompt.pendingMatch.expectedSpecialtyName}
          scannedSpecialtyName={draftPrompt.pendingMatch.scannedSpecialtyName}
          groupLabel={draftPrompt.pendingMatch.groupLabel}
          busy={false}
          onCancel={draftPrompt.skip}
          onConfirm={draftPrompt.confirm}
        />
      ) : null}
      {duplicateLotGate.pendingDuplicate ? (
        <DuplicateLotConfirmation
          visible
          existingBox={duplicateLotGate.pendingDuplicate}
          onCancel={duplicateLotGate.cancel}
          onConfirm={duplicateLotGate.confirm}
        />
      ) : null}
    </Screen>
  );
}

function ScanBox({
  personalDatabase,
  draftTreatmentCis,
  draftTreatmentName,
  onLeave,
}: {
  personalDatabase: SQLiteDatabase;
  draftTreatmentCis?: string;
  draftTreatmentName?: string;
  onLeave(): void;
}) {
  const referenceDatabase = useSQLiteContext();
  const { showToast } = useToast();
  const scanner = useBarcodeScanner();
  const [scan, setScan] = useState<BarcodeScanningResult | null>(null);
  const [medication, setMedication] =
    useState<IdentifiedMedicationPresentation | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [lot, setLot] = useState('');
  const [expiration, setExpiration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const genericGate = useGenericEquivalenceGate(
    personalDatabase,
    referenceDatabase,
  );
  const draftPrompt = useDraftGenericEquivalencePrompt(
    referenceDatabase,
    draftTreatmentCis,
    draftTreatmentName,
  );
  const duplicateLotGate = useDuplicateLotGate(personalDatabase);

  useEffect(() => {
    let active = true;
    if (!scan)
      return () => {
        active = false;
      };
    const parsed = parseGs1DataMatrix(scan.data);
    setLot(parsed.fields.lot ?? '');
    setExpiration(
      parsed.fields.expiration
        ? (parseGs1Expiration(parsed.fields.expiration) ?? '')
        : '',
    );
    const cip13 = parsed.fields.gtin
      ? normalizeScannedGtinToCip13(parsed.fields.gtin)
      : null;
    if (!cip13) {
      setMedication(null);
      setError('Médicament non identifié. Vérifiez la boîte et rescanner.');
      return () => {
        active = false;
      };
    }
    setIdentifying(true);
    findMedicationPresentationByCip13(referenceDatabase, cip13)
      .then((result) => {
        if (active) {
          setMedication(result);
          setError(
            result
              ? null
              : 'Médicament non identifié dans le référentiel local.',
          );
        }
      })
      .catch(() => {
        if (active) setError('Identification locale impossible.');
      })
      .finally(() => {
        if (active) setIdentifying(false);
      });
    return () => {
      active = false;
    };
  }, [referenceDatabase, scan]);

  const reset = () => {
    setScan(null);
    setMedication(null);
    setQuantity('');
    setError(null);
    scanner.unlock();
  };

  const save = async () => {
    if (!scan || !medication) return;
    const initialQuantity = Number(quantity);
    setSaving(true);
    try {
      await genericGate.checkBeforeSave(medication.cis, medication.name);
      const draftOutcome = await draftPrompt.checkBeforeSave(
        medication.cis,
        medication.name,
      );
      const proceed = await duplicateLotGate.checkBeforeSave(
        medication.cip13,
        lot,
      );
      if (!proceed) return;
      await addMedicationBox(personalDatabase, {
        specialtyCis: medication.cis,
        specialtyName: medication.name,
        pharmaceuticalForm: medication.pharmaceuticalForm,
        presentationCip13: medication.cip13,
        presentationLabel: medication.label,
        lot,
        expirationDate: expiration,
        initialQuantity,
        origin: 'SCAN',
        scanRaw: scan.data,
      });
      if (draftOutcome !== 'confirmed')
        await notifyIfOrphanMedication(
          personalDatabase,
          medication.cis,
          showToast,
        );
      if (router.canGoBack()) router.back();
      else router.replace('/inventory');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (scanner.permission === null)
    return <Centered text="Vérification de la caméra…" />;
  if (!scanner.permission.granted) {
    return (
      <Centered text="La caméra est nécessaire pour scanner une boîte.">
        <AppButton
          label="Autoriser la caméra"
          onPress={() => void scanner.requestPermission()}
        />
        <AppButton
          label="Ajouter sans DataMatrix"
          variant="secondary"
          onPress={onLeave}
        />
      </Centered>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: SCREEN_TITLE }} />
      {!scan ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={(result) => {
            if (scanner.lockOnce()) setScan(result);
          }}
        >
          <View style={styles.guide}>
            <Text style={styles.guideText}>Cadrez le DataMatrix</Text>
          </View>
        </CameraView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          {identifying ? (
            <ActivityIndicator accessibilityLabel="Identification en cours" />
          ) : null}
          {medication ? (
            <Card style={styles.identified} tone="muted">
              <Text style={styles.medication}>{medication.name}</Text>
              <Text>{medication.label}</Text>
              <Text>CIP13 {medication.cip13}</Text>
            </Card>
          ) : null}
          {error ? (
            <Message tone="error" title="Boîte non validée">
              {error}
            </Message>
          ) : null}
          <AppField
            label="Lot"
            onChangeText={setLot}
            placeholder="À saisir si absent du scan"
            value={lot}
          />
          <ExpirationField
            label="Péremption"
            value={expiration}
            onChange={setExpiration}
          />
          <Text style={styles.quantityNotice}>
            Quantité initiale requise : elle ne peut pas être obtenue de façon
            fiable depuis le DataMatrix.
          </Text>
          <AppField
            label="Quantité initiale"
            keyboardType="number-pad"
            onChangeText={setQuantity}
            placeholder="Ex. 30"
            value={quantity}
          />
          <AppButton
            label="Ajouter cette boîte"
            loading={saving}
            disabled={saving || identifying || medication === null}
            onPress={() => void save()}
          />
          <View style={styles.secondary}>
            <AppButton
              label="Scanner à nouveau"
              variant="secondary"
              onPress={reset}
            />
          </View>
          <Text selectable style={styles.raw}>
            Scan brut conservé : {JSON.stringify(scan.data)}
          </Text>
        </ScrollView>
      )}
      {genericGate.pendingMatch ? (
        <GenericMatchConfirmation
          visible
          expectedSpecialtyName={genericGate.pendingMatch.expectedSpecialtyName}
          scannedSpecialtyName={genericGate.pendingMatch.scannedSpecialtyName}
          groupLabel={genericGate.pendingMatch.groupLabel}
          busy={genericGate.busy}
          onCancel={genericGate.skipCurrent}
          onConfirm={() => void genericGate.confirmCurrent()}
        />
      ) : null}
      {draftPrompt.pendingMatch ? (
        <GenericMatchConfirmation
          visible
          expectedSpecialtyName={draftPrompt.pendingMatch.expectedSpecialtyName}
          scannedSpecialtyName={draftPrompt.pendingMatch.scannedSpecialtyName}
          groupLabel={draftPrompt.pendingMatch.groupLabel}
          busy={false}
          onCancel={draftPrompt.skip}
          onConfirm={draftPrompt.confirm}
        />
      ) : null}
      {duplicateLotGate.pendingDuplicate ? (
        <DuplicateLotConfirmation
          visible
          existingBox={duplicateLotGate.pendingDuplicate}
          onCancel={duplicateLotGate.cancel}
          onConfirm={duplicateLotGate.confirm}
        />
      ) : null}
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
      <Stack.Screen options={{ headerShown: true, title: SCREEN_TITLE }} />
      <Text style={typography.body}>{text}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1 },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  container: { backgroundColor: colors.background, flex: 1 },
  form: { gap: spacing.lg, padding: spacing.lg },
  guide: {
    borderColor: colors.surface,
    borderWidth: 2,
    left: '12%',
    padding: 12,
    position: 'absolute',
    right: '12%',
    top: '35%',
  },
  guideText: {
    backgroundColor: colors.overlay,
    color: colors.surface,
    padding: 6,
    textAlign: 'center',
  },
  identified: { marginBottom: spacing.lg },
  medication: typography.heading,
  presentation: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    padding: spacing.md,
  },
  quantityNotice: { fontWeight: '700', marginBottom: 8 },
  raw: { color: colors.textMuted, fontSize: 12, marginTop: 18 },
  result: { marginBottom: spacing.sm },
  secondary: { marginTop: 12 },
});
