import { Alert } from 'react-native';

import { confirmPermanentBoxDeletion } from '../delete-confirmation';

const box = {
  id: 3,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte de 30',
  lot: 'LOT-MANUEL',
  expirationDate: '2027-12-31',
  initialQuantity: 30,
  remainingQuantity: 30,
  origin: 'MANUAL',
  scanRaw: null,
} as const;

describe('confirmation de suppression d’une boîte du stock', () => {
  it('identifie la boîte, précise l’irréversibilité et permet d’annuler sans supprimer', () => {
    const onConfirm = jest.fn();
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    confirmPermanentBoxDeletion(box, onConfirm);

    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toContain('Supprimer définitivement');
    expect(message).toContain('Alpha');
    expect(message).toContain('LOT-MANUEL');
    expect(message).toContain('irréversible');
    expect(buttons?.map((button) => button.text)).toEqual([
      'Annuler',
      'Supprimer définitivement',
    ]);
    buttons?.[0].onPress?.();
    expect(onConfirm).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('supprime seulement après le choix explicite de suppression', () => {
    const onConfirm = jest.fn();
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    confirmPermanentBoxDeletion({ ...box, lot: null }, onConfirm);

    const [, message, buttons] = alert.mock.calls[0];
    expect(message).toContain('lot non renseigné');
    buttons?.[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});
