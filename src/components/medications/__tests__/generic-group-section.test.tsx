import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getGenericGroupMembers } from '@/infrastructure/medications/medication-reference';

import { GenericGroupSection } from '../generic-group-section';

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
  SQLiteProvider: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/infrastructure/medications/medication-reference', () => ({
  getGenericGroupMembers: jest.fn(),
}));

const mockedGetGenericGroupMembers = getGenericGroupMembers as jest.Mock;

const MEMBERS = [
  {
    groupId: 'g1',
    groupLabel: 'Groupe 1',
    cis: '11111111',
    name: 'Médicament A',
    type: null,
  },
  {
    groupId: 'g1',
    groupLabel: 'Groupe 1',
    cis: '22222222',
    name: 'Médicament B',
    type: null,
  },
];

async function renderSection(cis = '12345678'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<GenericGroupSection cis={cis} />);
  });
  return renderer;
}

describe('GenericGroupSection', () => {
  beforeEach(() => {
    mockedGetGenericGroupMembers.mockReset();
  });

  it("ne rend rien quand aucun groupe générique n'existe", async () => {
    mockedGetGenericGroupMembers.mockResolvedValue([]);
    const renderer = await renderSection();
    expect(renderer.toJSON()).toBeNull();
  });

  it('est repliée par défaut : disclaimer et liste absents du rendu', async () => {
    mockedGetGenericGroupMembers.mockResolvedValue(MEMBERS);
    const renderer = await renderSection();

    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Groupe générique');
    expect(json).toContain('2 spécialités');
    expect(json).not.toContain('Information issue de la BDPM');
    expect(json).not.toContain('Médicament A');
    expect(json).not.toContain('Médicament B');

    const header = renderer.root.findByProps({ accessibilityRole: 'button' });
    expect(header.props.accessibilityState).toEqual({ expanded: false });
  });

  it('affiche le disclaimer et la liste complète après un clic sur l’en-tête', async () => {
    mockedGetGenericGroupMembers.mockResolvedValue(MEMBERS);
    const renderer = await renderSection();

    const header = renderer.root.findByProps({ accessibilityRole: 'button' });
    await act(async () => {
      header.props.onPress();
    });

    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Information issue de la BDPM');
    expect(json).toContain('Groupe 1');
    expect(json).toContain('Médicament A');
    expect(json).toContain('Médicament B');
    expect(header.props.accessibilityState).toEqual({ expanded: true });
  });

  it('replie à nouveau la section après un second clic sur l’en-tête', async () => {
    mockedGetGenericGroupMembers.mockResolvedValue(MEMBERS);
    const renderer = await renderSection();

    const header = renderer.root.findByProps({ accessibilityRole: 'button' });
    await act(async () => {
      header.props.onPress();
    });
    await act(async () => {
      header.props.onPress();
    });

    const json = JSON.stringify(renderer.toJSON());
    expect(json).not.toContain('Information issue de la BDPM');
    expect(json).not.toContain('Médicament A');
    expect(header.props.accessibilityState).toEqual({ expanded: false });
  });
});
