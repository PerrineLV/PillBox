import { DuplicateLotConfirmation } from '../duplicate-lot-confirmation';

const existingBox = {
  id: 3,
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte de 30',
  lot: 'LOT-42',
  expirationDate: '2027-12-31',
  initialQuantity: 30,
  remainingQuantity: 12,
  origin: 'MANUAL',
  scanRaw: null,
} as const;

describe('confirmation d’un lot déjà en stock', () => {
  it('rappelle la boîte existante concernée et permet d’annuler sans rien enregistrer', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const modal = DuplicateLotConfirmation({
      visible: true,
      existingBox,
      onCancel,
      onConfirm,
    });

    const rendered = JSON.stringify(modal);
    expect(rendered).toContain('Alpha');
    expect(rendered).toContain('LOT-42');
    expect(rendered).toContain('12');

    modal.props.onCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enregistre la boîte seulement après confirmation explicite', () => {
    const onConfirm = jest.fn();

    const modal = DuplicateLotConfirmation({
      visible: true,
      existingBox,
      onCancel: jest.fn(),
      onConfirm,
    });

    modal.props.onPrimary();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reste masquée tant qu’aucun lot dupliqué n’est détecté', () => {
    const modal = DuplicateLotConfirmation({
      visible: false,
      existingBox,
      onCancel: jest.fn(),
      onConfirm: jest.fn(),
    });

    expect(modal.props.visible).toBe(false);
  });
});
