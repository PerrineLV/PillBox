import { Pressable, Text, View } from 'react-native';

import { formatFrenchCivilPeriod } from '@/components/treatments/civil-date';
import {
  preparationWeekState,
  type KnownPreparation,
  type PreparationWeek,
  type PreparationWeekChoice,
  type PreparationWeekState,
} from '@/domain/preparations/preparation';
import { AppCard, Banner, PillButton, SectionLabel, SeverityBadge } from '@/ui';

import { WEEK_LABELS } from './labels';
import { styles } from './styles';

/**
 * Choix explicite de la semaine à préparer. La semaine à venir reste
 * sélectionnée par défaut ; une semaine déjà validée ne peut pas être relancée.
 */
export function WeekChoice({
  options,
  weeks,
  choice,
  selectedState,
  onChoose,
  onStart,
}: {
  options: readonly PreparationWeek[];
  weeks: readonly KnownPreparation[];
  choice: PreparationWeekChoice;
  selectedState: PreparationWeekState;
  onChoose(choice: PreparationWeekChoice): void;
  onStart(): void;
}) {
  return (
    <AppCard>
      <SectionLabel>Quelle semaine préparer ?</SectionLabel>
      <View accessibilityRole="radiogroup" style={styles.weekOptions}>
        {options.map((option) => {
          const state = preparationWeekState(option.startDate, weeks);
          const selected = option.choice === choice;
          return (
            <Pressable
              accessibilityLabel={`${WEEK_LABELS[option.choice]}, semaine ${formatFrenchCivilPeriod(option.startDate, option.endDate)}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={option.choice}
              onPress={() => onChoose(option.choice)}
              style={[styles.weekOption, selected && styles.weekOptionSelected]}
            >
              <Text style={styles.weekOptionTitle}>
                {WEEK_LABELS[option.choice]}
              </Text>
              <Text style={styles.weekOptionPeriod}>
                Semaine{' '}
                {formatFrenchCivilPeriod(option.startDate, option.endDate)}
              </Text>
              {state === 'ALREADY_PREPARED' ? (
                <SeverityBadge label="Déjà préparée" level="ok" />
              ) : null}
              {state === 'IN_PROGRESS' ? (
                <SeverityBadge label="Préparation en cours" level="warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {selectedState === 'ALREADY_PREPARED' ? (
        <Banner level="warning" title="Semaine déjà préparée">
          Une préparation validée existe déjà pour cette période. Choisissez une
          autre semaine plutôt que de créer un doublon.
        </Banner>
      ) : null}
      {selectedState === 'IN_PROGRESS' ? (
        <Banner level="warning" title="Préparation déjà commencée">
          Une préparation incomplète existe pour cette période. Reprenez-la
          depuis l’accueil plutôt que d’en créer une nouvelle.
        </Banner>
      ) : null}
      <PillButton
        disabled={selectedState !== 'AVAILABLE'}
        label="Générer la préparation de 7 jours"
        onPress={onStart}
      />
    </AppCard>
  );
}
