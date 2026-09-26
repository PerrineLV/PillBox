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
  searchSupplementReference,
  type SupplementSearchResult,
} from '@/infrastructure/supplements/supplement-reference';
import { useSupplementReferenceDatabase } from '@/infrastructure/supplements/supplement-reference-provider';
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
  const supplementDatabase = useSupplementReferenceDatabase();
  /**
   * Présent lorsque la recherche est atteinte depuis la saisie d'une ligne
   * d'ordonnance : transmis à `/treatments/new` pour qu'il revienne vers cet
   * écran une fois le traitement créé, au lieu d'aller vers la liste.
   */
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicationSearchResult[]>([]);
  const [supplements, setSupplements] = useState<SupplementSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setIsSearching(query.trim().length > 0);
      Promise.all([
        searchMedicationReference(database, query),
        searchSupplementReference(supplementDatabase, query),
      ])
        .then(([nextResults, nextSupplements]) => {
          if (cancelled) return;
          setResults(nextResults);
          setSupplements(nextSupplements);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setResults([]);
          setSupplements([]);
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
  }, [database, supplementDatabase, query]);

  return (
    <AppScreen header={<StackHeader title="Rechercher un produit" />}>
      <SearchField
        accessibilityLabel="Rechercher un médicament ou complément"
        autoCapitalize="none"
        autoCorrect={false}
        help="Médicaments BDPM et compléments Compl’Alim · hors ligne"
        onChangeText={setQuery}
        placeholder="Nom, dosage ou forme"
        value={query}
      />
      {isSearching ? <LoadingState label="Recherche en cours…" /> : null}
      {error === null ? null : <Message tone="error">{error}</Message>}
      {query.trim().length > 0 &&
      !isSearching &&
      error === null &&
      results.length === 0 &&
      supplements.length === 0 ? (
        <EmptyState
          description="Vérifiez le nom ou ajoutez le produit manuellement."
          title="Aucun produit trouvé"
        />
      ) : null}
      {results.map((result) => (
        <MedicationResult
          key={result.cis}
          result={result}
          returnTo={returnTo}
        />
      ))}
      {supplements.map((result) => (
        <SupplementResult
          key={result.externalId}
          result={result}
          returnTo={returnTo}
        />
      ))}
      <PillButton
        label="Ajouter manuellement"
        tone="outline"
        onPress={() =>
          router.push({
            pathname: '/treatments/new',
            params: { source: 'MANUAL', ...(returnTo ? { returnTo } : {}) },
          })
        }
      />
      <Text style={typography.micro}>
        PillBox ne propose aucune correspondance incertaine : si le dosage ne
        figure pas, il n’apparaît pas.
      </Text>
    </AppScreen>
  );
}

function SupplementResult({
  result,
  returnTo,
}: Readonly<{ result: SupplementSearchResult; returnTo?: string }>) {
  return (
    <AppCard>
      <Text style={styles.name}>{result.name}</Text>
      <View style={styles.badges}>
        <MetaBadge label="Complément · Compl’Alim" />
        {result.brand ? <MetaBadge label={result.brand} /> : null}
        {result.form ? <MetaBadge label={result.form} /> : null}
      </View>
      <PillButton
        height={46}
        label="Créer un traitement"
        onPress={() =>
          router.push({
            pathname: '/treatments/new',
            params: {
              source: 'COMPL_ALIM',
              externalId: result.externalId,
              name: result.name,
              form: result.form ?? '',
              ...(returnTo ? { returnTo } : {}),
            },
          })
        }
      />
    </AppCard>
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
