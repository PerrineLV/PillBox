import {
  drainPendingGenericEquivalenceDrafts,
  queuePendingGenericEquivalenceDraft,
} from '../pending-generic-equivalence-draft';

describe('file d’attente des équivalences génériques confirmées avant création du traitement', () => {
  it('ne restitue rien tant qu’aucune équivalence n’a été mise en attente', () => {
    expect(drainPendingGenericEquivalenceDrafts()).toEqual([]);
  });

  it('restitue dans l’ordre les équivalences mises en attente', () => {
    queuePendingGenericEquivalenceDraft({
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });
    queuePendingGenericEquivalenceDraft({
      cis: '60000003',
      specialtyName: 'Sertraline B',
      groupLabel: 'Groupe sertraline',
    });

    expect(drainPendingGenericEquivalenceDrafts()).toEqual([
      {
        cis: '60000002',
        specialtyName: 'Sertraline',
        groupLabel: 'Groupe sertraline',
      },
      {
        cis: '60000003',
        specialtyName: 'Sertraline B',
        groupLabel: 'Groupe sertraline',
      },
    ]);
  });

  it('vide la file après un dépilement, sans redonner deux fois la même équivalence', () => {
    queuePendingGenericEquivalenceDraft({
      cis: '60000002',
      specialtyName: 'Sertraline',
      groupLabel: 'Groupe sertraline',
    });

    drainPendingGenericEquivalenceDrafts();

    expect(drainPendingGenericEquivalenceDrafts()).toEqual([]);
  });
});
