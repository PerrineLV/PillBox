import {
  APP_LOCK_GRACE_PERIOD_MS,
  initialAppLockState,
  isAppLockScreenVisible,
  isSensitiveContentVisible,
  reduceAppLock,
  shouldPromptAuthentication,
  type AppLockEvent,
  type AppLockState,
} from '../app-lock-policy';

function apply(events: readonly AppLockEvent[]): AppLockState {
  return events.reduce(reduceAppLock, initialAppLockState);
}

const COLD_START_WITH_LOCK: readonly AppLockEvent[] = [
  { type: 'settings-loaded', lockEnabled: true },
];

const UNLOCKED: readonly AppLockEvent[] = [
  ...COLD_START_WITH_LOCK,
  { type: 'authentication-started' },
  { type: 'authentication-succeeded' },
];

describe('ouverture à froid', () => {
  it('masque le contenu tant que le réglage n’est pas connu', () => {
    expect(isSensitiveContentVisible(initialAppLockState)).toBe(false);
    expect(shouldPromptAuthentication(initialAppLockState)).toBe(false);
  });

  it('exige toujours une authentification quand le verrou est activé', () => {
    const state = apply(COLD_START_WITH_LOCK);
    expect(isSensitiveContentVisible(state)).toBe(false);
    expect(isAppLockScreenVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(true);
  });

  it('affiche directement les données quand le verrou est désactivé', () => {
    const state = apply([{ type: 'settings-loaded', lockEnabled: false }]);
    expect(isSensitiveContentVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });

  it('ne conserve aucun déverrouillage antérieur : l’état initial repart verrouillé', () => {
    const previous = apply(UNLOCKED);
    expect(isSensitiveContentVisible(previous)).toBe(true);
    expect(isSensitiveContentVisible(initialAppLockState)).toBe(false);
  });
});

describe('authentification', () => {
  it('ne redemande pas de prompt pendant que la boîte de dialogue est ouverte', () => {
    const state = apply([
      ...COLD_START_WITH_LOCK,
      { type: 'authentication-started' },
    ]);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });

  it('ne relance pas automatiquement le prompt après une annulation', () => {
    const state = apply([
      ...COLD_START_WITH_LOCK,
      { type: 'authentication-started' },
      { type: 'authentication-dismissed' },
    ]);
    expect(isAppLockScreenVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });

  it('relance le prompt uniquement sur demande explicite après une annulation', () => {
    const state = apply([
      ...COLD_START_WITH_LOCK,
      { type: 'authentication-started' },
      { type: 'authentication-dismissed' },
      { type: 'authentication-requested' },
    ]);
    expect(shouldPromptAuthentication(state)).toBe(true);
  });

  it('ignore le passage en arrière-plan provoqué par la boîte de dialogue système', () => {
    const state = apply([
      ...COLD_START_WITH_LOCK,
      { type: 'authentication-started' },
      { type: 'app-backgrounded', at: 1_000 },
      {
        type: 'app-foregrounded',
        at: 1_000 + APP_LOCK_GRACE_PERIOD_MS * 10,
        lockEnabled: true,
      },
      { type: 'authentication-succeeded' },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
  });
});

describe('cycle de vie Android', () => {
  it('masque immédiatement le contenu dès que l’app n’est plus au premier plan', () => {
    const state = apply([...UNLOCKED, { type: 'app-backgrounded', at: 1_000 }]);
    expect(isSensitiveContentVisible(state)).toBe(false);
    expect(isAppLockScreenVisible(state)).toBe(false);
  });

  it('ne masque pas l’aperçu quand le verrou est désactivé', () => {
    const state = apply([
      { type: 'settings-loaded', lockEnabled: false },
      { type: 'app-backgrounded', at: 1_000 },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
  });

  it('ne redemande pas d’authentification après un aller-retour bref', () => {
    const state = apply([
      ...UNLOCKED,
      { type: 'app-backgrounded', at: 1_000 },
      {
        type: 'app-foregrounded',
        at: 1_000 + APP_LOCK_GRACE_PERIOD_MS - 1,
        lockEnabled: true,
      },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });

  it('reverrouille après une absence prolongée', () => {
    const state = apply([
      ...UNLOCKED,
      { type: 'app-backgrounded', at: 1_000 },
      {
        type: 'app-foregrounded',
        at: 1_000 + APP_LOCK_GRACE_PERIOD_MS,
        lockEnabled: true,
      },
    ]);
    expect(isAppLockScreenVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(true);
  });

  it('cumule plusieurs passages brefs sans reverrouiller inutilement', () => {
    const state = apply([
      ...UNLOCKED,
      { type: 'app-backgrounded', at: 1_000 },
      { type: 'app-foregrounded', at: 2_000, lockEnabled: true },
      { type: 'app-backgrounded', at: 3_000 },
      { type: 'app-foregrounded', at: 4_000, lockEnabled: true },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
  });

  it('ne reverrouille jamais quand le verrou est désactivé', () => {
    const state = apply([
      { type: 'settings-loaded', lockEnabled: false },
      { type: 'app-backgrounded', at: 1_000 },
      {
        type: 'app-foregrounded',
        at: 1_000 + APP_LOCK_GRACE_PERIOD_MS * 10,
        lockEnabled: false,
      },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });

  it('applique le verrou activé dans les réglages lors de l’absence suivante', () => {
    const state = apply([
      { type: 'settings-loaded', lockEnabled: false },
      { type: 'app-backgrounded', at: 1_000 },
      {
        type: 'app-foregrounded',
        at: 1_000 + APP_LOCK_GRACE_PERIOD_MS,
        lockEnabled: true,
      },
    ]);
    expect(isAppLockScreenVisible(state)).toBe(true);
  });
});

describe('changement de réglage', () => {
  it('déverrouille immédiatement lorsque le verrou est désactivé en secours', () => {
    const state = apply([
      ...COLD_START_WITH_LOCK,
      { type: 'authentication-started' },
      { type: 'authentication-dismissed' },
      { type: 'lock-setting-changed', lockEnabled: false },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
  });

  it('n’exige pas d’authentification immédiate lors de l’activation depuis les réglages', () => {
    const state = apply([
      { type: 'settings-loaded', lockEnabled: false },
      { type: 'lock-setting-changed', lockEnabled: true },
    ]);
    expect(isSensitiveContentVisible(state)).toBe(true);
    expect(shouldPromptAuthentication(state)).toBe(false);
  });
});
