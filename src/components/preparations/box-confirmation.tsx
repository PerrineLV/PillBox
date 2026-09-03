import { StyleSheet, Text, View } from 'react-native';

import { formatLongFrenchCivilDate } from '@/components/treatments/civil-date';
import type {
  BoxVerification,
  BoxVerificationMethod,
} from '@/domain/preparations/preparation';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  BoxIcon,
  PillButton,
  SeverityBadge,
  colors,
  radii,
  severity as severityScale,
  typography,
  type SeverityLevel,
} from '@/ui';

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
  const partial = verification.status === 'PARTIAL';
  const isFefo = verification.status === 'VALID' && verification.isFefo;
  const level: SeverityLevel = partial || !isFefo ? 'high' : 'ok';
  const box = verification.box;

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: severityScale[level].background },
      ]}
    >
      <View style={styles.head}>
        <BoxIcon color={severityScale[level].text} size={19} />
        <Text style={[styles.title, { color: severityScale[level].text }]}>
          {partial
            ? 'Boîte insuffisante seule : contribution partielle'
            : isFefo
              ? `Boîte vérifiée · lot ${box.lot ?? 'non renseigné'}`
              : 'Boîte valide, mais un autre lot périme plus tôt'}
        </Text>
      </View>

      <SeverityBadge
        label={
          scanned
            ? 'Vérifiée par scan DataMatrix'
            : 'Choisie dans le stock, sans scan'
        }
        level={scanned ? 'ok' : 'warning'}
      />

      <Text style={[styles.body, { color: severityScale[level].text }]}>
        {scanned
          ? `Scannez le DataMatrix de la boîte réellement utilisée. Lot ${box.lot ?? 'non renseigné'}, péremption ${formatLongFrenchCivilDate(box.expirationDate)}.`
          : `Boîte choisie dans le stock : vérifiez le lot ${box.lot ?? 'non renseigné'} et la péremption du ${formatLongFrenchCivilDate(box.expirationDate)} sur la boîte que vous avez en main.`}
      </Text>

      {pending.matchedSpecialtyName ? (
        <SeverityBadge
          label={`Équivalence générique confirmée : ${pending.matchedSpecialtyName}`}
          level="warning"
        />
      ) : null}

      {partial ? (
        <Text style={[styles.body, { color: severityScale[level].text }]}>
          Cette boîte couvre {formatHalfUnits(verification.quantityHalfUnits)}.
          Il restera {formatHalfUnits(verification.remainingAfterHalfUnits)} à
          couvrir avec une seconde boîte.
        </Text>
      ) : isFefo ? (
        <Text style={[styles.body, { color: severityScale[level].text }]}>
          Cette boîte couvre toutes les prises restantes. Aucune autre boîte
          n’est nécessaire.
        </Text>
      ) : (
        <Text style={[styles.body, { color: severityScale[level].text }]}>
          Lot recommandé : {verification.recommendedBox.lot ?? 'non renseigné'}{' '}
          · péremption{' '}
          {formatLongFrenchCivilDate(
            verification.recommendedBox.expirationDate,
          )}
          . Vous pouvez continuer en confirmant cet avertissement.
        </Text>
      )}

      <PillButton
        disabled={saving}
        height={54}
        label={
          !partial && !isFefo
            ? 'Utiliser quand même cette boîte'
            : scanned
              ? 'Boîte scannée, cases remplies'
              : 'Boîte choisie, cases remplies'
        }
        onPress={() => void onValidate(!partial && !isFefo)}
        tone="accent"
      />
      <PillButton
        height={44}
        label={scanned ? 'Scanner une autre boîte' : 'Choisir une autre boîte'}
        onPress={onRestart}
        tone="outline"
      />
      <Text style={styles.notice}>
        Le stock ne sera décrémenté qu’à la validation finale.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radii.md, gap: 9, padding: 14 },
  head: { alignItems: 'flex-start', flexDirection: 'row', gap: 9 },
  title: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
    minWidth: 0,
  },
  body: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  notice: { ...typography.micro, color: colors.textMuted, textAlign: 'center' },
});
