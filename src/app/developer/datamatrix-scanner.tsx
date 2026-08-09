import medicationReferenceAsset from '../../../assets/medications/medications.db';
import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';
import { normalizeScannedGtinToCip13 } from '@/domain/medications/normalize-scanned-identifier';
import {
  findMedicationPresentationByCip13,
  type IdentifiedMedicationPresentation,
} from '@/infrastructure/medications/medication-reference';

export default function DataMatrixScannerScreen() {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <DataMatrixScanner />
    </SQLiteProvider>
  );
}

type IdentificationState =
  | { status: 'idle' | 'loading' | 'unidentified' }
  | { status: 'identified'; presentation: IdentifiedMedicationPresentation };

function DataMatrixScanner() {
  const database = useSQLiteContext();
  const [permission, requestPermission] = useCameraPermissions();
  const [scan, setScan] = useState<BarcodeScanningResult | null>(null);
  const [identification, setIdentification] = useState<IdentificationState>({
    status: 'idle',
  });
  const scanLocked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (scan === null) {
      setIdentification({ status: 'idle' });
      return () => {
        cancelled = true;
      };
    }

    const gtin = parseGs1DataMatrix(scan.data).fields.gtin;
    const cip13 = gtin === undefined ? null : normalizeScannedGtinToCip13(gtin);
    if (cip13 === null) {
      setIdentification({ status: 'unidentified' });
      return () => {
        cancelled = true;
      };
    }

    setIdentification({ status: 'loading' });
    findMedicationPresentationByCip13(database, cip13)
      .then((presentation) => {
        if (!cancelled) {
          setIdentification(
            presentation === null
              ? { status: 'unidentified' }
              : { status: 'identified', presentation },
          );
        }
      })
      .catch(() => {
        if (!cancelled) setIdentification({ status: 'unidentified' });
      });

    return () => {
      cancelled = true;
    };
  }, [database, scan]);

  const handleScan = (result: BarcodeScanningResult) => {
    if (scanLocked.current) {
      return;
    }

    scanLocked.current = true;
    setScan(result);
  };

  const scanAgain = () => {
    setScan(null);
    scanLocked.current = false;
  };

  if (permission === null) {
    return <CenteredMessage message="Vérification de l’autorisation caméra…" />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Stack.Screen
          options={{ headerShown: true, title: 'Scan DataMatrix' }}
        />
        <Text style={styles.permissionText}>
          La caméra est nécessaire pour lire un DataMatrix sur une boîte.
        </Text>
        <Button title="Autoriser la caméra" onPress={requestPermission} />
      </View>
    );
  }

  const parsed = scan === null ? null : parseGs1DataMatrix(scan.data);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Scan DataMatrix' }} />
      {scan === null ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix'] }}
          onBarcodeScanned={handleScan}
        >
          <View style={styles.guide}>
            <Text style={styles.guideText}>Cadrez le DataMatrix</Text>
          </View>
        </CameraView>
      ) : (
        <ScrollView contentContainerStyle={styles.result}>
          <Result label="Type" value={scan.type} />
          <Result label="Chaîne brute exacte" value={scan.data} />
          <Result
            label="RAW JSON (diagnostic)"
            value={JSON.stringify(scan.data)}
          />
          <Result label="GTIN (AI 01)" value={parsed?.fields.gtin} />
          <IdentificationResult identification={identification} />
          <Result
            label="Expiration YYMMDD (AI 17)"
            value={parsed?.fields.expiration}
          />
          <Result label="Lot (AI 10)" value={parsed?.fields.lot} />
          <Result
            label="Numéro de série (AI 21)"
            value={parsed?.fields.serialNumber}
          />
          <Result
            label="Erreurs de parsing"
            value={
              parsed?.errors.length === 0 ? 'Aucune' : parsed?.errors.join('\n')
            }
          />
          <Text style={styles.note}>
            Le GTIN et le RAW sont conservés tels quels.
          </Text>
          <Button title="Scanner à nouveau" onPress={scanAgain} />
        </ScrollView>
      )}
    </View>
  );
}

function IdentificationResult({
  identification,
}: {
  identification: IdentificationState;
}) {
  if (identification.status === 'loading') {
    return <ActivityIndicator accessibilityLabel="Identification en cours" />;
  }

  if (identification.status !== 'identified') {
    return <Result label="Identification" value="médicament non identifié" />;
  }

  const { presentation } = identification;
  return (
    <View>
      <Result label="Médicament identifié" value={presentation.name} />
      <Result label="CIS" value={presentation.cis} />
      <Result label="CIP13" value={presentation.cip13} />
      <Result label="Présentation" value={presentation.label} />
    </View>
  );
}

function CenteredMessage({ message }: { message: string }) {
  return (
    <View style={styles.permissionContainer}>
      <Text>{message}</Text>
    </View>
  );
}

function Result({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <View style={styles.resultBlock}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value ?? 'Absent'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1 },
  container: { backgroundColor: '#ffffff', flex: 1 },
  guide: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderWidth: 2,
    left: '12%',
    padding: 12,
    position: 'absolute',
    right: '12%',
    top: '35%',
  },
  guideText: { backgroundColor: '#00000099', color: '#ffffff', padding: 6 },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  note: { color: '#4b5563', fontSize: 14, marginBottom: 20 },
  permissionContainer: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 24,
  },
  permissionText: { textAlign: 'center' },
  result: { padding: 20 },
  resultBlock: { marginBottom: 16 },
  value: { backgroundColor: '#f3f4f6', fontFamily: 'monospace', padding: 10 },
});
