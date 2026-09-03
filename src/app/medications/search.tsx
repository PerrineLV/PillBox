import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GenericGroupSection } from '@/components/medications/generic-group-section';
import {
  searchMedicationReference,
  type MedicationSearchResult,
} from '@/infrastructure/medications/medication-reference';
import { useMedicationReferenceDatabase } from '@/infrastructure/medications/medication-reference-provider';
import {
  AppCard,
  AppScreen,
  EmptyState,
  LoadingState,
  Message,
  MetaBadge,
  PillButton,
  SearchField,
  StackHeader,
  colors,
  typography,
} from '@/ui';

export default function MedicationSearchScreen() {
  const database = useMedicationReferenceDatabase();
  /**
   * Présent lorsque la recherche est atteinte depuis la saisie d'une ligne
   * d'ordonnance : transmis à `/treatments/new` pour qu'il revienne vers cet
   * écran une fois le traitement créé, au lieu d'aller vers la liste.
   */
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
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
          if (cancelled) return;
          setResults(nextResults);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setResults([]);
          setError(
            reason instanceof Error ? reason.message : 'Recherche impossible.',
          );
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
    <AppScreen header={<StackHeader title="Médicaments" />}>
      <SearchField
        accessibilityLabel="Rechercher un médicament"
        autoCapitalize="none"
        autoCorrect={false}
        help="Nom, dosage ou forme · base de référence hors ligne"
        onChangeText={setQuery}
        placeholder="Nom, dosage ou forme"
        value={query}
      />
      {isSearching ? <LoadingState label="Recherche en cours…" /> : null}
      {error === null ? null : <Message tone="error">{error}</Message>}
      {query.trim().length > 0 &&
      !isSearching &&
      error === null &&
      results.length === 0 ? (
        <EmptyState
          description="Vérifiez l’orthographe, le dosage ou la forme."
          title="Aucun médicament trouvé"
        />
      ) : null}
      {results.map((result) => (
        <MedicationResult
          key={result.cis}
          result={result}
          returnTo={returnTo}
        />
      ))}
      <Text style={typography.micro}>
        PillBox ne propose aucune correspondance incertaine : si le dosage ne
        figure pas, il n’apparaît pas.
      </Text>
    </AppScreen>
  );
}

function MedicationResult({
  result,
  returnTo,
}: Readonly<{ result: MedicationSearchResult; returnTo?: string }>) {
  return (
    <AppCard>
      <Text style={styles.name}>{result.name}</Text>
      <View style={styles.badges}>
        <MetaBadge label={`CIS ${result.cis}`} />
        {result.pharmaceuticalForm === null ? null : (
          <MetaBadge label={result.pharmaceuticalForm} />
        )}
      </View>
      {result.presentations.length > 0 ? (
        <View style={styles.presentations}>
          {result.presentations.map((presentation) => (
            <View key={presentation.cip13} style={styles.presentation}>
              <Text style={styles.presentationLabel}>{presentation.label}</Text>
              <Text style={typography.micro}>CIP13 {presentation.cip13}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <GenericGroupSection cis={result.cis} />
      <PillButton
        height={46}
        label="Créer un traitement"
        onPress={() =>
          router.push({
            pathname: '/treatments/new',
            params: {
              cis: result.cis,
              name: result.name,
              form: result.pharmaceuticalForm ?? '',
              ...(returnTo ? { returnTo } : {}),
            },
          })
        }
      />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.cardTitle, fontSize: 16, lineHeight: 20 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presentations: { gap: 9 },
  presentation: {
    borderLeftColor: colors.cardBorder,
    borderLeftWidth: 2,
    gap: 2,
    paddingLeft: 10,
  },
  presentationLabel: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: '600',
    lineHeight: 17,
  },
});
