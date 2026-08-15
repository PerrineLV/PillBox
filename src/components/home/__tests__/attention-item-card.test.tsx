import { AttentionItemContent } from '../attention-item-card';
import { formatFrenchDateTime } from '@/components/treatments/civil-date';
import type { AttentionItem } from '@/domain/home/attention-items';

function render(item: AttentionItem): string {
  return JSON.stringify(AttentionItemContent({ item }));
}

describe('AttentionItemContent', () => {
  it('affiche le créneau et le nombre de médicaments de la prochaine prise', () => {
    const scheduledAt = '2026-08-11T08:00:00.000Z';
    const rendered = render({
      type: 'NEXT_INTAKE_GROUP',
      id: 'next-intake:1',
      scheduledAt,
      groups: [{ date: '2026-08-11', slot: 'morning' }],
      medicationCount: 2,
    });
    expect(rendered).toContain('Prochaine prise');
    expect(rendered).toContain('Matin');
    expect(rendered).toContain('médicament');
    expect(rendered).toContain('prévu');
    // L'heure affichée dépend du fuseau d'exécution : on la recalcule avec la
    // même fonction de formatage plutôt que de figer une heure locale.
    expect(rendered).toContain(formatFrenchDateTime(scheduledAt));
  });

  it('propose de commencer quand la préparation est disponible', () => {
    const rendered = render({
      type: 'PREPARATION',
      id: 'preparation:next',
      mode: 'START',
      startDate: '2026-08-11',
      endDate: '2026-08-17',
      completedCount: 0,
      totalCount: 0,
    });
    expect(rendered).toContain('Préparer les 7 prochains jours');
    expect(rendered).toContain('Prochaine préparation');
  });

  it('affiche la progression quand la préparation est en cours', () => {
    const rendered = render({
      type: 'PREPARATION',
      id: 'preparation:draft',
      mode: 'RESUME',
      startDate: '2026-08-11',
      endDate: '2026-08-17',
      completedCount: 2,
      totalCount: 5,
    });
    expect(rendered).toContain('Préparation en cours');
    expect(rendered).toContain('médicament');
    expect(rendered).toContain('vérifié');
    expect(rendered).toContain(' sur ');
  });

  it('indique un état calme quand la préparation est déjà prête', () => {
    const rendered = render({
      type: 'PREPARATION',
      id: 'preparation:next',
      mode: 'READY',
      startDate: '2026-08-11',
      endDate: '2026-08-17',
      completedCount: 0,
      totalCount: 0,
    });
    expect(rendered).toContain('Semaine préparée');
    expect(rendered).toContain('Rien à faire pour l’instant');
  });

  it('affiche le renouvellement classé avec sa date de rupture', () => {
    const rendered = render({
      type: 'STOCK_RENEWAL',
      id: 'stock-renewal:1',
      item: {
        specialtyCis: '1',
        specialtyName: 'Alpha',
        urgency: 'RUNS_OUT_SOON',
        availableHalfUnits: 4,
        nextPreparationHalfUnits: 14,
        missingHalfUnits: 0,
        ruptureDate: '2026-08-15',
        ruptureCause: 'CONSUMED',
        theoreticalRenewalDate: null,
        theoreticalRenewalWindow: null,
        runsOutBeforeRenewalWindow: false,
        usableBoxCount: null,
      },
    });
    expect(rendered).toContain('Alpha');
    expect(rendered).toContain('Rupture proche');
    expect(rendered).toContain('Rupture estimée le 15 août 2026');
  });

  it('affiche la péremption avec le lot concerné', () => {
    const rendered = render({
      type: 'EXPIRATION',
      id: 'expiration:7',
      boxId: 7,
      specialtyName: 'Beta',
      lot: 'LOT-B',
      expirationDate: '2026-08-20',
      remainingQuantity: 5,
    });
    expect(rendered).toContain('Beta');
    expect(rendered).toContain('LOT-B');
    expect(rendered).toContain('20 août 2026');
  });

  it("affiche la dernière prise d'un traitement si besoin sans suggérer de reprise", () => {
    const rendered = render({
      type: 'AS_NEEDED_INFO',
      id: 'as-needed:3',
      treatmentId: 3,
      specialtyName: 'Gamma',
      lastIntake: {
        id: 1,
        treatmentId: 3,
        takenAt: '2026-08-10T21:00:00.000Z',
        quantityHalfUnits: 2,
        note: null,
        createdAt: '2026-08-10T21:00:00.000Z',
      },
    });
    expect(rendered).toContain('Gamma');
    expect(rendered).toContain('Dernière prise');
    expect(rendered).not.toMatch(/repren|autorisé|pouvez/i);
  });

  it("affiche l'absence de prise pour un traitement si besoin jamais utilisé", () => {
    const rendered = render({
      type: 'AS_NEEDED_INFO',
      id: 'as-needed:4',
      treatmentId: 4,
      specialtyName: 'Delta',
      lastIntake: null,
    });
    expect(rendered).toContain('Aucune prise enregistrée');
  });
});
