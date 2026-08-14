import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ScrollView, StyleSheet } from 'react-native';

import { PrescriptionForm } from '@/components/prescriptions/prescription-form';
import { todayIso } from '@/domain/inventory/inventory';
import {
  createPrescription,
  createPrescriptionItem,
} from '@/infrastructure/prescriptions/prescription-repository';
import { colors, spacing } from '@/ui';

export default function NewPrescriptionScreen() {
  const database = useSQLiteContext();
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{ headerShown: true, title: 'Nouvelle ordonnance' }}
      />
      <PrescriptionForm
        personalDatabase={database}
        initialValue={{
          label: '',
          issueDate: todayIso(),
          validUntil: null,
        }}
        submitLabel="Créer l’ordonnance"
        onSubmit={async ({ label, issueDate, validUntil, newLines }) => {
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
          router.replace('/prescriptions');
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flexGrow: 1,
    padding: spacing.lg,
  },
});
