import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useUpdateNoticeState } from '@/components/updates/update-notice-provider';
import { openFeedbackMail } from '@/infrastructure/contact/feedback-mail';
import { DenseRow } from '@/ui';
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
jest.mock('@/infrastructure/contact/feedback-mail', () => ({
  openFeedbackMail: jest.fn(async () => 'opened'),
}));

const mockedUseUpdateNotice = jest.mocked(useUpdateNoticeState);

function mount(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(<MoreScreen />);
  });
  return renderer!;
}

function render(): string {
  return JSON.stringify(mount().toJSON());
}

function contactRow(renderer: ReactTestRenderer, title: string) {
  return renderer.root
    .findAllByType(DenseRow)
    .find((row) => row.props.title === title)!;
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
    expect(rendered).toContain('Aide et contact');
    expect(rendered).toContain('Signaler un problème');
    expect(rendered).toContain('Proposer une idée');
  });

  it('ouvre directement la messagerie avec le type choisi', async () => {
    jest.mocked(openFeedbackMail).mockClear().mockResolvedValue('opened');
    const renderer = mount();
    await act(async () => {
      contactRow(renderer, 'Signaler un problème').props.onPress();
      contactRow(renderer, 'Signaler un problème').props.onPress();
    });
    expect(openFeedbackMail).toHaveBeenCalledTimes(1);
    expect(openFeedbackMail).toHaveBeenCalledWith('problem');
    await act(async () => {
      contactRow(renderer, 'Proposer une idée').props.onPress();
    });
    expect(openFeedbackMail).toHaveBeenLastCalledWith('suggestion');
    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).not.toContain('Message envoyé');
    expect(rendered).not.toContain('Impossible d’ouvrir');
  });

  it('rend l’adresse copiable si aucune messagerie ne s’ouvre', async () => {
    jest.mocked(openFeedbackMail).mockResolvedValue('unavailable');
    const renderer = mount();
    const selectable = renderer.root
      .findAllByType(Text)
      .filter((node) => node.props.selectable);
    expect(selectable.map((node) => node.props.children)).toEqual([
      'pillbox.app@protonmail.com',
    ]);
    await act(async () => {
      contactRow(renderer, 'Proposer une idée').props.onPress();
    });
    expect(JSON.stringify(renderer.toJSON())).toContain('Impossible d’ouvrir');
  });

  it('rappelle de ne pas transmettre de données de santé', () => {
    expect(render()).toContain('N’incluez pas de données de santé');
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
