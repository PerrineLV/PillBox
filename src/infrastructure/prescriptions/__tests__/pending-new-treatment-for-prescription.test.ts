import {
  drainCreatedTreatmentForPrescription,
  queueCreatedTreatmentForPrescription,
} from '../pending-new-treatment-for-prescription';

describe('file d’attente du traitement créé depuis une ligne d’ordonnance', () => {
  it('ne restitue rien tant qu’aucun traitement n’a été mis en attente', () => {
    expect(drainCreatedTreatmentForPrescription()).toBeNull();
  });

  it('restitue le dernier traitement mis en attente', () => {
    queueCreatedTreatmentForPrescription(7);

    expect(drainCreatedTreatmentForPrescription()).toBe(7);
  });

  it('vide la file après un dépilement, sans redonner deux fois le même traitement', () => {
    queueCreatedTreatmentForPrescription(7);

    drainCreatedTreatmentForPrescription();

    expect(drainCreatedTreatmentForPrescription()).toBeNull();
  });
});
