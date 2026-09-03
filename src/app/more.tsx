import { useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { UpdateNoticeCard } from '@/components/updates/update-notice-card';
import { useUpdateNoticeState } from '@/components/updates/update-notice-provider';
import { todayIso } from '@/domain/inventory/inventory';
import { INTAKE_SLOTS } from '@/domain/treatments/treatment';
import { listPreparationHistory } from '@/infrastructure/preparations/preparation-repository';
import { listPrescriptions } from '@/infrastructure/prescriptions/prescription-repository';
import { installedAppVersion } from '@/infrastructure/updates/installed-version';
import {
  AppScreen,
  Banner,
  CalendarIcon,
  ClockIcon,
  DenseList,
  DenseRow,
  LockIcon,
  Section,
  ShieldIcon,
  TabHeader,
  ArrowIcon,
  BoxIcon,
  CapsuleIcon,
  colors,
  typography,
} from '@/ui';

type MenuEntry = Readonly<{
  href: Href;
  key: string;
  title: string;
  detail: string;
  icon: 'prescription' | 'calendar' | 'check' | 'clock' | 'lock' | 'backup';
}>;

const TRACKING: readonly MenuEntry[] = [
  {
    href: '/prescriptions',
    key: 'prescriptions',
    title: 'Ordonnances',
    detail: 'Créer, consulter et renouveler',
    icon: 'prescription',
  },
  {
    href: '/preparations/history',
    key: 'preparations',
    title: 'Préparations',
    detail: 'Piluliers terminés et lots utilisés',
    icon: 'calendar',
  },
  {
    href: '/intakes/history',
    key: 'intakes',
    title: 'Prises',
    detail: 'Statuts, reports et corrections',
    icon: 'check',
  },
];

const APPLICATION: readonly MenuEntry[] = [
  {
    href: '/settings/reminders',
    key: 'reminders',
    title: 'Rappels',
    detail: 'Heures de prise et rappel de préparation',
    icon: 'clock',
  },
  {
    href: '/settings/privacy',
    key: 'privacy',
    title: 'Confidentialité et verrou',
    detail: 'Verrou local et journal des erreurs',
    icon: 'lock',
  },
  {
    href: '/settings/backup',
    key: 'backup',
    title: 'Sauvegardes',
    detail: 'Exporter et restaurer vos données',
    icon: 'backup',
  },
];

export default function MoreScreen() {
  const database = useSQLiteContext();
  const update = useUpdateNoticeState();
  const [counts, setCounts] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([
        listPrescriptions(database, todayIso()),
        listPreparationHistory(database),
      ])
        .then(([prescriptions, preparations]) => {
          if (!active) return;
          const activePrescriptions = prescriptions.filter(
            (prescription) => prescription.status === 'ACTIVE',
          ).length;
          setCounts({
            prescriptions:
              activePrescriptions > 0
                ? `${activePrescriptions} active${activePrescriptions > 1 ? 's' : ''}`
                : '',
            preparations:
              preparations.length > 0
                ? `${preparations.length} validée${preparations.length > 1 ? 's' : ''}`
                : '',
            reminders: `${INTAKE_SLOTS.length} créneaux`,
          });
        })
        .catch(() => {
          // Les compteurs sont un confort : leur absence ne bloque pas l'accès
          // aux écrans, qui restent tous atteignables.
          if (active)
            setCounts({ reminders: `${INTAKE_SLOTS.length} créneaux` });
        });
      return () => {
        active = false;
      };
    }, [database]),
  );

  return (
    <AppScreen
      header={
        <TabHeader subtitle="Historique, suivi et réglages" title="Plus" />
      }
    >
      {update.notice !== null ? (
        <UpdateNoticeCard
          notice={update.notice}
          onDownload={update.download}
          onPostpone={update.postpone}
        />
      ) : null}

      <MenuGroup entries={TRACKING} counts={counts} title="Suivi" />
      <MenuGroup entries={APPLICATION} counts={counts} title="Application" />

      <Banner
        icon={<ShieldIcon color={colors.brandPressed} size={18} />}
        level="ok"
      >
        Vos données restent enregistrées uniquement sur ce téléphone.
      </Banner>
      <InstalledVersion />
    </AppScreen>
  );
}

function MenuGroup({
  title,
  entries,
  counts,
}: Readonly<{
  title: string;
  entries: readonly MenuEntry[];
  counts: Record<string, string>;
}>) {
  return (
    <Section label={title}>
      <DenseList>
        {entries.map((entry, index) => {
          const count = counts[entry.key];
          return (
            <DenseRow
              accessibilityLabel={`${entry.title}. ${entry.detail}`}
              chevron
              detail={entry.detail}
              first={index === 0}
              href={entry.href}
              key={entry.key}
              leading={<MenuIcon icon={entry.icon} />}
              title={<Text style={styles.title}>{entry.title}</Text>}
              trailing={
                count ? <Text style={styles.count}>{count}</Text> : undefined
              }
            />
          );
        })}
      </DenseList>
    </Section>
  );
}

function MenuIcon({ icon }: Readonly<{ icon: MenuEntry['icon'] }>) {
  const color = colors.brand;
  if (icon === 'calendar') return <CalendarIcon color={color} />;
  if (icon === 'clock') return <ClockIcon color={color} />;
  if (icon === 'lock') return <LockIcon color={color} />;
  if (icon === 'backup') return <ArrowIcon color={color} direction="up" />;
  if (icon === 'check') return <CapsuleIcon color={color} />;
  return <BoxIcon color={color} />;
}

/** Version réellement installée, utile pour vérifier une mise à jour. */
function InstalledVersion() {
  const version = installedAppVersion();
  return (
    <Text style={styles.version}>
      {version === null
        ? 'Version installée indisponible'
        : `PillBox version ${version}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.itemTitle, fontSize: 15, lineHeight: 20 },
  count: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 14,
  },
  version: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 15,
    textAlign: 'center',
  },
});
