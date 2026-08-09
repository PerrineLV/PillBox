import { canOfferEmergencyUnlock } from '../local-authentication';

describe('repli sûr du verrou local', () => {
  it.each([
    'not_available',
    'not_enrolled',
    'lockout',
    'passcode_not_set',
    'invalid_context',
  ] as const)('évite un blocage définitif pour %s', (error) => {
    expect(canOfferEmergencyUnlock(error)).toBe(true);
  });

  it('ne permet pas de contourner une simple annulation', () => {
    expect(canOfferEmergencyUnlock('user_cancel')).toBe(false);
    expect(canOfferEmergencyUnlock('authentication_failed')).toBe(false);
  });
});
