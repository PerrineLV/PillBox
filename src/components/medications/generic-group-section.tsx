import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { groupNamedGenericGroupMembers } from '@/domain/medications/generic-group-display';
import {
  getGenericGroupMembers,
  type GenericGroupMember,
} from '@/infrastructure/medications/medication-reference';
import { useMedicationReferenceDatabase } from '@/infrastructure/medications/medication-reference-provider';
import { Card, colors, spacing, typography } from '@/ui';

/**
 * Section purement informative : liste les autres membres du groupe
 * générique officiel (BDPM) d'une spécialité, s'il en existe un. N'affiche
 * rien si la spécialité n'appartient à aucun groupe. Ne propose aucune
 * action de remplacement de médicament, de boîte ou de ligne de stock.
 *
 * Consomme la connexion `medication-reference.db` partagée par l'application.
 */
export function GenericGroupSection({ cis }: { cis: string }) {
  const database = useMedicationReferenceDatabase();
  const [members, setMembers] = useState<GenericGroupMember[]>([]);
  const [expanded, setExpanded] = useState(false);

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

  const groups = groupNamedGenericGroupMembers(members);
  if (groups.length === 0) return null;

  const memberCount = groups.reduce((total, group) => total + group.length, 0);
  const action = expanded ? 'Replier' : 'Déplier';

  return (
    <Card tone="muted" style={styles.card}>
      <Pressable
        accessibilityLabel={`${action} la section Groupe générique, ${memberCount} spécialité${memberCount > 1 ? 's' : ''}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={styles.header}
      >
        <Text style={styles.title}>Groupe générique</Text>
        <View style={styles.headerRight}>
          <Text style={styles.count}>
            {memberCount} spécialité{memberCount > 1 ? 's' : ''}
          </Text>
          <Text
            accessibilityElementsHidden
            style={[styles.chevron, expanded && styles.chevronExpanded]}
          >
            ›
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          <Text style={styles.disclaimer}>
            Information issue de la BDPM, à titre indicatif. Ce n’est pas une
            recommandation de substitution : PillBox ne remplace et ne suggère
            de remplacer aucun médicament, boîte ou ligne de stock.
          </Text>
          {groups.map((groupMembers) => (
            <View key={groupMembers[0].groupId} style={styles.group}>
              <Text style={styles.groupLabel}>
                {groupMembers[0].groupLabel}
              </Text>
              {groupMembers.map((member) => (
                <Text key={member.cis} style={styles.member}>
                  {member.name} — CIS {member.cis}
                  {member.type ? ` — type BDPM : ${member.type}` : ''}
                </Text>
              ))}
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

/**
 * Alias conservé pour les appelants existants : il utilise aussi la connexion
 * unique vers le référentiel médicaments.
 */
export function GenericGroupSectionWithDatabase({ cis }: { cis: string }) {
  return <GenericGroupSection cis={cis} />;
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.sm },
  chevron: {
    color: colors.brand,
    flexShrink: 0,
    fontSize: 22,
    marginLeft: spacing.xs,
  },
  chevronExpanded: { transform: [{ rotate: '90deg' }] },
  count: { color: colors.textMuted, fontSize: 13 },
  disclaimer: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  group: { marginTop: spacing.xs },
  groupLabel: { fontWeight: '700' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerRight: { alignItems: 'center', flexDirection: 'row' },
  member: { color: colors.text, marginTop: 2 },
  title: { ...typography.heading },
});
