import { Text, View } from 'react-native';

import {
  formatFrenchWeekdayAndDate,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import { allocateItemCompletion } from '@/domain/preparations/pending-completion';
import { buildBoxFillingGuide } from '@/domain/preparations/box-filling-guide';
import type { MedicationBox } from '@/domain/inventory/inventory';
import type {
  MedicationRequirement,
  PreparationSnapshot,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import type { SavedPreparationProgress } from '@/infrastructure/preparations/preparation-repository';
import { AppCard, Banner, colors, radii, spacing, typography } from '@/ui';

import { SLOT_LABELS } from './labels';
import { styles } from './styles';

/**
 * Médicament en cours de vérification : le besoin restant tient compte des
 * boîtes déjà retenues dans cette préparation, lorsque la première s'est
 * terminée avant de couvrir toute la semaine.
 */
export type CurrentRequirement = MedicationRequirement & {
  remainingHalfUnits: number;
  contributions: readonly SavedPreparationProgress[];
};

export function MedicationStep({
  snapshot,
  current,
  boxes,
  theoreticalRenewalDate,
  pendingComplementEnabled,
}: {
  snapshot: PreparationSnapshot;
  current: CurrentRequirement;
  boxes: readonly MedicationBox[];
  theoreticalRenewalDate: string | null;
  /** État ticket 30b : réservé aux délivrances encadrées/fractionnées. */
  pendingComplementEnabled: boolean;
}) {
  const cases = snapshot.items.filter(
    (item) => item.specialtyCis === current.specialtyCis,
  );
  const expectedCoverage = allocateItemCompletion(
    cases,
    current.requiredHalfUnits - current.missingHalfUnits,
  );
  const pendingCases = expectedCoverage.filter(
    (item) => item.status === 'PENDING_COMPLEMENT',
  );
  const coveredCaseCount = expectedCoverage.length - pendingCases.length;
  const coverageLabel = `${coveredCaseCount} prise${coveredCaseCount > 1 ? 's' : ''} couverte${coveredCaseCount > 1 ? 's' : ''} sur ${cases.length}.`;
  const pendingCasesLabel = pendingCases
    .map(
      (item) =>
        `${formatFrenchWeekdayAndDate(item.date)} · ${SLOT_LABELS[item.slot]}`,
    )
    .join(' ; ');
  const shortageDescription = `${coverageLabel} Restent en attente de complément : ${pendingCasesLabel}.${
    theoreticalRenewalDate
      ? ` Selon l’ordonnance, un complément pourrait être demandé à partir du ${formatLongFrenchCivilDate(theoreticalRenewalDate)}. Cette date est indicative et ne garantit pas une délivrance.`
      : ''
  }`;
  const fillingGuide = buildBoxFillingGuide(
    cases,
    current.contributions,
    boxes,
  );
  return (
    <AppCard>
      <Text style={styles.stepName}>{current.specialtyName}</Text>
      {cases[0]?.pharmaceuticalForm ? (
        <Text style={styles.stepForm}>{cases[0].pharmaceuticalForm}</Text>
      ) : null}
      <View style={styles.stepTiles}>
        <View style={styles.stepTile}>
          <Text style={styles.stepTileLabel}>À déposer</Text>
          <Text style={styles.stepTileValue}>
            {formatHalfUnits(current.remainingHalfUnits)}
          </Text>
        </View>
        <View style={styles.stepTile}>
          <Text style={styles.stepTileLabel}>Cases</Text>
          <Text style={styles.stepTileValue}>{cases.length}</Text>
        </View>
      </View>
      {pendingComplementEnabled && pendingCases.length > 0 ? (
        <Banner level="warning" title="Stock insuffisant pour toute la semaine">
          {shortageDescription}
        </Banner>
      ) : null}
      {current.contributions.length > 0 ? (
        <Banner level="warning" title="Guidage de remplissage">
          <Text style={styles.case}>
            Les prises sont indiquées dans l’ordre chronologique. Le stock ne
            sera décrémenté qu’à la validation finale.
          </Text>
          {fillingGuide.map((step, index) => {
            const lot = step.box?.lot ?? 'non renseigné';
            return (
              <Text
                key={`${step.contribution.boxId}-${index}`}
                style={styles.case}
              >
                • Boîte #{step.contribution.boxId} · lot {lot} :{' '}
                {step.segments.length > 0
                  ? step.segments
                      .map(
                        (segment) =>
                          `${formatFrenchWeekdayAndDate(segment.item.date)} · ${SLOT_LABELS[segment.item.slot]} (${formatHalfUnits(segment.quantityHalfUnits)})`,
                      )
                      .join(' ; ')
                  : formatHalfUnits(step.contribution.quantityHalfUnits)}
                {step.remainingInBoxAfterHalfUnits !== null
                  ? `. Après validation, il restera ${formatHalfUnits(step.remainingInBoxAfterHalfUnits)} dans cette boîte.`
                  : '.'}
              </Text>
            );
          })}
          <Text style={styles.case}>
            Passez maintenant à une autre boîte pour couvrir :{' '}
            {formatHalfUnits(current.remainingHalfUnits)}
          </Text>
        </Banner>
      ) : null}
      <Text style={styles.casesTitle}>Cases concernées</Text>
      <Text style={typography.micro}>
        Pour ce médicament uniquement. « Remplie » suit les prélèvements
        confirmés, répartis dans l’ordre chronologique.
      </Text>
      {cases.map((item, index) => {
        const deposited = fillingGuide
          .flatMap((step) => step.segments)
          .filter((segment) => segment.item === item)
          .reduce((sum, segment) => sum + segment.quantityHalfUnits, 0);
        const remaining = item.quantityHalfUnits - deposited;
        const filled = remaining === 0;
        const status = filled
          ? '✓ Remplie'
          : deposited > 0
            ? '→ À compléter'
            : '→ À remplir';
        const quantity = filled
          ? `${formatHalfUnits(item.quantityHalfUnits)} déposée(s)`
          : `${formatHalfUnits(remaining)} à déposer${deposited > 0 ? ` · ${formatHalfUnits(deposited)} déjà déposée(s)` : ''}`;
        const label = `${formatFrenchWeekdayAndDate(item.date)} · ${SLOT_LABELS[item.slot]}`;
        return (
          <View
            accessible
            accessibilityLabel={`${label} : ${status}. ${quantity}.`}
            key={`${item.date}-${item.slot}-${index}`}
            style={{
              padding: spacing.md,
              gap: spacing.sm,
              borderRadius: radii.sm,
              borderWidth: filled ? 1 : 2,
              borderColor: filled ? colors.border : colors.brand,
              backgroundColor: filled ? colors.surface : colors.brandSoft,
            }}
          >
            <Text style={typography.itemTitle}>{status}</Text>
            <Text style={typography.detail}>{label}</Text>
            <Text style={typography.detail}>{quantity}</Text>
          </View>
        );
      })}
    </AppCard>
  );
}
