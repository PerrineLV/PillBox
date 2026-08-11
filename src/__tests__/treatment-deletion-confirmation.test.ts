import { TreatmentDeletionConfirmation } from '@/components/treatments/delete-confirmation';

describe('confirmation de suppression définitive', () => {
  it('nomme le traitement, précise l’irréversibilité et permet d’annuler sans supprimer', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const modal = TreatmentDeletionConfirmation({
      visible: true,
      treatmentName: 'Alpha',
      onCancel,
      onConfirm,
    });

    const rendered = JSON.stringify(modal);
    expect(rendered).toContain('Supprimer définitivement');
    expect(rendered).toContain('Alpha');
    expect(rendered).toContain('irréversible');
    expect(modal.props.visible).toBe(true);

    modal.props.onCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('supprime seulement après le choix explicite de suppression', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const modal = TreatmentDeletionConfirmation({
      visible: true,
      treatmentName: 'Alpha',
      onCancel,
      onConfirm,
    });

    modal.props.onPrimary();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('reste masquée tant qu’aucune suppression n’est demandée', () => {
    const modal = TreatmentDeletionConfirmation({
      visible: false,
      treatmentName: 'Alpha',
      onCancel: jest.fn(),
      onConfirm: jest.fn(),
    });

    expect(modal.props.visible).toBe(false);
  });
});
