/**
 * Écran de diagnostic temporaire : état réel de la détection de mise à jour.
 *
 * Route non liée dans la navigation en temps normal, comme
 * `developer/datamatrix-scanner`. Elle sert uniquement à observer, sur un APK
 * release non débuggable, pourquoi la bannière ne s'affiche pas. Aucun
 * comportement de production n'est modifié : l'écran réutilise en lecture les
 * fonctions existantes.
 *
 * Deux questions sont instrumentées séparément :
 *
 * 1. `checkForUpdate` se termine-t-il ? L'appel est refait exactement comme le
 *    fait `useUpdateNotice`, sur la file SQLite partagée par toute
 *    l'application (`useDatabaseTaskQueue`). Si une autre tâche automatique
 *    reste bloquée dans cette file, cet appel-ci le sera aussi et l'écran
 *    restera sur « en attente ».
 * 2. Sinon, la décision est-elle fausse ? Le contenu du cache est relu
 *    directement, HORS de la file, afin de rester lisible même quand la file
 *    est bloquée.
 */
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  decideUpdateNotice,
  shouldQueryGitHub,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdateNotice,
} from '@/domain/updates/update-notice';
import { useDatabaseTaskQueue } from '@/infrastructure/database/database-provider';
import { GITHUB_REQUEST_TIMEOUT_MS } from '@/infrastructure/updates/github-release-client';
import { installedAppVersion } from '@/infrastructure/updates/installed-version';
import {
  readUpdateCheckState,
  type UpdateCheckState,
} from '@/infrastructure/updates/update-check-repository';
import { checkForUpdate } from '@/infrastructure/updates/update-check-service';
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

/** Suivi d'une promesse : départ horodaté, puis issue horodatée. */
type TimedCall<T> =
  | { status: 'pending'; startedAt: number }
  | { status: 'resolved'; startedAt: number; endedAt: number; value: T }
  | { status: 'failed'; startedAt: number; endedAt: number; message: string };

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'loaded'; state: UpdateCheckState; readAt: Date };

export default function UpdateCheckStateScreen() {
  const database = useSQLiteContext();
  const queue = useDatabaseTaskQueue();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [probe, setProbe] = useState<TimedCall<null> | null>(null);
  const [check, setCheck] = useState<TimedCall<UpdateNotice | null> | null>(
    null,
  );
  // Fait avancer les durées « en attente depuis… » sans dépendre d'un rendu.
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      // Lecture directe, volontairement hors de la file : ce panneau doit
      // rester affichable même si la file est bloquée.
      const state = await readUpdateCheckState(database);
      setLoad({ status: 'loaded', state, readAt: new Date() });
    } catch (error) {
      setLoad({ status: 'failed', message: describeError(error) });
    }
  }, [database]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;

    // Sonde : tâche vide placée dans la file partagée. Elle se résout dès que
    // la file arrive à elle. Si elle reste « en attente », le blocage est dans
    // la file elle-même, avant même tout accès au cache ou au réseau.
    const probeStartedAt = Date.now();
    setProbe({ status: 'pending', startedAt: probeStartedAt });
    void queue
      .run(() => Promise.resolve(null))
      .then(() => {
        if (active)
          setProbe({
            status: 'resolved',
            startedAt: probeStartedAt,
            endedAt: Date.now(),
            value: null,
          });
      })
      .catch((error: unknown) => {
        if (active)
          setProbe({
            status: 'failed',
            startedAt: probeStartedAt,
            endedAt: Date.now(),
            message: describeError(error),
          });
      });

    // Appel réel, identique à celui de `useUpdateNotice` : même base, même
    // file partagée, mêmes options.
    const checkStartedAt = Date.now();
    setCheck({ status: 'pending', startedAt: checkStartedAt });
    void checkForUpdate(database, {
      runDatabaseTask: (task) => queue.run(task),
    })
      .then((notice) => {
        if (active)
          setCheck({
            status: 'resolved',
            startedAt: checkStartedAt,
            endedAt: Date.now(),
            value: notice,
          });
      })
      .catch((error: unknown) => {
        // `checkForUpdate` ne rejette jamais ; ce cas resterait une anomalie.
        if (active)
          setCheck({
            status: 'failed',
            startedAt: checkStartedAt,
            endedAt: Date.now(),
            message: describeError(error),
          });
      });

    return () => {
      active = false;
    };
  }, [database, queue]);

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: 'Cache mise à jour' }}
      />

      <Card>
        <SectionTitle>File SQLite partagée</SectionTitle>
        <Field
          label="Sonde : queue.run(tâche vide)"
          value={describeCall(probe, now, () => 'file disponible')}
        />
        <Text style={styles.note}>
          Sonde encore « en attente » après quelques secondes : la file est
          bloquée par une autre tâche automatique (synchronisation des rappels,
          réconciliation des reports, action de notification).
        </Text>
      </Card>

      <Card>
        <SectionTitle>Appel réel checkForUpdate</SectionTitle>
        <Field
          label="checkForUpdate(database, { runDatabaseTask: queue.run })"
          value={describeCall(check, now, (notice) =>
            notice === null
              ? 'null — aucune bannière'
              : `bannière ${notice.version} → ${notice.downloadUrl}`,
          )}
        />
        <Text style={styles.note}>
          L’appel réseau est déjà borné à{' '}
          {formatDuration(GITHUB_REQUEST_TIMEOUT_MS)} : au-delà d’une dizaine de
          secondes en « en attente », le blocage vient de la file, pas de
          GitHub. S’il se résout vite en « null », regarder les panneaux
          ci-dessous : la décision s’appuie sur un cache non rafraîchi.
        </Text>
      </Card>

      <CacheState load={load} reload={reload} />
    </Screen>
  );
}

function CacheState({
  load,
  reload,
}: {
  load: LoadState;
  reload: () => Promise<void>;
}) {
  if (load.status === 'loading') {
    return <LoadingState label="Lecture de update_check_settings…" />;
  }

  if (load.status === 'failed') {
    return (
      <>
        <Message tone="error" title="Lecture impossible">
          {load.message}
        </Message>
        <AppButton label="Réessayer" onPress={() => void reload()} />
      </>
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
    <>
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
        <SectionTitle>Décision sur le cache lu</SectionTitle>
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

      <AppButton
        label="Relire le cache (sans appeler GitHub)"
        variant="secondary"
        onPress={() => void reload()}
      />
      <Text style={styles.note}>
        Écran de diagnostic temporaire. Cette relecture ne passe pas par la file
        et n’écrit rien.
      </Text>
    </>
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

/** « en attente depuis 42s », ou « résolu à 14:03:11 (après 118ms) : … ». */
function describeCall<T>(
  call: TimedCall<T> | null,
  now: number,
  describeValue: (value: T) => string,
): string {
  if (call === null) return 'pas encore lancé';
  if (call.status === 'pending')
    return `en attente depuis ${formatMilliseconds(now - call.startedAt)} (lancé à ${formatClock(call.startedAt)})`;

  const duration = formatMilliseconds(call.endedAt - call.startedAt);
  const when = `${formatClock(call.endedAt)} (après ${duration})`;
  return call.status === 'failed'
    ? `échec à ${when} : ${call.message}`
    : `résolu à ${when} : ${describeValue(call.value)}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatMilliseconds(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
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
  if (milliseconds < 60000) return formatMilliseconds(milliseconds);
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
