import { useSQLiteContext } from 'expo-sqlite';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import {
  isAppLockEnabled,
  setAppLockEnabled,
} from '@/infrastructure/privacy/app-lock-repository';
import {
  authenticateLocally,
  canOfferEmergencyUnlock,
  getLocalAuthAvailability,
} from '@/infrastructure/privacy/local-authentication';
import { AppButton, Message, colors, spacing, typography } from '@/ui';

type GateState = 'loading' | 'unlocked' | 'locked';

export function AppLockGate({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const [state, setState] = useState<GateState>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [emergencyUnlock, setEmergencyUnlock] = useState(false);

  const unlock = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setEmergencyUnlock(false);
    try {
      const availability = await getLocalAuthAvailability();
      if (availability !== 'available') {
        setEmergencyUnlock(true);
        setMessage(
          availability === 'not-enrolled'
            ? 'Aucune biométrie sécurisée n’est configurée dans Android.'
            : 'L’authentification locale sécurisée n’est pas disponible sur cet appareil.',
        );
        return;
      }
      const result = await authenticateLocally();
      if (result.success) {
        setState('unlocked');
        return;
      }
      setEmergencyUnlock(canOfferEmergencyUnlock(result.error));
      setMessage(
        result.error === 'user_cancel' || result.error === 'app_cancel'
          ? 'Déverrouillage annulé.'
          : 'PillBox n’a pas pu vérifier votre identité. Réessayez ou utilisez la sécurité Android proposée.',
      );
    } catch {
      setEmergencyUnlock(true);
      setMessage('La sécurité Android est momentanément indisponible.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void isAppLockEnabled(database)
      .then((enabled) => {
        if (!active) return;
        setState(enabled ? 'locked' : 'unlocked');
      })
      .catch(() => {
        if (active) {
          setState('unlocked');
          setMessage('Le réglage du verrou local n’a pas pu être lu.');
        }
      });
    return () => {
      active = false;
    };
  }, [database]);

  useEffect(() => {
    if (state !== 'locked') return;
    void unlock();
  }, [state, unlock]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        // Masque immédiatement les données dans l’aperçu du sélecteur Android,
        // puis réconcilie avec le réglage SQLite.
        setState('loading');
        void isAppLockEnabled(database)
          .then((enabled) => setState(enabled ? 'locked' : 'unlocked'))
          .catch(() => setState('unlocked'));
      }
    });
    return () => subscription.remove();
  }, [database]);

  async function disableUnavailableLock(): Promise<void> {
    setBusy(true);
    try {
      await setAppLockEnabled(database, false);
      setState('unlocked');
      setEmergencyUnlock(false);
      setMessage(null);
    } catch {
      setMessage('Le verrou local n’a pas pu être désactivé. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unlocked') return children;

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        PillBox est verrouillée
      </Text>
      <Text style={styles.help}>
        Les données restent sur ce téléphone. PillBox ne stocke aucun code, mot
        de passe ni donnée biométrique.
      </Text>
      {message ? <Message tone="warning">{message}</Message> : null}
      <AppButton
        label="Déverrouiller avec Android"
        loading={busy}
        onPress={() => void unlock()}
      />
      {emergencyUnlock ? (
        <>
          <Text style={styles.help}>
            Pour éviter un blocage définitif après un changement de biométrie ou
            une indisponibilité du système, vous pouvez désactiver ce verrou
            local. Vos données ne seront pas supprimées.
          </Text>
          <AppButton
            label="Désactiver le verrou local"
            variant="danger"
            disabled={busy}
            onPress={() => void disableUnavailableLock()}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  help: typography.body,
  title: typography.title,
});
