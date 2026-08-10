/**
 * Politique de verrouillage locale de PillBox.
 *
 * Toute la décision « faut-il masquer les données et redemander la sécurité
 * Android ? » est concentrée ici, sous forme d’un réducteur pur : l’interface
 * ne fait qu’émettre les événements du cycle de vie Android.
 *
 * L’état vit uniquement en mémoire : si Android tue le processus en
 * arrière-plan, le lancement suivant repart de `initialAppLockState` et
 * redemande donc une authentification, comme une ouverture à froid.
 */

/**
 * Délai d’absence au-delà duquel PillBox se reverrouille au retour au premier
 * plan. Une minute est la temporisation courante des applications contenant
 * des données sensibles : elle évite de redemander la biométrie pour un
 * aller-retour vers une autre app, sans laisser l’accès ouvert longtemps.
 */
export const APP_LOCK_GRACE_PERIOD_MS = 60_000;

export type AppLockPhase = 'unknown' | 'locked' | 'authenticating' | 'unlocked';

export type AppLockState = {
  /** Étape courante du verrou. */
  readonly phase: AppLockPhase;
  /** Dernière valeur connue du réglage « Verrouiller PillBox ». */
  readonly lockEnabled: boolean;
  /** L’application est-elle réellement au premier plan ? */
  readonly foreground: boolean;
  /** Horodatage du départ en arrière-plan alors que l’app était déverrouillée. */
  readonly awaySince: number | null;
  /** Une authentification doit-elle être déclenchée automatiquement ? */
  readonly promptPending: boolean;
};

export type AppLockEvent =
  /** Réglage lu au démarrage : l’app vient d’être ouverte à froid. */
  | { type: 'settings-loaded'; lockEnabled: boolean }
  /** Réglage modifié pendant l’usage (écran Réglages ou secours). */
  | { type: 'lock-setting-changed'; lockEnabled: boolean }
  /** L’utilisatrice demande explicitement un nouveau déverrouillage. */
  | { type: 'authentication-requested' }
  /** La boîte de dialogue système est ouverte. */
  | { type: 'authentication-started' }
  | { type: 'authentication-succeeded' }
  /** Échec, annulation ou indisponibilité de la sécurité Android. */
  | { type: 'authentication-dismissed' }
  | { type: 'app-backgrounded'; at: number }
  | { type: 'app-foregrounded'; at: number; lockEnabled: boolean };

export const initialAppLockState: AppLockState = {
  phase: 'unknown',
  lockEnabled: false,
  foreground: true,
  awaySince: null,
  promptPending: false,
};

export function reduceAppLock(
  state: AppLockState,
  event: AppLockEvent,
): AppLockState {
  switch (event.type) {
    case 'settings-loaded':
      return {
        ...state,
        lockEnabled: event.lockEnabled,
        phase: event.lockEnabled ? 'locked' : 'unlocked',
        promptPending: event.lockEnabled,
        awaySince: null,
      };
    case 'lock-setting-changed':
      if (event.lockEnabled) return { ...state, lockEnabled: true };
      return {
        ...state,
        lockEnabled: false,
        phase: 'unlocked',
        promptPending: false,
        awaySince: null,
      };
    case 'authentication-requested':
      if (state.phase !== 'locked') return state;
      return { ...state, promptPending: true };
    case 'authentication-started':
      return { ...state, phase: 'authenticating', promptPending: false };
    case 'authentication-succeeded':
      return {
        ...state,
        phase: 'unlocked',
        promptPending: false,
        awaySince: null,
      };
    case 'authentication-dismissed':
      // Aucune relance automatique : sinon la boîte de dialogue système
      // réapparaîtrait en boucle après une annulation.
      return { ...state, phase: 'locked', promptPending: false };
    case 'app-backgrounded':
      return {
        ...state,
        foreground: false,
        // Une absence provoquée par la boîte de dialogue d’authentification
        // ne doit pas compter comme un passage en arrière-plan.
        awaySince: state.phase === 'unlocked' ? event.at : state.awaySince,
      };
    case 'app-foregrounded': {
      const relock =
        state.phase === 'unlocked' &&
        event.lockEnabled &&
        state.awaySince !== null &&
        event.at - state.awaySince >= APP_LOCK_GRACE_PERIOD_MS;
      return {
        ...state,
        lockEnabled: event.lockEnabled,
        foreground: true,
        awaySince: null,
        phase: relock ? 'locked' : state.phase,
        promptPending: relock ? true : state.promptPending,
      };
    }
  }
}

/**
 * Les données de santé ne sont visibles que déverrouillées et, lorsque le
 * verrou est activé, uniquement au premier plan : l’aperçu du sélecteur
 * d’applications récentes ne doit rien laisser lire.
 */
export function isSensitiveContentVisible(state: AppLockState): boolean {
  if (state.phase !== 'unlocked') return false;
  return state.foreground || !state.lockEnabled;
}

export function isAppLockScreenVisible(state: AppLockState): boolean {
  return state.phase === 'locked' || state.phase === 'authenticating';
}

export function shouldPromptAuthentication(state: AppLockState): boolean {
  return state.phase === 'locked' && state.promptPending && state.foreground;
}
