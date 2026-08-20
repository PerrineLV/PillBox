import * as MailComposer from 'expo-mail-composer';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import {
  clearCrashLogs,
  crashLogUri,
  readCrashLogs,
  type CrashLogEntry,
} from '@/infrastructure/logging/crash-logger';
import { AppButton, Card, EmptyState, Message, Screen, typography } from '@/ui';

export default function ErrorLogScreen() {
  const [entries, setEntries] = useState<CrashLogEntry[] | null>(null);
  const load = useCallback(() => void readCrashLogs().then(setEntries), []);
  useEffect(() => {
    load();
  }, [load]);

  async function share(): Promise<void> {
    const uri = crashLogUri();
    if (uri === null) return;
    if (await MailComposer.isAvailableAsync()) {
      await MailComposer.composeAsync({
        recipients: ['pillbox.app@protonmail.com'],
        subject: 'PillBox — rapport de crash',
        attachments: [uri],
      });
      return;
    }
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  }

  function clear(): void {
    clearCrashLogs();
    setEntries([]);
  }

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: 'Journal des erreurs' }}
      />
      <Message tone="info">
        Seuls les crashs JavaScript sont journalisés ; les crashs natifs ne le
        sont pas.
      </Message>
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState title="Aucune erreur enregistrée" />
      ) : (
        <ScrollView>
          {entries.map((entry) => (
            <Card key={entry.timestamp}>
              <Text style={typography.caption}>{entry.timestamp}</Text>
              <Text style={typography.body}>{entry.message}</Text>
              {entry.stack ? (
                <Text style={typography.caption}>{entry.stack}</Text>
              ) : null}
            </Card>
          ))}
        </ScrollView>
      )}
      <AppButton
        label="Envoyer par email"
        disabled={entries === null || entries.length === 0}
        onPress={() => void share()}
      />
      <AppButton
        label="Effacer le journal"
        variant="danger"
        disabled={entries === null || entries.length === 0}
        onPress={clear}
      />
    </Screen>
  );
}
