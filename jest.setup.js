/**
 * Les écrans posent eux-mêmes leur marge de sécurité (`useSafeAreaInsets`).
 * Hors application, aucun fournisseur natif n'existe : les tests rendent donc
 * les écrans avec des marges nulles, ce qui n'enlève rien à ce qu'ils vérifient.
 */
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    ...actual,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 320, height: 640 }),
  };
});
