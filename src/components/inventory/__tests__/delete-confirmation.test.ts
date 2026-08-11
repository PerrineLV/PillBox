import { BoxDeletionConfirmation } from '../delete-confirmation';

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
    const onCancel = jest.fn();

    const modal = BoxDeletionConfirmation({
      visible: true,
      box,
      onCancel,
      onConfirm,
    });

    const rendered = JSON.stringify(modal);
    expect(rendered).toContain('Supprimer définitivement');
    expect(rendered).toContain('Alpha');
    expect(rendered).toContain('LOT-MANUEL');
    expect(rendered).toContain('irréversible');

    modal.props.onCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('mentionne un lot non renseigné et supprime seulement après le choix explicite', () => {
    const onConfirm = jest.fn();

    const modal = BoxDeletionConfirmation({
      visible: true,
      box: { ...box, lot: null },
      onCancel: jest.fn(),
      onConfirm,
    });

    expect(JSON.stringify(modal)).toContain('lot non renseigné');
    modal.props.onPrimary();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reste masquée tant qu’aucune suppression n’est demandée', () => {
    const modal = BoxDeletionConfirmation({
      visible: false,
      box,
      onCancel: jest.fn(),
      onConfirm: jest.fn(),
    });

    expect(modal.props.visible).toBe(false);
  });
});
