import { Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type {
  BoxVerification,
  BoxVerificationMethod,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import { AppButton, Badge } from '@/ui';

import { styles } from './styles';

export type PendingBox = Readonly<{
  method: BoxVerificationMethod;
  /** Preuve brute du DataMatrix, absente lorsque la boîte est choisie dans le stock. */
  raw: string | null;
  verification: Extract<BoxVerification, { status: 'VALID' | 'PARTIAL' }>;
  /** Renseigné lorsque la boîte est un autre membre du groupe générique attendu, confirmé. */
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

export function BoxConfirmation({
  pending,
  saving,
  onRestart,
  onValidate,
}: {
  pending: PendingBox;
  saving: boolean;
  onRestart(): void;
  onValidate(acknowledgeNonFefo: boolean): Promise<void>;
}) {
  const { verification } = pending;
  const scanned = pending.method === 'SCAN';

  if (verification.status === 'PARTIAL') {
    const { box, quantityHalfUnits, remainingAfterHalfUnits } = verification;
    return (
      <View style={styles.warning}>
        <Text style={styles.warningTitle}>
          Boîte insuffisante seule : contribution partielle
        </Text>
        <Badge
          label={
            scanned
              ? 'Vérifiée par scan DataMatrix'
              : 'Choisie dans le stock, sans scan'
          }
          tone={scanned ? 'success' : 'warning'}
        />
        <Text>
          Lot {box.lot ?? 'non renseigné'} · péremption{' '}
          {formatLongFrenchCivilDate(box.expirationDate)}
        </Text>
        {pending.matchedSpecialtyName ? (
          <Badge
            label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
            tone="warning"
          />
        ) : null}
        <Text>
          Cette boîte couvre {formatHalfUnits(quantityHalfUnits)}. Il restera{' '}
          {formatHalfUnits(remainingAfterHalfUnits)} à couvrir avec une seconde
          boîte.
        </Text>
        <AppButton
          loading={saving}
          label="Utiliser cette boîte entièrement"
          onPress={() => void onValidate(false)}
        />
        <AppButton
          label={
            scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'
          }
          variant="secondary"
          onPress={onRestart}
        />
      </View>
    );
  }

  const { box, isFefo, recommendedBox } = verification;
  return (
    <View style={isFefo ? styles.verified : styles.warning}>
      <Text style={styles.warningTitle}>
        {isFefo
          ? 'Boîte vérifiée'
          : 'Boîte valide, mais un autre lot périme plus tôt'}
      </Text>
      <Badge
        label={
          scanned
            ? 'Vérifiée par scan DataMatrix'
            : 'Choisie dans le stock, sans scan'
        }
        tone={scanned ? 'success' : 'warning'}
      />
      <Text>
        Lot {box.lot ?? 'non renseigné'} · péremption{' '}
        {formatLongFrenchCivilDate(box.expirationDate)}
      </Text>
      {pending.matchedSpecialtyName ? (
        <Badge
          label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
          tone="warning"
        />
      ) : null}
      {!isFefo ? (
        <Text>
          Lot recommandé : {recommendedBox.lot ?? 'non renseigné'} · péremption{' '}
          {formatLongFrenchCivilDate(recommendedBox.expirationDate)}. Vous
          pouvez continuer en confirmant cet avertissement.
        </Text>
      ) : null}
      <AppButton
        loading={saving}
        label={
          isFefo ? 'Valider ce médicament' : 'Utiliser quand même cette boîte'
        }
        onPress={() => void onValidate(!isFefo)}
      />
      <AppButton
        label={scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'}
        variant="secondary"
        onPress={onRestart}
      />
    </View>
  );
}
