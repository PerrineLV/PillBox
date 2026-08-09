import { BottomNavigation } from '../components';

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  usePathname: () => '/inventory',
}));

describe('BottomNavigation', () => {
  it('expose quatre destinations explicites et sélectionne la route courante', () => {
    const rendered = JSON.stringify(BottomNavigation());
    expect(rendered).toContain('Accueil');
    expect(rendered).toContain('Traitements');
    expect(rendered).toContain('Stock');
    expect(rendered).toContain('Plus');
    expect(rendered).toContain('selected');
  });
});
