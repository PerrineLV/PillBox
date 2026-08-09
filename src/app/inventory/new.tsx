import medicationReferenceAsset from '../../../assets/medications/medications.db';
import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import {
  SQLiteProvider,
  type SQLiteDatabase,
  useSQLiteContext,
} from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import { parseGs1Expiration } from '@/domain/inventory/inventory';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import { addMedicationBox } from '@/infrastructure/inventory/inventory-repository';
import {
  findMedicationPresentationByCip13,
  type IdentifiedMedicationPresentation,
} from '@/infrastructure/medications/medication-reference';
import {
  AppButton,
  AppField,
  Card,
  Message,
  colors,
  spacing,
  typography,
} from '@/ui';

export default function AddBoxScreen() {
  const personalDatabase = useSQLiteContext();
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <AddBox personalDatabase={personalDatabase} />
    </SQLiteProvider>
  );
}

function AddBox({ personalDatabase }: { personalDatabase: SQLiteDatabase }) {
  const referenceDatabase = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [scan, setScan] = useState<BarcodeScanningResult | null>(null);
  const [medication, setMedication] =
    useState<IdentifiedMedicationPresentation | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [lot, setLot] = useState('');
  const [serial, setSerial] = useState('');
  const [expiration, setExpiration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    if (!scan)
      return () => {
        active = false;
      };
    const parsed = parseGs1DataMatrix(scan.data);
    setLot(parsed.fields.lot ?? '');
    setSerial(parsed.fields.serialNumber ?? '');
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
    locked.current = false;
  };

  const save = async () => {
    if (!scan || !medication) return;
    const initialQuantity = Number(quantity);
    setSaving(true);
    try {
      await addMedicationBox(personalDatabase, {
        specialtyCis: medication.cis,
        specialtyName: medication.name,
        pharmaceuticalForm: medication.pharmaceuticalForm,
        presentationCip13: medication.cip13,
        presentationLabel: medication.label,
        lot,
        serialNumber: serial,
        expirationDate: expiration,
        initialQuantity,
        scanRaw: scan.data,
      });
      router.replace('/inventory');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (permission === null)
    return <Centered text="Vérification de la caméra…" />;
  if (!permission.granted) {
    return (
      <Centered text="La caméra est nécessaire pour ajouter une boîte.">
        <AppButton
          label="Autoriser la caméra"
          onPress={() => void requestPermission()}
        />
      </Centered>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{ headerShown: true, title: 'Ajouter une boîte' }}
      />
      {!scan ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={(result) => {
            if (!locked.current) {
              locked.current = true;
              setScan(result);
            }
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
            <Card style={styles.identified}>
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
          <Field
            label="Lot"
            value={lot}
            onChangeText={setLot}
            placeholder="À saisir si absent du scan"
          />
          <Field
            label="Péremption (AAAA-MM-JJ)"
            value={expiration}
            onChangeText={setExpiration}
            placeholder="Ex. 2027-12-31"
          />
          <Field
            label="Numéro de série"
            value={serial}
            onChangeText={setSerial}
            placeholder="Optionnel"
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
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
}) {
  return (
    <AppField
      label={props.label}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
    />
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
        options={{ headerShown: true, title: 'Ajouter une boîte' }}
      />
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
  field: { marginBottom: 14 },
  form: { gap: spacing.lg, padding: spacing.lg },
  guide: {
    borderColor: '#fff',
    borderWidth: 2,
    left: '12%',
    padding: 12,
    position: 'absolute',
    right: '12%',
    top: '35%',
  },
  guideText: {
    backgroundColor: '#00000099',
    color: '#fff',
    padding: 6,
    textAlign: 'center',
  },
  identified: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: 16,
    padding: 14,
  },
  input: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  label: { fontWeight: '700', marginBottom: 5 },
  medication: typography.heading,
  quantityNotice: { fontWeight: '700', marginBottom: 8 },
  raw: { color: '#4b5563', fontSize: 12, marginTop: 18 },
  secondary: { marginTop: 12 },
});
