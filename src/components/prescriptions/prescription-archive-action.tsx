import { useState } from 'react';
import { View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import type { Prescription } from '@/domain/prescriptions/prescription';
import { setPrescriptionArchived } from '@/infrastructure/prescriptions/prescription-repository';
import { Message, PillButton } from '@/ui';

export function PrescriptionArchiveAction({
  prescription,
  onChanged,
}: Readonly<{
  prescription: Prescription;
  onChanged(): void | Promise<void>;
}>) {
  const database = useSQLiteContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setPrescriptionArchived(
        database,
        prescription.id,
        !prescription.archived,
      );
      await onChanged();
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      {error ? <Message tone="error">{error}</Message> : null}
      <PillButton
        label={prescription.archived ? 'Restaurer' : 'Archiver'}
        tone="outline"
        disabled={busy}
        onPress={() => {
          void toggle();
        }}
        accessibilityHint={`${prescription.label}. Les traitements associés restent inchangés.`}
      />
    </View>
  );
}
