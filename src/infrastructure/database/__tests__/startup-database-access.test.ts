/**
 * Reproduit l’enchaînement du démarrage : deux écritures transactionnelles
 * lancées ensemble, sur deux connexions distinctes — ce que fait
 * `withExclusiveTransactionAsync`, qui ouvre sa propre connexion à chaque appel.
 *
 * Sans la file, la seconde écriture se heurte au verrou d’écriture pris par la
 * première (« database is locked ») ou, si elle l’obtient, s’applique avant elle.
 * Le test vérifie que la file les exécute l’une après l’autre, dans l’ordre.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSerialTaskQueue } from '../serial-task-queue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe('accès concurrents au démarrage', () => {
  let directory = '';
  let connections: Database.Database[] = [];

  function connect(): Database.Database {
    const connection = new Database(join(directory, 'pillbox.db'));
    connection.pragma('journal_mode = WAL');
    // better-sqlite3 est synchrone : une attente sur le verrou bloquerait le
    // fil du test au lieu de laisser l’autre écriture se terminer.
    connection.pragma('busy_timeout = 0');
    connections.push(connection);
    return connection;
  }

  /** Écriture transactionnelle qui reste ouverte tant que `hold` n’est pas tenue. */
  async function write(
    connection: Database.Database,
    value: string,
    hold: Promise<void>,
  ): Promise<void> {
    connection.exec('BEGIN IMMEDIATE');
    try {
      await hold;
      connection.prepare('INSERT INTO probe (value) VALUES (?)').run(value);
      connection.exec('COMMIT');
    } catch (reason: unknown) {
      connection.exec('ROLLBACK');
      throw reason;
    }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pillbox-startup-'));
    connections = [];
    connect().exec(
      'CREATE TABLE probe (id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    );
  });

  afterEach(() => {
    for (const connection of connections) connection.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it('exécute les deux écritures l’une après l’autre lorsqu’elles sont mises en file', async () => {
    const queue = createSerialTaskQueue();
    const release = deferred();
    const reminders = connect();
    const notification = connect();

    // La première écriture reste ouverte : sans la file, la seconde s’exécuterait
    // pendant sa transaction.
    const first = queue.run(() => write(reminders, 'rappels', release.promise));
    const second = queue.run(() =>
      write(notification, 'notification', Promise.resolve()),
    );
    release.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(
      connections[0].prepare('SELECT value FROM probe ORDER BY id').all(),
    ).toEqual([{ value: 'rappels' }, { value: 'notification' }]);
  });
});
