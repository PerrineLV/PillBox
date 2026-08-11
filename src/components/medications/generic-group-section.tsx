import medicationReferenceAsset from '../../../assets/medications/medications.db';
import { SQLiteProvider, useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  getGenericGroupMembers,
  type GenericGroupMember,
} from '@/infrastructure/medications/medication-reference';
import { Card, colors, spacing, typography } from '@/ui';

/**
 * Section purement informative : liste les autres membres du groupe
 * générique officiel (BDPM) d'une spécialité, s'il en existe un. N'affiche
 * rien si la spécialité n'appartient à aucun groupe. Ne propose aucune
 * action de remplacement de médicament, de boîte ou de ligne de stock.
 *
 * Suppose que la connexion `medication-reference.db` est déjà fournie par
 * un `SQLiteProvider` ancêtre (voir `GenericGroupSectionWithDatabase` sinon).
 */
export function GenericGroupSection({ cis }: { cis: string }) {
  const database = useSQLiteContext();
  const [members, setMembers] = useState<GenericGroupMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    getGenericGroupMembers(database, cis)
      .then((next) => {
        if (!cancelled) setMembers(next);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [database, cis]);

  if (members.length === 0) return null;

  const groups = new Map<string, GenericGroupMember[]>();
  for (const member of members) {
    const bucket = groups.get(member.groupId) ?? [];
    bucket.push(member);
    groups.set(member.groupId, bucket);
  }

  return (
    <Card tone="muted" style={styles.card}>
      <Text style={styles.title}>Groupe générique</Text>
      <Text style={styles.disclaimer}>
        Information issue de la BDPM, à titre indicatif. Ce n’est pas une
        recommandation de substitution : PillBox ne remplace et ne suggère de
        remplacer aucun médicament, boîte ou ligne de stock.
      </Text>
      {[...groups.values()].map((groupMembers) => (
        <View key={groupMembers[0].groupId} style={styles.group}>
          <Text style={styles.groupLabel}>{groupMembers[0].groupLabel}</Text>
          {groupMembers.map((member) => (
            <Text key={member.cis} style={styles.member}>
              {member.name ?? 'Nom indisponible dans le référentiel'} — CIS{' '}
              {member.cis} — type source : {member.type ?? 'non renseigné'}
            </Text>
          ))}
        </View>
      ))}
    </Card>
  );
}

/**
 * Variante autonome pour les écrans qui n'ont pas déjà de connexion ouverte
 * vers `medication-reference.db` (le référentiel médicaments, distinct de
 * `pillbox.db`). Ouvre sa propre connexion, scoped à cette sous-arborescence.
 */
export function GenericGroupSectionWithDatabase({ cis }: { cis: string }) {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{ assetId: medicationReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <GenericGroupSection cis={cis} />
    </SQLiteProvider>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.sm },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  group: { marginTop: spacing.xs },
  groupLabel: { fontWeight: '700' },
  member: { color: colors.text, marginTop: 2 },
  title: { ...typography.heading, marginBottom: spacing.xs },
});
