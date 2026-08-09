import medicationReferenceAsset from '../../../assets/medications/medications.db';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import {
  searchMedicationReference,
  type MedicationSearchResult,
} from '@/infrastructure/medications/medication-reference';
import {
  AppField,
  Card,
  EmptyState,
  LoadingState,
  colors,
  spacing,
  typography,
} from '@/ui';

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
      <AppField
        label="Rechercher un médicament"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setQuery}
        placeholder="Nom, dosage ou forme"
        value={query}
      />
      {isSearching ? <LoadingState label="Recherche en cours…" /> : null}
      {error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <FlatList
        data={results}
        keyExtractor={(item) => item.cis}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim().length > 0 && !isSearching && error === null ? (
            <EmptyState
              title="Aucun médicament trouvé"
              description="Vérifiez l’orthographe, le dosage ou la forme. PillBox ne propose aucune correspondance incertaine."
            />
          ) : null
        }
        renderItem={({ item }) => <MedicationResult result={item} />}
      />
    </View>
  );
}

function MedicationResult({ result }: { result: MedicationSearchResult }) {
  return (
    <Card style={styles.result}>
      <Text style={styles.name}>{result.name}</Text>
      <Text>CIS {result.cis}</Text>
      {result.pharmaceuticalForm === null ? null : (
        <Text>Forme : {result.pharmaceuticalForm}</Text>
      )}
      <Link
        href={{
          pathname: '/treatments/new',
          params: {
            cis: result.cis,
            name: result.name,
            form: result.pharmaceuticalForm ?? '',
          },
        }}
        style={styles.createTreatment}
      >
        Créer un traitement
      </Link>
      {result.presentations.map((presentation) => (
        <View key={presentation.cip13} style={styles.presentation}>
          <Text>CIP13 {presentation.cip13}</Text>
          <Text>{presentation.label}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    padding: spacing.lg,
  },
  createTreatment: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    color: colors.surface,
    fontWeight: '700',
    marginTop: 8,
    minHeight: 48,
    overflow: 'hidden',
    padding: 13,
    textAlign: 'center',
  },
  empty: { color: '#4b5563', paddingTop: 24, textAlign: 'center' },
  error: { color: '#b91c1c', marginBottom: 12 },
  name: typography.heading,
  presentation: {
    borderLeftColor: '#d1d5db',
    borderLeftWidth: 2,
    marginTop: 8,
    paddingLeft: 8,
  },
  result: { marginBottom: spacing.md },
  searchInput: {
    borderColor: '#9ca3af',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
});
