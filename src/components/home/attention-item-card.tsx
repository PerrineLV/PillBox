import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  renewalAvailabilityLabel,
  renewalRuptureLabel,
  renewalUrgencyTone,
} from '@/components/inventory/renewal-labels';
import {
  formatFrenchCivilPeriod,
  formatFrenchDateTime,
  formatLongFrenchCivilDate,
} from '@/components/treatments/civil-date';
import type { AttentionItem } from '@/domain/home/attention-items';
import { formatHalfUnits } from '@/domain/treatments/treatment';
import {
  attentionItemActionLabel,
  attentionItemHref,
} from './attention-item-route';
import {
  Badge,
  Card,
  INTAKE_SLOT_LABELS,
  RENEWAL_URGENCY_LABELS,
  colors,
  radii,
  spacing,
  typography,
} from '@/ui';

export function AttentionItemCard({ item }: Readonly<{ item: AttentionItem }>) {
  const actionLabel = attentionItemActionLabel(item);
  return (
    <Link href={attentionItemHref(item)} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Card style={cardStyleFor(item)}>
          {AttentionItemContent({ item })}
          <View style={styles.actionRow}>
            <Text
              style={[
                styles.actionLabel,
                item.type === 'PREPARATION' && item.mode !== 'READY'
                  ? styles.onBrand
                  : null,
              ]}
            >
              {actionLabel}
            </Text>
            <Text
              accessibilityElementsHidden
              maxFontSizeMultiplier={1.2}
              style={[
                styles.chevron,
                item.type === 'PREPARATION' && item.mode !== 'READY'
                  ? styles.onBrand
                  : null,
              ]}
            >
              ›
            </Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

function cardStyleFor(item: AttentionItem) {
  if (item.type === 'PREPARATION' && item.mode !== 'READY') {
    return styles.preparationCard;
  }
  return undefined;
}

export function AttentionItemContent({
  item,
}: Readonly<{ item: AttentionItem }>) {
  switch (item.type) {
    case 'NEXT_INTAKE_GROUP':
      return NextIntakeGroupContent({ item });
    case 'PREPARATION':
      return PreparationContent({ item });
    case 'STOCK_RENEWAL':
      return StockRenewalContent({ item });
    case 'EXPIRATION':
      return ExpirationContent({ item });
    case 'AS_NEEDED_INFO':
      return AsNeededContent({ item });
    case 'PRESCRIPTION_EXPIRY':
      return PrescriptionExpiryContent({ item });
  }
}

function NextIntakeGroupContent({
  item,
}: Readonly<{ item: Extract<AttentionItem, { type: 'NEXT_INTAKE_GROUP' }> }>) {
  const slots = [...new Set(item.groups.map((group) => group.slot))]
    .map((slot) => INTAKE_SLOT_LABELS[slot])
    .join(' et ');
  return (
    <>
      <Badge label="Prochaine prise" tone="neutral" />
      <Text style={typography.heading}>{slots}</Text>
      <Text style={typography.body}>
        {formatFrenchDateTime(item.scheduledAt)} · {item.medicationCount}{' '}
        médicament{item.medicationCount > 1 ? 's' : ''} prévu
        {item.medicationCount > 1 ? 's' : ''}
      </Text>
    </>
  );
}

function PreparationContent({
  item,
}: Readonly<{ item: Extract<AttentionItem, { type: 'PREPARATION' }> }>) {
  const period = formatFrenchCivilPeriod(item.startDate, item.endDate);
  if (item.mode === 'READY') {
    return (
      <>
        <Badge label="Prête" tone="success" />
        <Text style={typography.title}>Semaine préparée</Text>
        <Text style={typography.body}>
          Rien à faire pour l’instant. Prochaine préparation {period}.
        </Text>
      </>
    );
  }
  if (item.mode === 'RESUME') {
    return (
      <>
        <Badge label="Préparation en cours" tone="warning" />
        <Text style={[typography.title, styles.onBrand]}>
          Pilulier {period}
        </Text>
        <Text style={[typography.body, styles.onBrand]}>
          {item.completedCount} médicament{item.completedCount > 1 ? 's' : ''}{' '}
          vérifié{item.completedCount > 1 ? 's' : ''} sur {item.totalCount}.
          Votre progression est enregistrée.
        </Text>
      </>
    );
  }
  return (
    <>
      <Badge label="Prochaine préparation" tone="neutral" />
      <Text style={[typography.title, styles.onBrand]}>
        Préparer les 7 prochains jours
      </Text>
      <Text style={[typography.body, styles.onBrand]}>
        Vérifiez chaque boîte et chaque lot avant la validation finale.
      </Text>
    </>
  );
}

function StockRenewalContent({
  item,
}: Readonly<{ item: Extract<AttentionItem, { type: 'STOCK_RENEWAL' }> }>) {
  const rupture = renewalRuptureLabel(item.item);
  return (
    <>
      <Text style={typography.heading}>{item.item.specialtyName}</Text>
      <Badge
        label={RENEWAL_URGENCY_LABELS[item.item.urgency]}
        tone={renewalUrgencyTone(item.item.urgency)}
      />
      <Text style={typography.body}>{renewalAvailabilityLabel(item.item)}</Text>
      {rupture !== null ? (
        <Text style={typography.caption}>{rupture}</Text>
      ) : null}
    </>
  );
}

function ExpirationContent({
  item,
}: Readonly<{ item: Extract<AttentionItem, { type: 'EXPIRATION' }> }>) {
  return (
    <>
      <Text style={typography.heading}>{item.specialtyName}</Text>
      <Badge label="Péremption proche" tone="warning" />
      <Text style={typography.body}>
        Lot {item.lot ?? 'non renseigné'} : péremption le{' '}
        {formatLongFrenchCivilDate(item.expirationDate)}.
      </Text>
    </>
  );
}

function AsNeededContent({
  item,
}: Readonly<{ item: Extract<AttentionItem, { type: 'AS_NEEDED_INFO' }> }>) {
  return (
    <>
      <Text style={typography.heading}>{item.specialtyName}</Text>
      <Badge label="Si besoin" tone="neutral" />
      <Text style={typography.body}>
        {item.lastIntake
          ? `Dernière prise : ${formatFrenchDateTime(item.lastIntake.takenAt)} · ${formatHalfUnits(item.lastIntake.quantityHalfUnits)} unité(s)`
          : 'Aucune prise enregistrée pour l’instant.'}
      </Text>
    </>
  );
}

function PrescriptionExpiryContent({
  item,
}: Readonly<{
  item: Extract<AttentionItem, { type: 'PRESCRIPTION_EXPIRY' }>;
}>) {
  return (
    <>
      <Text style={typography.heading}>{item.label}</Text>
      <Badge label="Fin de validité proche" tone="warning" />
      <Text style={typography.body}>
        Valide jusqu’au {formatLongFrenchCivilDate(item.validUntil)} : pensez à
        consulter pour une nouvelle ordonnance.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  actionLabel: { color: colors.brand, fontWeight: '700' },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  chevron: { color: colors.brand, flexShrink: 0, fontSize: 22 },
  onBrand: { color: colors.surface },
  preparationCard: {
    backgroundColor: colors.brand,
    borderColor: colors.brandPressed,
    borderRadius: radii.lg,
    gap: spacing.md,
    padding: spacing.xl,
  },
  pressed: { opacity: 0.72 },
});
