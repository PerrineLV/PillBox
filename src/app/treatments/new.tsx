import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  type Href,
} from 'expo-router';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
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
  nonBdpmProductKey,
  type ProductType,
} from '@/domain/treatments/treatment';
import {
  AppField,
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
  productSource?: 'BDPM' | 'COMPL_ALIM' | 'MANUAL';
  productType?: ProductType;
  externalId?: string | null;
  productNotes?: string | null;
};

const MANUAL_TYPES: readonly { value: ProductType; label: string }[] = [
  { value: 'SUPPLEMENT', label: 'Complément' },
  { value: 'MEDICATION', label: 'Médicament' },
  { value: 'OTHER', label: 'Autre' },
];

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
    source?: string;
    externalId?: string;
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
  const [manualKey] = useState(() => nonBdpmProductKey('MANUAL', randomUUID()));
  const [manualName, setManualName] = useState('');
  const [manualForm, setManualForm] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualType, setManualType] = useState<ProductType>('OTHER');

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

  if (
    params.source !== 'MANUAL' &&
    (params.source === 'COMPL_ALIM'
      ? !params.externalId || !params.name
      : !params.cis || !params.name)
  ) {
    return (
      <AppScreen header={<StackHeader title="Nouveau traitement" />}>
        <Message tone="error" title="Produit manquant">
          Revenez à la recherche pour choisir un produit du référentiel.
        </Message>
      </AppScreen>
    );
  }

  const base: SpecialtyBase = {
    specialtyCis:
      params.source === 'MANUAL'
        ? manualKey
        : params.source === 'COMPL_ALIM'
          ? nonBdpmProductKey('COMPL_ALIM', params.externalId ?? '')
          : (params.cis ?? ''),
    specialtyName:
      params.source === 'MANUAL' ? manualName.trim() : (params.name ?? ''),
    pharmaceuticalForm:
      (params.source === 'MANUAL' ? manualForm : params.form)?.trim() || null,
    productSource:
      params.source === 'MANUAL' || params.source === 'COMPL_ALIM'
        ? params.source
        : 'BDPM',
    productType:
      params.source === 'MANUAL'
        ? manualType
        : params.source === 'COMPL_ALIM'
          ? 'SUPPLEMENT'
          : 'MEDICATION',
    externalId:
      params.source === 'COMPL_ALIM' ? (params.externalId ?? null) : null,
    productNotes:
      params.source === 'MANUAL' ? manualNotes.trim() || null : null,
  };

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle={base.specialtyName || undefined}
          title="Nouveau traitement"
        />
      }
    >
      {params.source === 'MANUAL' ? (
        <Section label="Produit saisi manuellement">
          <AppField
            label="Nom du produit"
            value={manualName}
            onChangeText={setManualName}
          />
          <ChoicePills<ProductType>
            options={MANUAL_TYPES}
            value={manualType}
            onChange={setManualType}
          />
          <AppField
            label="Forme ou présentation (facultatif)"
            value={manualForm}
            onChangeText={setManualForm}
          />
          <AppField
            label="Informations complémentaires (facultatif)"
            value={manualNotes}
            onChangeText={setManualNotes}
          />
        </Section>
      ) : null}
      {params.source === 'COMPL_ALIM' ? (
        <Text style={typography.micro}>
          Complément alimentaire · Compl’Alim
        </Text>
      ) : null}
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
              ? 'La prise reste suivie et rappelée, mais le produit n’est pas déposé dans le pilulier.'
              : 'Le produit est déposé dans le pilulier lors de la préparation hebdomadaire.'}
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
          key={`${category}-${base.specialtyCis}`}
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
          if (base.productSource !== 'BDPM') {
            finishTreatmentCreation(treatmentId);
            return;
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
