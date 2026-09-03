import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useUpdateNoticeState } from '@/components/updates/update-notice-provider';
import MoreScreen from '../app/more';

jest.mock('@/components/updates/update-notice-provider', () => ({
  useUpdateNoticeState: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useFocusEffect: () => undefined,
  usePathname: () => '/more',
  router: { navigate: jest.fn() },
}));
jest.mock('@/infrastructure/prescriptions/prescription-repository', () => ({
  listPrescriptions: jest.fn(async () => []),
}));
jest.mock('@/infrastructure/preparations/preparation-repository', () => ({
  listPreparationHistory: jest.fn(async () => []),
}));

const mockedUseUpdateNotice = jest.mocked(useUpdateNoticeState);

function render(): string {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(<MoreScreen />);
  });
  return JSON.stringify(renderer!.toJSON());
}

describe('écran Plus', () => {
  beforeEach(() => {
    mockedUseUpdateNotice.mockReturnValue({
      notice: null,
      download: jest.fn(),
      postpone: jest.fn(),
    });
  });

  it('regroupe le suivi et les réglages de l’application', () => {
    const rendered = render();
    expect(rendered).toContain('Suivi');
    expect(rendered).toContain('Ordonnances');
    expect(rendered).toContain('Préparations');
    expect(rendered).toContain('Prises');
    expect(rendered).toContain('Application');
    expect(rendered).toContain('Rappels');
    expect(rendered).toContain('Confidentialité et verrou');
    expect(rendered).toContain('Sauvegardes');
  });

  it('rappelle que les données restent locales', () => {
    expect(render()).toContain(
      'Vos données restent enregistrées uniquement sur ce téléphone',
    );
  });

  it('affiche la carte de mise à jour quand une version est disponible', () => {
    mockedUseUpdateNotice.mockReturnValue({
      notice: {
        version: '1.0.42',
        installedVersion: '1.0.41',
        downloadUrl:
          'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42',
        fallbackToReleasePage: true,
      },
      download: jest.fn(),
      postpone: jest.fn(),
    });
    expect(render()).toContain('1.0.42');
  });

  it('ne montre aucune carte de mise à jour quand l’app est à jour', () => {
    expect(render()).not.toContain('1.0.42');
  });
});
