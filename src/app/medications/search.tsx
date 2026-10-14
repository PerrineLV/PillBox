import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SupplementResult } from '@/components/supplements/supplement-result';
import { GenericGroupSection } from '@/components/medications/generic-group-section';
import {
  searchMedicationReference,
  type MedicationSearchResult,
} from '@/infrastructure/medications/medication-reference';
import { useMedicationReferenceDatabase } from '@/infrastructure/medications/medication-reference-provider';
import {
  searchSupplementReference,
  listSupplementForms,
  type SupplementSearchResult,
} from '@/infrastructure/supplements/supplement-reference';
import { useSupplementReferenceDatabase } from '@/infrastructure/supplements/supplement-reference-provider';
import {
  AppCard,
  DenseList,
  Section,
  SelectField,
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
  const [form, setForm] = useState<string | null>(null);
  const [forms, setForms] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setIsSearching(query.trim().length > 0);
      Promise.all([
        searchMedicationReference(database, query),
        searchSupplementReference(supplementDatabase, query, 30, form),
        listSupplementForms(supplementDatabase, query),
      ])
        .then(([nextResults, nextSupplements, nextForms]) => {
          if (cancelled) return;
          setResults(nextResults);
          setSupplements(nextSupplements);
          setForms(nextForms);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setResults([]);
          setSupplements([]);
          setForms([]);
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
  }, [database, supplementDatabase, query, form]);

  return (
    <AppScreen header={<StackHeader title="Rechercher un produit" />}>
      <SearchField
        accessibilityLabel="Rechercher un médicament ou complément"
        autoCapitalize="none"
        autoCorrect={false}
        help="Médicaments BDPM et compléments Compl’Alim · hors ligne"
        onChangeText={(text) => {
          setQuery(text);
          setForm(null);
        }}
        placeholder="Nom, marque, dosage ou forme"
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
      {results.map((result) => (
        <MedicationResult
          key={result.cis}
          result={result}
          returnTo={returnTo}
        />
      ))}
      {forms.length > 0 || supplements.length > 0 ? (
        <Section label="Compléments · Compl’Alim">
          {forms.length > 1 ? (
            <SelectField
              label="Forme du complément"
              value={form ?? ''}
              options={[
                { value: '', label: 'Toutes les formes' },
                ...forms.map((value) => ({ value, label: value })),
              ]}
              onChange={(value) => setForm(value || null)}
            />
          ) : null}
          <DenseList>
            {supplements.map((result, index) => (
              <SupplementResult
                first={index === 0}
                key={result.externalId}
                result={result}
                returnTo={returnTo}
              />
            ))}
          </DenseList>
          {supplements.length === 30 ? (
            <Text style={typography.detail}>
              30 références affichées. Précisez le nom, la marque ou la forme
              pour affiner.
            </Text>
          ) : null}
        </Section>
      ) : null}
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
