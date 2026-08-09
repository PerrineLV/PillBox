import type { BarcodeScanningResult } from 'expo-camera';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

import { parseGs1DataMatrix } from '@/domain/datamatrix/parse-gs1';

export default function DataMatrixScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scan, setScan] = useState<BarcodeScanningResult | null>(null);
  const scanLocked = useRef(false);

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
            Le GTIN est conservé tel quel. Ce spike ne le convertit pas en CIP.
          </Text>
          <Button title="Scanner à nouveau" onPress={scanAgain} />
        </ScrollView>
      )}
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
