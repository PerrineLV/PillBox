import type { GenericGroupMember } from '@/infrastructure/medications/medication-reference';

import { groupNamedGenericGroupMembers } from '../generic-group-display';

function member(overrides: Partial<GenericGroupMember>): GenericGroupMember {
  return {
    groupId: '10',
    groupLabel: 'GROUPE TEST',
    cis: '60000001',
    name: 'SPÉCIALITÉ',
    type: '1',
    ...overrides,
  };
}

describe('groupNamedGenericGroupMembers', () => {
  it('regroupe les membres nommés par groupe générique', () => {
    const members = [
      member({ groupId: '10', cis: '60000002', name: 'GENERIQUE A' }),
      member({ groupId: '10', cis: '60000003', name: 'GENERIQUE B' }),
    ];

    expect(groupNamedGenericGroupMembers(members)).toEqual([
      [
        member({ groupId: '10', cis: '60000002', name: 'GENERIQUE A' }),
        member({ groupId: '10', cis: '60000003', name: 'GENERIQUE B' }),
      ],
    ]);
  });

  it("exclut un membre dont le nom n'a pas pu être résolu (CIS orphelin), plutôt que de l'afficher sans nom", () => {
    const members = [
      member({ cis: '60000002', name: 'GENERIQUE A' }),
      member({ cis: '69999999', name: null }),
    ];

    const groups = groupNamedGenericGroupMembers(members);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0].cis).toBe('60000002');
  });

  it("ne retourne aucun groupe si tous les membres d'un groupe sont sans nom", () => {
    const members = [
      member({ groupId: '10', cis: '69999998', name: null }),
      member({ groupId: '10', cis: '69999999', name: null }),
    ];

    expect(groupNamedGenericGroupMembers(members)).toEqual([]);
  });

  it('conserve des groupes distincts quand un CIS appartient à plusieurs groupes génériques', () => {
    const members = [
      member({ groupId: '40', cis: '60000002', name: 'DOSAGE 250 mg' }),
      member({
        groupId: '41',
        groupLabel: 'GROUPE 500 mg',
        cis: '60000003',
        name: 'DOSAGE 500 mg',
      }),
    ];

    expect(groupNamedGenericGroupMembers(members)).toEqual([
      [member({ groupId: '40', cis: '60000002', name: 'DOSAGE 250 mg' })],
      [
        member({
          groupId: '41',
          groupLabel: 'GROUPE 500 mg',
          cis: '60000003',
          name: 'DOSAGE 500 mg',
        }),
      ],
    ]);
  });
});
