import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { IntakeRecord } from '@/domain/intakes/intake-tracking';
import type { TodaySlotEntry } from '@/domain/home/today-plan';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  formatSlotTime,
  nextIntakeEyebrow,
  slotProgressLabel,
  slotSettledLabel,
} from './next-intake-labels';
import {
  BellIcon,
  ChevronIcon,
  INTAKE_SLOT_LABELS,
  PillButton,
  colors,
  layout,
  onDarkSurfaces,
  radii,
  sizes,
  typography,
} from '@/ui';

export function HomeHeader({
  entry,
  nowMinutes,
  hasAlerts,
  busy,
  outsidePillboxTreatmentIds,
  onToggle,
  onValidateAll,
}: Readonly<{
  entry: TodaySlotEntry | null;
  nowMinutes: number;
  hasAlerts: boolean;
  busy: boolean;
  outsidePillboxTreatmentIds: ReadonlySet<number>;
  onToggle(record: IntakeRecord): void;
  onValidateAll(entry: TodaySlotEntry): void;
}>) {
  const settled = entry ? slotSettledLabel(entry) : null;
  // La validation groupée ne touche jamais une prise hors pilulier : celle-ci
  // exige de désigner la boîte utilisée. Proposer « Tout valider » laisserait
  // croire qu'elle a été prise en compte.
  const groupValidatable =
    entry !== null &&
    entry.pendingCount > 0 &&
    !entry.records.some(
      (record) =>
        record.status === 'UNSET' &&
        outsidePillboxTreatmentIds.has(record.treatmentId),
    );
  return (
    <View style={styles.header}>
      <View style={styles.brandBar}>
        <View style={styles.brand}>
          <View accessibilityElementsHidden style={styles.mark}>
            <View style={styles.markTop} />
            <View style={styles.markBottom} />
          </View>
          <Text accessibilityRole="header" style={styles.brandName}>
            PillBox
          </Text>
        </View>
        <Pressable
          accessibilityLabel={
            hasAlerts ? 'Voir le suivi, alertes en cours' : 'Voir le suivi'
          }
          accessibilityRole="button"
          onPress={() => router.navigate('/more')}
          style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
        >
          <BellIcon color={colors.onDark} size={19} strokeWidth={2} />
          {hasAlerts ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>

      {entry === null ? (
        <>
          <Text style={styles.eyebrow}>Aujourd’hui</Text>
          <Text style={styles.title}>Aucune prise prévue</Text>
          <Text style={styles.emptyHelp}>
            Les prises apparaissent ici dès qu’un traitement en programme.
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.eyebrow}>
            {nextIntakeEyebrow(entry, nowMinutes)}
          </Text>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title}>
              {INTAKE_SLOT_LABELS[entry.slot]} · {formatSlotTime(entry.time)}
            </Text>
            <Text style={styles.titleAside}>{slotProgressLabel(entry)}</Text>
          </View>

          <IntakeList
            busy={busy}
            entry={entry}
            key={entry.slot}
            onToggle={onToggle}
            outsidePillboxTreatmentIds={outsidePillboxTreatmentIds}
          />

          {groupValidatable ? (
            <PillButton
              disabled={busy}
              height={46}
              label={`✓ ${groupValidationLabel(entry)}`}
              onPress={() => onValidateAll(entry)}
              tone="onDark"
            />
          ) : null}
          {settled !== null ? (
            <Text style={styles.settled}>{settled}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * Médicaments du créneau, repliés par défaut : l'en-tête annonce leur nombre
 * et laisse la liste s'ouvrir à la demande. Sa hauteur ne dépend donc plus de
 * l'ordonnance, et la validation groupée reste toujours à portée.
 *
 * Le repli est purement visuel : « Tout valider » porte sur l'ensemble du
 * créneau, liste ouverte ou fermée.
 */
function IntakeList({
  entry,
  busy,
  outsidePillboxTreatmentIds,
  onToggle,
}: Readonly<{
  entry: TodaySlotEntry;
  busy: boolean;
  outsidePillboxTreatmentIds: ReadonlySet<number>;
  onToggle(record: IntakeRecord): void;
}>) {
  const [expanded, setExpanded] = useState(false);
  const count = entry.records.length;
  // Replier un médicament unique coûterait deux appuis là où un suffit, sans
  // rien gagner en hauteur : la ligne d'ouverture prendrait la place de la
  // ligne qu'elle masque.
  const open = expanded || count === 1;
  return (
    <View style={styles.list}>
      {open
        ? entry.records.map((record, index) => (
            <IntakeLine
              key={record.key}
              busy={busy}
              first={index === 0}
              needsBoxChoice={outsidePillboxTreatmentIds.has(
                record.treatmentId,
              )}
              onToggle={onToggle}
              record={record}
            />
          ))
        : null}
      {count > 1 ? (
        <Pressable
          accessibilityLabel={
            expanded ? 'Réduire la liste' : `Afficher ${countLabel(count)}`
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
          style={({ pressed }) => [
            styles.line,
            expanded && styles.lineDivided,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.moreText}>
            {expanded ? 'Réduire' : countLabel(count)}
          </Text>
          <ChevronIcon
            color={colors.onDarkMuted}
            direction={expanded ? 'up' : 'down'}
            size={16}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function countLabel(count: number): string {
  return `${count} médicaments`;
}

function groupValidationLabel(entry: TodaySlotEntry): string {
  // « Tout » n'a de sens que face à plusieurs médicaments : le créneau qui
  // n'en compte qu'un se valide, simplement.
  if (entry.records.length === 1) return 'Valider';
  if (entry.pendingCount === entry.records.length) return 'Tout valider';
  return entry.pendingCount === 1
    ? 'Valider le dernier'
    : `Valider les ${entry.pendingCount} restants`;
}

function IntakeLine({
  record,
  first,
  busy,
  needsBoxChoice,
  onToggle,
}: Readonly<{
  record: IntakeRecord;
  first: boolean;
  busy: boolean;
  needsBoxChoice: boolean;
  onToggle(record: IntakeRecord): void;
}>) {
  const taken = record.status === 'TAKEN';
  const detail = [
    `${formatHalfUnits(record.quantityHalfUnits)} unité(s)`,
    record.pharmaceuticalForm,
    record.status === 'SKIPPED' ? 'Ignorée' : null,
    needsBoxChoice ? 'Boîte à désigner' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <Pressable
      accessibilityLabel={`${record.specialtyName}, ${detail}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: taken, disabled: busy }}
      disabled={busy}
      onPress={() => onToggle(record)}
      style={({ pressed }) => [
        styles.line,
        !first && styles.lineDivided,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.lineText}>
        <Text style={styles.lineName}>{record.specialtyName}</Text>
        <Text style={styles.lineDetail}>{detail}</Text>
      </View>
      <View style={[styles.checkbox, taken && styles.checkboxChecked]}>
        {taken ? (
          <Text accessibilityElementsHidden style={styles.checkboxMark}>
            ✓
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.headerDark,
    borderBottomLeftRadius: radii.headerCurve,
    borderBottomRightRadius: radii.headerCurve,
    gap: 12,
    paddingBottom: 22,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 8,
  },
  brandBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: sizes.minTouch,
  },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  mark: { height: 24, width: 15 },
  markTop: {
    backgroundColor: colors.accentOnDark,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    height: 12,
  },
  markBottom: {
    backgroundColor: colors.onDarkMuted,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    height: 12,
  },
  brandName: {
    color: colors.onDark,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  bell: {
    alignItems: 'center',
    backgroundColor: onDarkSurfaces.control,
    borderRadius: radii.pill,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  bellDot: {
    backgroundColor: colors.accentOnDark,
    borderColor: colors.headerDark,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    height: 10,
    position: 'absolute',
    right: 5,
    top: 5,
    width: 10,
  },
  eyebrow: { ...typography.sectionLabel, color: colors.onDarkMuted },
  titleRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  title: { ...typography.hero, color: colors.onDark },
  titleAside: {
    color: colors.onDarkMuted,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
  },
  emptyHelp: {
    color: colors.onDarkMuted,
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 17,
  },
  list: {
    backgroundColor: onDarkSurfaces.panel,
    borderColor: onDarkSurfaces.panelBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  line: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  lineDivided: {
    borderTopColor: onDarkSurfaces.hairline,
    borderTopWidth: 1,
  },
  lineText: { flex: 1, gap: 3, minWidth: 0 },
  moreText: {
    color: colors.onDarkMuted,
    flex: 1,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 17,
  },
  lineName: {
    color: colors.onDark,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
  },
  lineDetail: {
    color: colors.onDarkMuted,
    fontSize: 12.5,
    fontWeight: '500',
    lineHeight: 16,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: onDarkSurfaces.checkbox,
    borderRadius: radii.pill,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  checkboxChecked: {
    backgroundColor: colors.onDarkMuted,
    borderColor: colors.onDarkMuted,
  },
  checkboxMark: {
    color: colors.headerDark,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  settled: {
    color: colors.onDarkSoft,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 17,
  },
  pressed: { opacity: 0.72 },
});
