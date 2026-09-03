import { useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import {
  treatmentCategory,
  treatmentPosologySummary,
  type TreatmentCategory,
} from '@/components/treatments/treatment-summary';
import { usedSlots } from '@/domain/reminders/intake-reminder';
import {
  INTAKE_SLOTS,
  type IntakeSlot,
  type Treatment,
} from '@/domain/treatments/treatment';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppScreen,
  DenseList,
  DenseRow,
  EmptyState,
  FilterPills,
  FloatingAction,
  INTAKE_SLOT_INITIALS,
  INTAKE_SLOT_LABELS,
  LoadingState,
  Message,
  SearchField,
  Section,
  TabHeader,
  colors,
  typography,
} from '@/ui';

type Filter = 'ALL' | TreatmentCategory;

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: 'PILLBOX', label: 'Pilulier' },
  { value: 'AS_NEEDED', label: 'Si besoin' },
  { value: 'OUTSIDE', label: 'Hors pilulier' },
];

function isFilter(value: string | undefined): value is Filter {
  return FILTERS.some((option) => option.value === value);
}

export default function TreatmentsScreen() {
  const database = useSQLiteContext();
  const { filter: requestedFilter } = useLocalSearchParams<{
    filter?: string;
  }>();
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  // Un écran qui renvoie ici sur une catégorie précise (la section « si
  // besoin » de l'accueil) la transmet en paramètre. Le filtre reste ensuite
  // entièrement piloté par les pastilles.
  useEffect(() => {
    if (isFilter(requestedFilter)) setFilter(requestedFilter);
  }, [requestedFilter]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listTreatments(database)
        .then((items) => {
          if (!active) return;
          setTreatments(items);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : 'Chargement impossible.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [database]),
  );

  const normalized = query.trim().toLocaleLowerCase('fr-FR');
  const matching = treatments.filter(
    (treatment) =>
      treatment.specialtyName.toLocaleLowerCase('fr-FR').includes(normalized) &&
      (filter === 'ALL' || treatmentCategory(treatment) === filter),
  );
  const active = matching.filter((treatment) => treatment.archivedAt === null);
  const archived = matching.filter(
    (treatment) => treatment.archivedAt !== null,
  );

  return (
    <AppScreen
      floatingAction={
        <FloatingAction
          accessibilityLabel="Ajouter un traitement"
          href="/medications/search"
          label="Traitement"
        />
      }
      header={
        <TabHeader
          subtitle={`${active.length} traitement${active.length > 1 ? 's' : ''} affiché${active.length > 1 ? 's' : ''}`}
          title="Traitements"
        />
      }
    >
      <SearchField
        accessibilityLabel="Rechercher dans mes traitements"
        onChangeText={setQuery}
        placeholder="Rechercher un traitement"
        value={query}
      />
      <FilterPills
        accessibilityLabel="Filtrer les traitements"
        onChange={(next) => setFilter(next)}
        options={FILTERS}
        value={filter}
      />
      {loading ? <LoadingState label="Chargement des traitements…" /> : null}
      {error ? (
        <Message tone="error" title="Traitements indisponibles">
          {error}
        </Message>
      ) : null}
      {!loading && !error && active.length === 0 ? (
        <EmptyState
          description={
            normalized || filter !== 'ALL'
              ? 'Modifiez la recherche ou le filtre pour afficher d’autres traitements.'
              : 'Ajoutez un traitement depuis le référentiel local. La posologie restera toujours à saisir manuellement.'
          }
          title={
            normalized || filter !== 'ALL'
              ? 'Aucun traitement trouvé'
              : 'Aucun traitement enregistré'
          }
        />
      ) : null}
      {active.length > 0 ? (
        <DenseList>
          {active.map((treatment, index) => (
            <TreatmentRow
              first={index === 0}
              key={treatment.id}
              treatment={treatment}
            />
          ))}
        </DenseList>
      ) : null}
      {archived.length > 0 ? (
        <Section aside={String(archived.length)} label="Archivés">
          <DenseList tone="muted">
            {archived.map((treatment, index) => (
              <DenseRow
                chevron
                detail={`Archivé le ${formatLongFrenchCivilDate(treatment.archivedAt ?? '')}`}
                first={index === 0}
                href={{
                  pathname: '/treatments/[id]',
                  params: { id: String(treatment.id) },
                }}
                key={treatment.id}
                title={
                  <Text style={styles.archivedName}>
                    {treatment.specialtyName}
                  </Text>
                }
              />
            ))}
          </DenseList>
          <Text style={typography.micro}>
            Conservés pour préserver vos historiques.
          </Text>
        </Section>
      ) : null}
    </AppScreen>
  );
}

function TreatmentRow({
  treatment,
  first,
}: Readonly<{ treatment: Treatment; first: boolean }>) {
  const served = new Set(usedSlots(treatment));
  const summary = treatmentPosologySummary(treatment);
  return (
    <DenseRow
      accessibilityLabel={`${treatment.specialtyName}. ${summary}${
        served.size > 0
          ? `. Créneaux : ${[...served]
              .map((slot) => INTAKE_SLOT_LABELS[slot])
              .join(', ')}`
          : ''
      }`}
      chevron
      detail={summary}
      first={first}
      href={targetOf(treatment)}
      title={<Text style={styles.name}>{treatment.specialtyName}</Text>}
      trailing={<SlotDots served={served} />}
    />
  );
}

/**
 * Un traitement « si besoin » n'a pas de fiche de posologie à consulter :
 * l'action utile est d'enregistrer la prise au moment où elle a lieu.
 */
function targetOf(treatment: Treatment): Href {
  return treatment.dosageKind === 'AS_NEEDED' && treatment.archivedAt === null
    ? {
        pathname: '/intakes/as-needed/[id]',
        params: { id: String(treatment.id) },
      }
    : { pathname: '/treatments/[id]', params: { id: String(treatment.id) } };
}

function SlotDots({ served }: Readonly<{ served: ReadonlySet<IntakeSlot> }>) {
  return (
    <View accessibilityElementsHidden style={styles.slots}>
      {INTAKE_SLOTS.map((slot) => {
        const on = served.has(slot);
        return (
          <View key={slot} style={[styles.slot, on && styles.slotServed]}>
            <Text style={[styles.slotText, on && styles.slotTextServed]}>
              {INTAKE_SLOT_INITIALS[slot]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  name: { ...typography.itemTitle, fontSize: 15.5 },
  archivedName: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  slots: { flexDirection: 'row', gap: 3 },
  slot: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 5,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  slotServed: { backgroundColor: colors.headerDark },
  slotText: {
    color: colors.textTertiary,
    fontSize: 8.5,
    fontWeight: '800',
    lineHeight: 10,
  },
  slotTextServed: { color: colors.onDark },
});
