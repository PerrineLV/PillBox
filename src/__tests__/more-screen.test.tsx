import MoreScreen from '../app/more';
import { useUpdateNotice } from '@/components/updates/use-update-notice';

jest.mock('@/components/updates/use-update-notice', () => ({
  useUpdateNotice: jest.fn(),
}));

const mockedUseUpdateNotice = jest.mocked(useUpdateNotice);

describe('écran Plus', () => {
  it('affiche la carte de mise à jour au début du contenu', () => {
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

    const children = (MoreScreen().props as { children: unknown[] }).children;

    expect(JSON.stringify(children[0])).toContain('"version":"1.0.42"');
    expect(children).toHaveLength(3);
  });

  it('ne montre pas de carte lorsqu’aucune mise à jour n’est disponible', () => {
    mockedUseUpdateNotice.mockReturnValue({
      notice: null,
      download: jest.fn(),
      postpone: jest.fn(),
    });

    const children = (MoreScreen().props as { children: unknown[] }).children;

    expect(children[0]).toBeNull();
  });
});
