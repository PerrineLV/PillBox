import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { PrescriptionForm } from '@/components/prescriptions/prescription-form';
import { todayIso } from '@/domain/inventory/inventory';
import {
  confirmPrescriptionReplacement,
  createPrescription,
  createPrescriptionItem,
} from '@/infrastructure/prescriptions/prescription-repository';
import { AppScreen, StackHeader } from '@/ui';

export default function NewPrescriptionScreen() {
  const database = useSQLiteContext();
  return (
    <AppScreen header={<StackHeader title="Nouvelle ordonnance" />}>
      <PrescriptionForm
        initialValue={{
          label: '',
          issueDate: todayIso(),
          validUntil: null,
        }}
        onSubmit={async ({
          label,
          issueDate,
          validUntil,
          newLines,
          replacesPrescriptionIds,
        }) => {
          const prescriptionId = await createPrescription(database, {
            label,
            issueDate,
            validUntil,
          });
          for (const draft of newLines) {
            await createPrescriptionItem(database, {
              ...draft,
              prescriptionId,
            });
          }
          for (const replacedId of replacesPrescriptionIds) {
            await confirmPrescriptionReplacement(
              database,
              replacedId,
              prescriptionId,
            );
          }
          router.replace('/prescriptions');
        }}
        personalDatabase={database}
        submitLabel="Créer l’ordonnance"
      />
    </AppScreen>
  );
}
