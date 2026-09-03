import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { buildTodaySlots } from '@/domain/home/today-plan';
import { buildWeeklyGrid } from '@/domain/home/weekly-grid';
import type {
  IntakeRecord,
  IntakeStatus,
} from '@/domain/intakes/intake-tracking';
import type { IntakeSlotTimes } from '@/domain/reminders/intake-reminder';
import type { IntakeSlot } from '@/domain/treatments/treatment';
import { HomeContent, type HomeData } from '../app/index';

jest.mock('expo-sqlite', () => ({ useSQLiteContext: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useFocusEffect: () => undefined,
  usePathname: () => '/',
  router: { navigate: jest.fn() },
}));

const SLOT_TIMES: IntakeSlotTimes = {
  morning: { hour: 8, minute: 0 },
  noon: { hour: 12, minute: 30 },
  evening: { hour: 19, minute: 0 },
  bedtime: { hour: 22, minute: 0 },
};
const NOON = new Date(2026, 8, 1, 12, 45);

function record(
  name: string,
  slot: IntakeSlot,
  status: IntakeStatus,
  treatmentId = 1,
): IntakeRecord {
  return {
    key: `${treatmentId}:2026-09-01:${slot}`,
    treatmentId,
    date: '2026-09-01',
    slot,
    specialtyCis: '60000001',
    specialtyName: name,
    pharmaceuticalForm: 'comprimé',
    quantityHalfUnits: 2,
    status,
    createdAt: '2026-09-01T06:00:00.000Z',
    updatedAt: '2026-09-01T10:34:00.000Z',
  };
}

/** Quatre médicaments sur un même créneau : un de plus que le plafond. */
function crowdedNoon(): HomeData['slots'] {
  return buildTodaySlots(
    [
      record('Kardégic', 'noon', 'UNSET', 2),
      record('Metformine', 'noon', 'UNSET', 3),
      record('Levothyrox', 'noon', 'UNSET', 4),
      record('Doliprane', 'noon', 'UNSET', 5),
    ],
    SLOT_TIMES,
  );
}

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    slots: buildTodaySlots(
      [
        record('Levothyrox', 'morning', 'TAKEN'),
        record('Kardégic', 'noon', 'UNSET', 2),
        record('Metformine', 'noon', 'UNSET', 3),
      ],
      SLOT_TIMES,
    ),
    watchItems: [],
    asNeededRows: [],
    grid: null,
    preparationState: 'TO_PREPARE',
    outsidePillboxTreatmentIds: new Set(),
    ...overrides,
  };
}

function mount(props: Parameters<typeof HomeContent>[0]): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(<HomeContent {...props} />);
  });
  return renderer!;
}

function render(props: Parameters<typeof HomeContent>[0]): string {
  return JSON.stringify(mount(props).toJSON());
}

/**
 * `findAllByProps` remonte aussi la vue hôte produite par `Pressable` : seule
 * celle qui porte réellement le gestionnaire nous intéresse.
 */
function press(renderer: ReactTestRenderer, accessibilityLabel: string): void {
  const target = renderer.root
    .findAllByProps({ accessibilityLabel })
    .find((node) => typeof node.props.onPress === 'function');
  if (target === undefined)
    throw new Error(`Aucun élément pressable « ${accessibilityLabel} ».`);
  act(() => {
    target.props.onPress();
  });
}

describe('accueil', () => {
  it('porte la marque et le créneau en cours, médicaments repliés', () => {
    const rendered = render({
      data: homeData(),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('PillBox');
    expect(rendered).toContain('Midi');
    expect(rendered).toContain('12:30');
    expect(rendered).toContain('2 médicaments');
    expect(rendered).not.toContain('Kardégic');
    expect(rendered).not.toContain('Metformine');
  });

  it('propose la validation groupée tant que des prises attendent', () => {
    expect(
      render({ data: homeData(), loading: false, error: null, now: NOON }),
    ).toContain('Tout valider');
  });

  it('remplace la validation par l’heure de renseignement une fois le créneau complet', () => {
    const rendered = render({
      data: homeData({
        slots: buildTodaySlots(
          [record('Levothyrox', 'morning', 'TAKEN')],
          SLOT_TIMES,
        ),
      }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).not.toContain('Tout valider');
    expect(rendered).toContain('Créneau du matin validé');
  });

  it('ne propose pas la validation groupée quand une prise hors pilulier attend', () => {
    const renderer = mount({
      data: homeData({ outsidePillboxTreatmentIds: new Set([3]) }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Tout valider');
    press(renderer, 'Afficher 2 médicaments');
    expect(JSON.stringify(renderer.toJSON())).toContain('Boîte à désigner');
  });

  it('annonce le nombre de médicaments sans en afficher aucun', () => {
    const rendered = render({
      data: homeData({ slots: crowdedNoon() }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('4 médicaments');
    for (const name of ['Kardégic', 'Metformine', 'Levothyrox', 'Doliprane'])
      expect(rendered).not.toContain(name);
    // Le repli est visuel : la validation porte toujours sur les quatre.
    expect(rendered).toContain('Tout valider');
  });

  it('déplie la liste complète puis la referme', () => {
    const renderer = mount({
      data: homeData({ slots: crowdedNoon() }),
      loading: false,
      error: null,
      now: NOON,
    });
    press(renderer, 'Afficher 4 médicaments');
    const expanded = JSON.stringify(renderer.toJSON());
    for (const name of ['Kardégic', 'Metformine', 'Levothyrox', 'Doliprane'])
      expect(expanded).toContain(name);
    expect(expanded).toContain('Réduire');

    press(renderer, 'Réduire la liste');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Doliprane');
  });

  it('affiche directement un médicament unique, sans ligne de repli', () => {
    const rendered = render({
      data: homeData({
        slots: buildTodaySlots(
          [record('Levothyrox', 'noon', 'UNSET')],
          SLOT_TIMES,
        ),
      }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('Levothyrox');
    // Aucune commande d'ouverture ou de fermeture : elle remplacerait la
    // ligne qu'elle masque, sans rien gagner.
    expect(rendered).not.toContain('Afficher');
    expect(rendered).not.toContain('Réduire');
    // « Tout valider » n'aurait rien à englober.
    expect(rendered).toContain('Valider');
    expect(rendered).not.toContain('Tout valider');
  });

  it('annonce la prochaine prise quand rien n’est en attente', () => {
    const rendered = render({
      data: homeData({
        slots: buildTodaySlots(
          [record('Metformine', 'evening', 'UNSET')],
          SLOT_TIMES,
        ),
      }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('Prochaine prise');
    expect(rendered).toContain('6 h 15');
  });

  it('affiche le chargement puis l’erreur sans faire disparaître l’en-tête', () => {
    expect(
      render({ data: null, loading: true, error: null, now: NOON }),
    ).toContain('Chargement de votre situation');
    const failed = render({
      data: null,
      loading: false,
      error: 'Panne locale',
      now: NOON,
    });
    expect(failed).toContain('Panne locale');
    expect(failed).toContain('PillBox');
  });

  it('limite les alertes affichées mais annonce leur nombre total', () => {
    const watchItems: HomeData['watchItems'] = [1, 2, 3, 4].map((index) => ({
      type: 'EXPIRATION' as const,
      id: `expiration:${index}`,
      boxId: index,
      specialtyName: `Médicament ${index}`,
      lot: `LOT-${index}`,
      expirationDate: '2026-09-20',
      remainingQuantity: 5,
    }));
    const rendered = render({
      data: homeData({ watchItems }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('Médicament 3');
    expect(rendered).not.toContain('Médicament 4');
    expect(rendered).toContain('"4"');
  });

  it('n’affiche la section « si besoin » que lorsqu’un traitement en relève', () => {
    expect(
      render({ data: homeData(), loading: false, error: null, now: NOON }),
    ).not.toContain('Si besoin');
  });

  it('plafonne les traitements « si besoin » et renvoie les autres à l’onglet', () => {
    const asNeededRows: HomeData['asNeededRows'] = [1, 2, 3, 4].map(
      (index) => ({
        treatmentId: index,
        specialtyName: `Antalgique ${index}`,
        rank: 1 as const,
        blocked: false,
        detail: 'Aucune prise aujourd’hui',
      }),
    );
    const rendered = render({
      data: homeData({ asNeededRows }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('Antalgique 3');
    expect(rendered).not.toContain('Antalgique 4');
    expect(rendered).toContain('autre');
  });

  it('résume la semaine et son avancement', () => {
    const rendered = render({
      data: homeData({
        grid: buildWeeklyGrid({
          startDate: '2026-09-02',
          items: [
            { date: '2026-09-02', slot: 'morning', specialtyCis: '1' },
            { date: '2026-09-03', slot: 'morning', specialtyCis: '1' },
          ],
          preparedCis: ['1'],
        }),
        preparationState: 'IN_PROGRESS',
      }),
      loading: false,
      error: null,
      now: NOON,
    });
    expect(rendered).toContain('2 septembre');
    expect(rendered).toContain('2 / 2 cases');
    expect(rendered).toContain('Reprendre');
  });
});
