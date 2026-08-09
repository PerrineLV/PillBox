import medicationReferenceAsset from '../../../assets/medications/medications.db';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  searchMedicationReference,
  type MedicationSearchResult,
} from '@/infrastructure/medications/medication-reference';

export default function MedicationSearchScreen() {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <MedicationSearch />
    </SQLiteProvider>
  );
}

function MedicationSearch() {
  const database = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setIsSearching(query.trim().length > 0);
      searchMedicationReference(database, query)
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults);
            setError(null);
          }
        })
        .catch((reason: unknown) => {
          if (!cancelled) {
            setResults([]);
            setError(
              reason instanceof Error
                ? reason.message
                : 'Recherche impossible.',
            );
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [database, query]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Médicaments' }} />
      <TextInput
        accessibilityLabel="Rechercher un médicament"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Nom, dosage ou forme"
        style={styles.searchInput}
        value={query}
      />
      {isSearching ? <ActivityIndicator /> : null}
      {error === null ? null : <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={results}
        keyExtractor={(item) => item.cis}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length > 0 && !isSearching && error === null ? (
            <Text style={styles.empty}>Aucun médicament trouvé.</Text>
          ) : null
        }
        renderItem={({ item }) => <MedicationResult result={item} />}
      />
    </View>
  );
}

function MedicationResult({ result }: { result: MedicationSearchResult }) {
  return (
    <View style={styles.result}>
      <Text style={styles.name}>{result.name}</Text>
      <Text>CIS {result.cis}</Text>
      {result.pharmaceuticalForm === null ? null : (
        <Text>Forme : {result.pharmaceuticalForm}</Text>
      )}
      {result.presentations.map((presentation) => (
        <View key={presentation.cip13} style={styles.presentation}>
          <Text>CIP13 {presentation.cip13}</Text>
          <Text>{presentation.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#ffffff', flex: 1, padding: 16 },
  empty: { color: '#4b5563', paddingTop: 24, textAlign: 'center' },
  error: { color: '#b91c1c', marginBottom: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  presentation: {
    borderLeftColor: '#d1d5db',
    borderLeftWidth: 2,
    marginTop: 8,
    paddingLeft: 8,
  },
  result: {
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    paddingVertical: 14,
  },
  searchInput: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
});
