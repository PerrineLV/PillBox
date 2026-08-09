import * as LocalAuthentication from 'expo-local-authentication';

export type LocalAuthAvailability =
  'available' | 'not-enrolled' | 'unavailable';

export async function getLocalAuthAvailability(): Promise<LocalAuthAvailability> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware) return 'unavailable';
  return enrolled ? 'available' : 'not-enrolled';
}

export async function authenticateLocally(): Promise<LocalAuthentication.LocalAuthenticationResult> {
  return LocalAuthentication.authenticateAsync({
    biometricsSecurityLevel: 'strong',
    disableDeviceFallback: false,
    promptMessage: 'Déverrouiller PillBox',
    promptDescription: 'Confirmez votre identité avec la sécurité Android.',
    cancelLabel: 'Annuler',
  });
}

export function canOfferEmergencyUnlock(
  error: LocalAuthentication.LocalAuthenticationError,
): boolean {
  return [
    'not_available',
    'not_enrolled',
    'lockout',
    'passcode_not_set',
    'invalid_context',
  ].includes(error);
}
