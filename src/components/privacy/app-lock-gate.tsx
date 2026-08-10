import { useSQLiteContext } from 'expo-sqlite';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import {
  initialAppLockState,
  isAppLockScreenVisible,
  isSensitiveContentVisible,
  reduceAppLock,
  shouldPromptAuthentication,
} from '@/domain/privacy/app-lock-policy';
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

export function AppLockGate({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const [state, dispatch] = useReducer(reduceAppLock, initialAppLockState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [emergencyUnlock, setEmergencyUnlock] = useState(false);
  // Évite qu’une lecture de réglage tardive ne rouvre le contenu après un
  // nouveau passage en arrière-plan.
  const foregroundGeneration = useRef(0);
  const lockEnabled = useRef(state.lockEnabled);
  const authenticating = useRef(false);

  useEffect(() => {
    lockEnabled.current = state.lockEnabled;
  }, [state.lockEnabled]);

  const authenticate = useCallback(async (): Promise<void> => {
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
        dispatch({ type: 'authentication-dismissed' });
        return;
      }
      const result = await authenticateLocally();
      if (result.success) {
        dispatch({ type: 'authentication-succeeded' });
        return;
      }
      setEmergencyUnlock(canOfferEmergencyUnlock(result.error));
      setMessage(
        result.error === 'user_cancel' || result.error === 'app_cancel'
          ? 'Déverrouillage annulé. PillBox reste verrouillée.'
          : 'PillBox n’a pas pu vérifier votre identité. Réessayez ou utilisez la sécurité Android proposée.',
      );
      dispatch({ type: 'authentication-dismissed' });
    } catch {
      setEmergencyUnlock(true);
      setMessage('La sécurité Android est momentanément indisponible.');
      dispatch({ type: 'authentication-dismissed' });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void isAppLockEnabled(database)
      .then((enabled) => {
        if (active) dispatch({ type: 'settings-loaded', lockEnabled: enabled });
      })
      .catch(() => {
        if (!active) return;
        dispatch({ type: 'settings-loaded', lockEnabled: false });
        setMessage('Le réglage du verrou local n’a pas pu être lu.');
      });
    return () => {
      active = false;
    };
  }, [database]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const at = Date.now();
      if (nextState !== 'active') {
        foregroundGeneration.current += 1;
        dispatch({ type: 'app-backgrounded', at });
        return;
      }
      const generation = (foregroundGeneration.current += 1);
      const resume = (enabled: boolean) => {
        if (foregroundGeneration.current === generation)
          dispatch({ type: 'app-foregrounded', at, lockEnabled: enabled });
      };
      void isAppLockEnabled(database)
        .then(resume)
        .catch(() => resume(lockEnabled.current));
    });
    return () => subscription.remove();
  }, [database]);

  const promptRequired = shouldPromptAuthentication(state);
  useEffect(() => {
    if (!promptRequired || authenticating.current) return;
    authenticating.current = true;
    dispatch({ type: 'authentication-started' });
    setBusy(true);
    void authenticate().finally(() => {
      authenticating.current = false;
      setBusy(false);
    });
  }, [authenticate, promptRequired]);

  async function disableUnavailableLock(): Promise<void> {
    setBusy(true);
    try {
      await setAppLockEnabled(database, false);
      dispatch({ type: 'lock-setting-changed', lockEnabled: false });
      setEmergencyUnlock(false);
      setMessage(null);
    } catch {
      setMessage('Le verrou local n’a pas pu être désactivé. Réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (isSensitiveContentVisible(state)) return children;

  if (!isAppLockScreenVisible(state))
    // Réglage encore inconnu, ou app quittée alors qu’elle était déverrouillée :
    // rien de sensible ne doit rester lisible dans l’aperçu des applications
    // récentes.
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          PillBox
        </Text>
        <Text style={styles.help}>Contenu masqué.</Text>
      </View>
    );

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
        onPress={() => dispatch({ type: 'authentication-requested' })}
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
