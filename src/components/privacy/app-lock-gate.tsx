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
import { Banner, LockIcon, PillButton, colors, radii, typography } from '@/ui';

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

  // La lecture du réglage reste directe, hors de la file d’exécution sérielle
  // des accès automatiques : elle conditionne l’affichage et attendre la fin
  // d’une synchronisation de rappels retarderait d’autant le déverrouillage. En
  // mode WAL, une lecture n’est jamais bloquée par une écriture en cours.
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
        <View accessibilityElementsHidden style={styles.mark}>
          <View style={styles.markTop} />
          <View style={styles.markBottom} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          PillBox
        </Text>
        <Text style={styles.help}>Contenu masqué.</Text>
      </View>
    );

  return (
    <View style={styles.container}>
      <View accessibilityElementsHidden style={styles.lockBadge}>
        <LockIcon color={colors.onDarkSoft} size={24} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        PillBox est verrouillée
      </Text>
      <Text style={styles.help}>
        Les données restent sur ce téléphone. PillBox ne stocke aucun code, mot
        de passe ni donnée biométrique.
      </Text>
      {message ? <Banner level="warning">{message}</Banner> : null}
      <PillButton
        disabled={busy}
        label="Déverrouiller avec Android"
        onPress={() => dispatch({ type: 'authentication-requested' })}
        tone="onDark"
      />
      {emergencyUnlock ? (
        <>
          <Text style={styles.help}>
            Pour éviter un blocage définitif après un changement de biométrie ou
            une indisponibilité du système, vous pouvez désactiver ce verrou
            local. Vos données ne seront pas supprimées.
          </Text>
          <PillButton
            disabled={busy}
            height={46}
            label="Désactiver le verrou local"
            onPress={() => void disableUnavailableLock()}
            tone="onDarkOutline"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.headerDark,
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 26,
  },
  lockBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 253, 249, 0.10)',
    borderRadius: radii.pill,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  mark: { height: 48, width: 30 },
  markTop: {
    backgroundColor: colors.accentOnDark,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    height: 24,
  },
  markBottom: {
    backgroundColor: colors.onDarkMuted,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
    height: 24,
  },
  title: {
    ...typography.hero,
    color: colors.onDark,
    fontSize: 28,
    lineHeight: 32,
  },
  help: {
    color: colors.onDarkMuted,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
});
