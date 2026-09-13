import { Text, View } from 'react-native';

import { formatFrenchCivilPeriod } from '@/components/treatments/civil-date';
import type {
  PreparationWeek,
  PreparationWeekState,
} from '@/domain/preparations/preparation';
import { AppCard, Banner, PillButton, SectionLabel } from '@/ui';
import { styles } from './styles';

/**
 * Période unique à préparer. Le démarrage normal est automatique ; ce panneau
 * sert d'état explicite si la période est déjà traitée ou si une génération
 * automatique doit être retentée après une erreur.
 */
export function WeekChoice({
  week,
  selectedState,
  onStart,
}: {
  week: PreparationWeek;
  selectedState: PreparationWeekState;
  onStart(): void;
}) {
  return (
    <AppCard>
      <SectionLabel>Prochaine préparation</SectionLabel>
      <View style={styles.weekOptions}>
        <Text style={styles.weekOptionPeriod}>
          {formatFrenchCivilPeriod(week.startDate, week.endDate)}
        </Text>
      </View>
      {selectedState === 'ALREADY_PREPARED' ? (
        <Banner level="warning" title="Semaine déjà préparée">
          Une préparation validée existe déjà pour cette période.
        </Banner>
      ) : null}
      {selectedState === 'IN_PROGRESS' ? (
        <Banner level="warning" title="Préparation déjà commencée">
          Une préparation incomplète existe pour cette période. Elle est reprise
          automatiquement à l’ouverture de cet écran.
        </Banner>
      ) : null}
      {selectedState === 'AVAILABLE' ? (
        <PillButton label="Réessayer" onPress={onStart} />
      ) : null}
    </AppCard>
  );
}
