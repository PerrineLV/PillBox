import * as MailComposer from 'expo-mail-composer';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  clearCrashLogs,
  crashLogUri,
  readCrashLogs,
  type CrashLogEntry,
} from '@/infrastructure/logging/crash-logger';
import {
  AppCard,
  AppScreen,
  EmptyState,
  PillButton,
  StackHeader,
  colors,
  typography,
} from '@/ui';

export default function ErrorLogScreen() {
  const [entries, setEntries] = useState<CrashLogEntry[] | null>(null);
  const load = useCallback(() => void readCrashLogs().then(setEntries), []);
  useEffect(() => {
    load();
  }, [load]);

  const empty = entries === null || entries.length === 0;

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
    <AppScreen
      header={
        <StackHeader
          subtitle="Crashs JavaScript uniquement"
          title="Journal des erreurs"
        />
      }
    >
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState
          description="Les crashs natifs ne sont pas journalisés : eux seuls échappent à ce journal."
          title="Aucune erreur enregistrée"
        />
      ) : (
        entries.map((entry) => (
          <AppCard key={entry.timestamp}>
            <Text style={styles.timestamp}>{entry.timestamp}</Text>
            <Text style={styles.message}>{entry.message}</Text>
            {entry.stack ? (
              <Text style={styles.stack}>{entry.stack}</Text>
            ) : null}
          </AppCard>
        ))
      )}
      <View style={styles.actions}>
        <PillButton
          disabled={empty}
          height={46}
          label="Envoyer par email"
          onPress={() => void share()}
          tone="outline"
        />
        <PillButton
          disabled={empty}
          height={46}
          label="Effacer le journal"
          onPress={clear}
          tone="destructive"
        />
      </View>
      <Text style={typography.micro}>
        Le journal ne quitte ce téléphone que si vous l’envoyez vous-même.
      </Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 9 },
  timestamp: {
    ...typography.numeric,
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  message: {
    ...typography.itemTitle,
    fontSize: 13.5,
    lineHeight: 18,
  },
  stack: {
    color: colors.textTertiary,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 17,
  },
});
