import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { APP_LOCK_GRACE_PERIOD_MS } from '@/domain/privacy/app-lock-policy';
import { readCrashLogs } from '@/infrastructure/logging/crash-logger';
import {
  isAppLockEnabled,
  setAppLockEnabled,
} from '@/infrastructure/privacy/app-lock-repository';
import {
  authenticateLocally,
  getLocalAuthAvailability,
} from '@/infrastructure/privacy/local-authentication';
import {
  AppScreen,
  Banner,
  DenseList,
  DenseRow,
  Section,
  ShieldIcon,
  StackHeader,
  Toggle,
  colors,
  typography,
  useToast,
} from '@/ui';

const GRACE_SECONDS = Math.round(APP_LOCK_GRACE_PERIOD_MS / 1000);

export default function PrivacyScreen() {
  const database = useSQLiteContext();
  const { showToast } = useToast();
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [crashCount, setCrashCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [enabled, entries] = await Promise.all([
      isAppLockEnabled(database),
      readCrashLogs(),
    ]);
    setLocked(enabled);
    setCrashCount(entries.length);
  }, [database]);

  useEffect(() => {
    void load().catch(() => {
      showToast(
        'Les réglages de confidentialité n’ont pas pu être lus.',
        'error',
      );
    });
  }, [load, showToast]);

  async function updateAppLock(next: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const availability = await getLocalAuthAvailability();
        if (availability !== 'available') {
          showToast(
            availability === 'not-enrolled'
              ? 'Configurez d’abord une biométrie sécurisée dans Android.'
              : 'L’authentification locale sécurisée n’est pas disponible sur cet appareil.',
            'warning',
          );
          return;
        }
        const result = await authenticateLocally();
        if (!result.success) {
          showToast(
            'Activation annulée : votre identité n’a pas été vérifiée.',
            'warning',
          );
          return;
        }
      }
      await setAppLockEnabled(database, next);
      setLocked(next);
      showToast(
        next ? 'Verrouillage local activé.' : 'Verrouillage local désactivé.',
        'success',
      );
    } catch {
      showToast(
        'Le réglage de verrouillage n’a pas pu être enregistré.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen
      header={
        <StackHeader
          subtitle="Vos données ne quittent jamais ce téléphone"
          title="Confidentialité"
        />
      }
    >
      <Section label="Verrou">
        <DenseList>
          <Toggle
            disabled={busy}
            help="Demande la biométrie sécurisée ou la sécurité de l’appareil via Android. Aucun code ni secret n’est stocké par PillBox."
            label="Verrou à l’ouverture"
            onChange={(next) => void updateAppLock(next)}
            value={locked}
          />
        </DenseList>
        <Text style={typography.micro}>
          {locked
            ? `L’authentification est demandée à chaque ouverture et après ${GRACE_SECONDS} secondes passées en arrière-plan. Un aller-retour rapide vers une autre application ne la redemande pas.`
            : 'Les données sont accessibles dès l’ouverture de l’application.'}
        </Text>
      </Section>

      <Banner
        icon={<ShieldIcon color={colors.brandPressed} size={17} />}
        level="ok"
      >
        Ce verrou protège l’accès courant à l’application ; il ne chiffre ni la
        base SQLite ni les fichiers exportés, qui restent protégés par le
        chiffrement du système Android.
      </Banner>

      <Section label="Ce que PillBox ne fait pas">
        <DenseList tone="muted">
          <DenseRow
            detail="Aucun compte, aucun serveur, aucune synchronisation : tout est enregistré localement."
            first
            title="Aucune donnée transmise"
          />
          <DenseRow
            detail="Aucune publicité, aucune mesure d’audience, aucun profilage."
            title="Aucun traceur"
          />
        </DenseList>
      </Section>

      <Section label="Diagnostic">
        <DenseList tone="muted">
          <DenseRow
            chevron
            detail="Crashs JavaScript uniquement, conservés sur ce téléphone."
            first
            href="/settings/error-log"
            title="Journal des erreurs"
            trailing={
              crashCount === null ? undefined : (
                <Text style={styles.count}>{crashCount}</Text>
              )
            }
          />
        </DenseList>
      </Section>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  count: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 11.5,
    fontWeight: '700',
    lineHeight: 14,
  },
});
