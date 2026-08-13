import { Pressable, Text, View } from 'react-native';

import { formatFrenchCivilPeriod } from '@/components/treatments/civil-date';
import {
  preparationWeekState,
  type KnownPreparation,
  type PreparationWeek,
  type PreparationWeekChoice,
  type PreparationWeekState,
} from '@/domain/preparations/preparation';
import { AppButton, Badge, Card, Message, SectionTitle } from '@/ui';

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
    <Card style={styles.card}>
      <SectionTitle>Quelle semaine préparer ?</SectionTitle>
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
                <Badge label="Déjà préparée" tone="success" />
              ) : null}
              {state === 'IN_PROGRESS' ? (
                <Badge label="Préparation en cours" tone="warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {selectedState === 'ALREADY_PREPARED' ? (
        <Message tone="warning" title="Semaine déjà préparée">
          Une préparation validée existe déjà pour cette période. Choisissez une
          autre semaine plutôt que de créer un doublon.
        </Message>
      ) : null}
      {selectedState === 'IN_PROGRESS' ? (
        <Message tone="warning" title="Préparation déjà commencée">
          Une préparation incomplète existe pour cette période. Reprenez-la
          depuis l’accueil plutôt que d’en créer une nouvelle.
        </Message>
      ) : null}
      <AppButton
        label="Générer la préparation de 7 jours"
        disabled={selectedState !== 'AVAILABLE'}
        onPress={onStart}
      />
    </Card>
  );
}
