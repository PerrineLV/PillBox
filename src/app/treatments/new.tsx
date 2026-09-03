import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { TreatmentBoxGenericMatch } from '@/components/medications/treatment-box-generic-match';
import { AsNeededTreatmentForm } from '@/components/treatments/as-needed-treatment-form';
import { TreatmentForm } from '@/components/treatments/treatment-form';
import {
  TREATMENT_CATEGORY_LABELS,
  type TreatmentCategory,
} from '@/components/treatments/treatment-summary';
import { queueCreatedTreatmentForPrescription } from '@/infrastructure/prescriptions/pending-new-treatment-for-prescription';
import { synchronizeTreatmentIntakeReminders } from '@/infrastructure/reminders/intake-reminder-scheduler';
import { confirmGenericEquivalence } from '@/infrastructure/treatments/generic-equivalence-repository';
import {
  drainPendingGenericEquivalenceDrafts,
  type PendingGenericEquivalenceDraft,
} from '@/infrastructure/treatments/pending-generic-equivalence-draft';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';
import {
  AppScreen,
  ChoicePills,
  Message,
  Section,
  StackHeader,
  typography,
} from '@/ui';

type SpecialtyBase = {
  specialtyCis: string;
  specialtyName: string;
  pharmaceuticalForm: string | null;
};

const CATEGORY_OPTIONS: readonly {
  value: TreatmentCategory;
  label: string;
}[] = [
  { value: 'PILLBOX', label: TREATMENT_CATEGORY_LABELS.PILLBOX },
  { value: 'OUTSIDE', label: TREATMENT_CATEGORY_LABELS.OUTSIDE },
  { value: 'AS_NEEDED', label: TREATMENT_CATEGORY_LABELS.AS_NEEDED },
];

export default function NewTreatmentScreen() {
  const params = useLocalSearchParams<{
    cis?: string;
    name?: string;
    form?: string;
    /**
     * Présent lorsque cet écran est atteint depuis une ligne d'ordonnance :
     * le traitement créé doit revenir vers cet écran plutôt que vers la liste
     * des traitements, sans perdre le brouillon d'ordonnance déjà saisi.
     */
    returnTo?: string;
  }>();
  const database = useSQLiteContext();
  const router = useRouter();
  const [category, setCategory] = useState<TreatmentCategory>('PILLBOX');

  // `dismissTo` plutôt que `replace` : cet écran est toujours atteint via
  // `/medications/search`, poussé par-dessus la liste des traitements, que
  // `replace` laisserait dans la pile sous l'écran remplacé.
  function finishTreatmentCreation(treatmentId: number): void {
    if (params.returnTo) {
      queueCreatedTreatmentForPrescription(treatmentId);
      router.dismissTo(params.returnTo as Href);
      return;
    }
    router.dismissTo('/treatments');
  }

  if (!params.cis || !params.name) {
    return (
      <AppScreen header={<StackHeader title="Nouveau traitement" />}>
        <Message tone="error" title="Spécialité manquante">
          Revenez à la recherche pour choisir un médicament du référentiel.
        </Message>
      </AppScreen>
    );
  }

  const base: SpecialtyBase = {
    specialtyCis: params.cis,
    specialtyName: params.name,
    pharmaceuticalForm: params.form || null,
  };

  return (
    <AppScreen
      header={
        <StackHeader subtitle={base.specialtyName} title="Nouveau traitement" />
      }
    >
      <Section label="Type de posologie">
        <ChoicePills
          onChange={(next) => setCategory(next)}
          options={CATEGORY_OPTIONS}
          value={category}
        />
        <Text style={typography.micro}>
          {category === 'AS_NEEDED'
            ? 'Aucun créneau n’est planifié : la prise est enregistrée au moment où elle a lieu.'
            : category === 'OUTSIDE'
              ? 'La prise reste suivie et rappelée, mais le médicament n’est pas déposé dans le pilulier.'
              : 'Le médicament est déposé dans le pilulier lors de la préparation hebdomadaire.'}
        </Text>
      </Section>

      {category === 'AS_NEEDED' ? (
        <AsNeededTreatmentForm
          initialValue={{
            ...base,
            dosageKind: 'AS_NEEDED',
            includedInPillbox: false,
            phases: [],
            asNeededInfo: {
              maxQuantityPerDayHalfUnits: null,
              minIntervalHours: null,
            },
          }}
          onSubmit={async (draft) => {
            const treatmentId = await createTreatment(database, draft);
            finishTreatmentCreation(treatmentId);
          }}
          submitLabel="Créer le traitement"
        />
      ) : (
        <ScheduledTreatmentCreation
          base={base}
          database={database}
          finishTreatmentCreation={finishTreatmentCreation}
          includedInPillbox={category === 'PILLBOX'}
          key={category}
        />
      )}
    </AppScreen>
  );
}

function ScheduledTreatmentCreation({
  database,
  base,
  includedInPillbox,
  finishTreatmentCreation,
}: Readonly<{
  database: SQLiteDatabase;
  base: SpecialtyBase;
  includedInPillbox: boolean;
  finishTreatmentCreation: (treatmentId: number) => void;
}>) {
  const [createdTreatment, setCreatedTreatment] = useState<{
    id: number;
    specialtyCis: string;
    specialtyName: string;
  } | null>(null);
  const [pendingEquivalences, setPendingEquivalences] = useState<
    readonly PendingGenericEquivalenceDraft[]
  >([]);

  // Dépile les équivalences confirmées pendant un aller-retour vers l'ajout
  // de boîte : elles ne peuvent être enregistrées qu'une fois le traitement
  // effectivement créé, faute d'identifiant avant cela.
  useFocusEffect(
    useCallback(() => {
      const drained = drainPendingGenericEquivalenceDrafts();
      if (drained.length > 0)
        setPendingEquivalences((previous) => [...previous, ...drained]);
    }, []),
  );

  return (
    <>
      <TreatmentForm
        initialValue={{
          ...base,
          dosageKind: 'SCHEDULED',
          includedInPillbox,
          phases: [],
          asNeededInfo: {
            maxQuantityPerDayHalfUnits: null,
            minIntervalHours: null,
          },
        }}
        onSubmit={async (draft) => {
          const treatmentId = await createTreatment(database, draft);
          await synchronizeTreatmentIntakeReminders(database, treatmentId);
          for (const equivalence of pendingEquivalences) {
            await confirmGenericEquivalence(database, {
              treatmentId,
              cis: equivalence.cis,
              specialtyName: equivalence.specialtyName,
              groupLabel: equivalence.groupLabel,
            });
          }
          setCreatedTreatment({
            id: treatmentId,
            specialtyCis: draft.specialtyCis,
            specialtyName: draft.specialtyName,
          });
        }}
        pendingEquivalenceCis={pendingEquivalences.map(
          (equivalence) => equivalence.cis,
        )}
        personalDatabase={database}
        showPillboxToggle={false}
        submitLabel="Créer le traitement"
        treatmentId={null}
      />
      {createdTreatment ? (
        <TreatmentBoxGenericMatch
          onDone={() => finishTreatmentCreation(createdTreatment.id)}
          personalDatabase={database}
          specialtyCis={createdTreatment.specialtyCis}
          specialtyName={createdTreatment.specialtyName}
          treatmentId={createdTreatment.id}
        />
      ) : null}
    </>
  );
}
