/**
 * Écran de diagnostic temporaire : contenu réel de `update_check_settings`.
 *
 * Il sert uniquement à lire, sur un APK release non débuggable, l'état du cache
 * qui décide de l'appel à GitHub. Aucun comportement de production n'est
 * modifié : l'écran réutilise les fonctions existantes en lecture, et le bouton
 * de vérification forcée refait localement ce que ferait `resolveUpdateNotice`
 * lorsque l'intervalle de 6 heures est écoulé.
 *
 * TEMPORAIRE : cet écran et l'item « Debug mise à jour » de `more.tsx` sont à
 * supprimer avant la prochaine release réelle.
 */
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  decideUpdateNotice,
  shouldQueryGitHub,
  UPDATE_CHECK_INTERVAL_MS,
} from '@/domain/updates/update-notice';
import { fetchLatestPublishedRelease } from '@/infrastructure/updates/github-release-client';
import { installedAppVersion } from '@/infrastructure/updates/installed-version';
import {
  readUpdateCheckState,
  saveUpdateCheckResult,
  type UpdateCheckState,
} from '@/infrastructure/updates/update-check-repository';
import {
  AppButton,
  Card,
  LoadingState,
  Message,
  Screen,
  SectionTitle,
  spacing,
  typography,
} from '@/ui';

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; state: UpdateCheckState; readAt: Date };

export default function UpdateCheckStateScreen() {
  const database = useSQLiteContext();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [forcing, setForcing] = useState(false);
  const [lastForced, setLastForced] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const state = await readUpdateCheckState(database);
      setLoad({ status: 'loaded', state, readAt: new Date() });
    } catch (error) {
      setLoad({ status: 'failed', message: describeError(error) });
    }
  }, [database]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const forceCheck = () => {
    setForcing(true);
    setLastForced(null);
    void (async () => {
      try {
        const now = new Date();
        const release = await fetchLatestPublishedRelease();
        await saveUpdateCheckResult(database, now.toISOString(), release);
        setLastForced(
          release === null
            ? 'GitHub n’a rien renvoyé d’exploitable (hors ligne, quota, ' +
                'réponse inattendue). Seule la date de vérification a été écrite.'
            : `GitHub a répondu : version ${release.version}.`,
        );
      } catch (error) {
        setLastForced(
          `Échec de la vérification forcée : ${describeError(error)}`,
        );
      } finally {
        setForcing(false);
        await reload();
      }
    })();
  };

  if (load.status === 'loading') {
    return (
      <Screen>
        <Stack.Screen
          options={{ headerShown: true, title: 'Cache mise à jour' }}
        />
        <LoadingState label="Lecture de update_check_settings…" />
      </Screen>
    );
  }

  if (load.status === 'failed') {
    return (
      <Screen>
        <Stack.Screen
          options={{ headerShown: true, title: 'Cache mise à jour' }}
        />
        <Message tone="error" title="Lecture impossible">
          {load.message}
        </Message>
        <AppButton label="Réessayer" onPress={() => void reload()} />
      </Screen>
    );
  }

  const { state, readAt } = load;
  const installedVersion = installedAppVersion();
  const wouldQuery = shouldQueryGitHub(state.lastCheckedAt, readAt);
  const notice = decideUpdateNotice({
    installedVersion,
    release: state.latestRelease,
    postponement: state.postponement,
    now: readAt,
  });

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: 'Cache mise à jour' }}
      />

      <Card>
        <SectionTitle>Dernière vérification</SectionTitle>
        <Field label="last_checked_at" value={state.lastCheckedAt} />
        <Field
          label="Temps écoulé depuis"
          value={formatElapsed(state.lastCheckedAt, readAt)}
        />
        <Field
          label="Intervalle configuré"
          value={formatDuration(UPDATE_CHECK_INTERVAL_MS)}
        />
        <Field
          label="shouldQueryGitHub(lastCheckedAt, maintenant)"
          value={
            wouldQuery
              ? 'true — un nouvel appel réseau serait déclenché'
              : 'false — la bannière s’appuie sur le cache ci-dessous'
          }
        />
      </Card>

      <Card>
        <SectionTitle>Release en cache</SectionTitle>
        <Field label="latest_version" value={state.latestRelease?.version} />
        <Field
          label="latest_release_url"
          value={state.latestRelease?.releaseUrl}
        />
        <Field label="latest_apk_url" value={state.latestRelease?.apkUrl} />
      </Card>

      <Card>
        <SectionTitle>Report</SectionTitle>
        <Field label="postponed_version" value={state.postponement?.version} />
        <Field label="postponed_at" value={state.postponement?.postponedAt} />
        <Field
          label="Temps écoulé depuis le report"
          value={formatElapsed(state.postponement?.postponedAt ?? null, readAt)}
        />
      </Card>

      <Card>
        <SectionTitle>Décision actuelle</SectionTitle>
        <Field
          label="Version installée (installedAppVersion)"
          value={installedVersion}
        />
        <Field
          label="decideUpdateNotice"
          value={
            notice === null
              ? 'null — aucune bannière affichée'
              : `bannière ${notice.version} → ${notice.downloadUrl}`
          }
        />
        <Field label="État lu à" value={readAt.toISOString()} />
      </Card>

      {lastForced === null ? null : (
        <Message tone="info" title="Vérification forcée">
          {lastForced}
        </Message>
      )}

      <AppButton
        label="Forcer une vérification maintenant"
        loading={forcing}
        onPress={forceCheck}
      />
      <AppButton
        label="Relire sans appeler GitHub"
        variant="secondary"
        disabled={forcing}
        onPress={() => void reload()}
      />
      <Text style={styles.note}>
        Écran de diagnostic temporaire. La vérification forcée ignore
        l’intervalle de {formatDuration(UPDATE_CHECK_INTERVAL_MS)} et écrit
        last_checked_at, exactement comme le ferait une vérification normale
        arrivée à échéance.
      </Text>
    </Screen>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value === null || value === undefined || value === '' ? 'NULL' : value}
      </Text>
    </View>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** « il y a 3h 12min », ou la raison pour laquelle la durée est inexploitable. */
function formatElapsed(isoDate: string | null, now: Date): string {
  if (isoDate === null) return 'jamais';

  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return 'date illisible';

  const elapsed = now.getTime() - timestamp;
  if (elapsed < 0) return `dans le futur (${formatDuration(-elapsed)})`;
  return `il y a ${formatDuration(elapsed)}`;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}min` : `${hours}h ${minutes}min`;
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: typography.label,
  note: typography.caption,
  value: {
    backgroundColor: '#f3f4f6',
    fontFamily: 'monospace',
    padding: spacing.sm,
  },
});
