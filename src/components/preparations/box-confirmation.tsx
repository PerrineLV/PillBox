import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { parseBoxContribution } from '@/domain/preparations/box-filling-guide';

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
  onValidate(
    acknowledgeNonFefo: boolean,
    quantityHalfUnits: number,
  ): Promise<void>;
}) {
  const { verification } = pending;
  const scanned = pending.method === 'SCAN';
  const partial = verification.status === 'PARTIAL';
  const isFefo = verification.status === 'VALID' && verification.isFefo;
  const level: SeverityLevel = partial || !isFefo ? 'high' : 'ok';
  const box = verification.box;
  const [quantity, setQuantity] = useState(
    formatHalfUnits(verification.quantityHalfUnits),
  );
  const quantityHalfUnits = parseBoxContribution(
    quantity,
    verification.quantityHalfUnits,
  );

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
          Cette boîte peut fournir au maximum{' '}
          {formatHalfUnits(verification.quantityHalfUnits)} unité(s).
        </Text>
      ) : isFefo ? (
        <Text style={[styles.body, { color: severityScale[level].text }]}>
          Cette boîte peut couvrir toutes les prises restantes. Confirmez
          uniquement la quantité réellement prélevée.
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

      <Text style={styles.body}>Quantité prélevée dans la boîte #{box.id}</Text>
      <TextInput
        accessibilityLabel="Quantité prélevée dans cette boîte"
        editable={!saving}
        keyboardType="decimal-pad"
        value={quantity}
        onChangeText={setQuantity}
        style={styles.input}
      />
      <Text style={styles.notice}>
        De 0,5 à {formatHalfUnits(verification.quantityHalfUnits)} unité(s).
        Confirmez ce prélèvement avant de scanner ou choisir la boîte suivante.
        Scanner une boîte ne signifie pas que la précédente est vide.
      </Text>
      {quantityHalfUnits === null ? (
        <Text style={styles.notice}>
          Saisissez une quantité valide, par pas de 0,5 unité.
        </Text>
      ) : null}
      {quantityHalfUnits !== null ? (
        <Text style={styles.body}>
          Après confirmation :{' '}
          {formatHalfUnits(
            verification.quantityHalfUnits +
              (verification.status === 'PARTIAL'
                ? verification.remainingAfterHalfUnits
                : 0) -
              quantityHalfUnits,
          )}{' '}
          unité(s) encore à répartir.
        </Text>
      ) : null}
      <PillButton
        disabled={saving || quantityHalfUnits === null}
        height={54}
        label={
          !partial && !isFefo
            ? 'Confirmer le prélèvement malgré l’avertissement'
            : 'Confirmer la quantité prélevée'
        }
        onPress={() => {
          if (quantityHalfUnits !== null)
            void onValidate(!partial && !isFefo, quantityHalfUnits);
        }}
        tone="accent"
      />
      <PillButton
        height={44}
        disabled={saving}
        label="Annuler ce choix sans enregistrer de prélèvement"
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
  input: {
    ...typography.itemTitle,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: 12,
  },
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
