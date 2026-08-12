import medicationReferenceAsset from '../../../assets/medications/medications.db';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  computeTheoreticalRenewalDate,
  defaultControlledDispensingInfo,
  type ControlledDispensingInfo,
} from '@/domain/treatments/treatment';
import { detectControlledDispensingMention } from '@/infrastructure/medications/medication-reference';
import { AppField, Card, colors, spacing, typography } from '@/ui';

import { DateField } from '../treatments/date-field';

type Props = {
  specialtyCis: string;
  value: ControlledDispensingInfo | null;
  onChange: (value: ControlledDispensingInfo) => void;
};

/**
 * Section informative de suivi d'une délivrance encadrée (ticket 30).
 * N'affiche rien tant que la détection BDPM (`CIS_CPD_bdpm`) n'a pas repéré
 * la spécialité. Une fois détectée, l'indicateur est pré-coché mais reste
 * modifiable ; rien de ceci n'est jamais activé silencieusement ni ne
 * conditionne le remplissage du pilulier ou la prévision de stock.
 *
 * Suppose que la connexion `medication-reference.db` est déjà fournie par
 * un `SQLiteProvider` ancêtre (voir `ControlledDispensingFieldWithDatabase`
 * sinon).
 */
export function ControlledDispensingField({
  specialtyCis,
  value,
  onChange,
}: Props) {
  const database = useSQLiteContext();
  const [detected, setDetected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetected(null);
    detectControlledDispensingMention(database, specialtyCis)
      .then((next) => {
        if (!cancelled) setDetected(next);
      })
      .catch(() => {
        if (!cancelled) setDetected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [database, specialtyCis]);

  // Pré-coché dès la détection, sans écraser un choix déjà enregistré
  // (activé ou explicitement décoché) pour ce traitement.
  useEffect(() => {
    if (detected === true && value === null)
      onChange(defaultControlledDispensingInfo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected]);

  if (detected !== true || value === null) return null;

  return (
    <Card tone="muted" style={styles.card}>
      <Text style={styles.title}>Délivrance encadrée</Text>
      <Text style={styles.disclaimer}>
        Spécialité repérée par la BDPM comme potentiellement soumise à une
        délivrance encadrée (stupéfiants et assimilés, délivrance fractionnée).
        Purement informatif : la date théorique n’empêche jamais un remplissage
        complet permis par le stock réel.
      </Text>
      <View style={styles.toggle}>
        <Text>Suivre la délivrance encadrée</Text>
        <Switch
          value={value.enabled}
          onValueChange={(enabled) => onChange({ ...value, enabled })}
        />
      </View>
      {value.enabled ? (
        <>
          <AppField
            label="Périodicité (jours entre deux délivrances)"
            inputMode="numeric"
            value={String(value.periodicityDays)}
            onChangeText={(text) =>
              onChange({
                ...value,
                periodicityDays: Number(text.trim().replace(',', '.')),
              })
            }
          />
          <DateField
            label="Dernière délivrance"
            value={value.lastDispensedAt ?? ''}
            onChange={(nextDate) => {
              if (nextDate === '') {
                onChange({ ...value, lastDispensedAt: null });
                return;
              }
              onChange({
                ...value,
                lastDispensedAt: nextDate,
                theoreticalRenewalDate: isSafePositiveInteger(
                  value.periodicityDays,
                )
                  ? computeTheoreticalRenewalDate(
                      nextDate,
                      value.periodicityDays,
                    )
                  : value.theoreticalRenewalDate,
              });
            }}
          />
          <DateField
            label="Renouvellement théorique"
            value={value.theoreticalRenewalDate ?? ''}
            onChange={(nextDate) =>
              onChange({
                ...value,
                theoreticalRenewalDate: nextDate === '' ? null : nextDate,
              })
            }
          />
          <Text style={styles.hint}>
            Recalculée automatiquement depuis la dernière délivrance, mais
            modifiable directement pour un chevauchement exceptionnel
            d’ordonnances.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Variante autonome pour les écrans qui n'ont pas déjà de connexion ouverte
 * vers `medication-reference.db` (le référentiel médicaments, distinct de
 * `pillbox.db`). Ouvre sa propre connexion, scoped à cette sous-arborescence.
 */
export function ControlledDispensingFieldWithDatabase(props: Props) {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <ControlledDispensingField {...props} />
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginTop: spacing.sm },
  disclaimer: { color: colors.textMuted, fontSize: 13 },
  hint: typography.caption,
  title: { ...typography.heading },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
});
