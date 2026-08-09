import { Alert } from 'react-native';

import { confirmPermanentTreatmentDeletion } from '@/components/treatments/delete-confirmation';

describe('confirmation de suppression définitive', () => {
  it('nomme le traitement, précise l’irréversibilité et permet d’annuler sans supprimer', () => {
    const onConfirm = jest.fn();
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    confirmPermanentTreatmentDeletion('Alpha', onConfirm);

    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toContain('Supprimer définitivement');
    expect(message).toContain('Alpha');
    expect(message).toContain('irréversible');
    expect(buttons?.map((button) => button.text)).toEqual([
      'Annuler',
      'Supprimer définitivement',
    ]);
    buttons?.[0].onPress?.();
    expect(onConfirm).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
