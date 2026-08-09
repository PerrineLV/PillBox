import {
  DatabaseMigrationError,
  runMigrations,
  type MigrationStore,
  type MigrationTransaction,
  type SchemaMigration,
} from '../migration-runner';
import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from '../schema-migrations';

interface MemoryState {
  appliedVersions: number[];
  executedStatements: string[];
}

class MemoryMigrationStore implements MigrationStore {
  private state: MemoryState;
  transactionCount = 0;

  constructor(appliedVersions: readonly number[] = []) {
    this.state = {
      appliedVersions: [...appliedVersions],
      executedStatements: [],
    };
  }

  async runExclusiveTransaction(
    task: (transaction: MigrationTransaction) => Promise<void>,
  ): Promise<void> {
    this.transactionCount += 1;

    const transactionState: MemoryState = {
      appliedVersions: [...this.state.appliedVersions],
      executedStatements: [...this.state.executedStatements],
    };
    const transaction: MigrationTransaction = {
      async readAppliedVersions() {
        return [...transactionState.appliedVersions];
      },
      async execute(sql) {
        transactionState.executedStatements.push(sql);
      },
      async recordAppliedVersion(version) {
        transactionState.appliedVersions.push(version);
      },
    };

    await task(transaction);
    this.state = transactionState;
  }

  get appliedVersions(): readonly number[] {
    return this.state.appliedVersions;
  }

  get executedStatements(): readonly string[] {
    return this.state.executedStatements;
  }
}

describe('runMigrations', () => {
  it('amène une installation neuve directement au dernier schéma', async () => {
    const store = new MemoryMigrationStore();

    await runMigrations(store, SCHEMA_MIGRATIONS, LATEST_SCHEMA_VERSION);

    expect(store.appliedVersions).toEqual([1]);
    expect(store.executedStatements.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS schema_migrations',
    );
  });

  it.each(knownSchemaVersions())(
    'migre depuis la version connue %i',
    async (startingVersion) => {
      const store = new MemoryMigrationStore(versionsThrough(startingVersion));

      await runMigrations(store, SCHEMA_MIGRATIONS, LATEST_SCHEMA_VERSION);

      expect(store.appliedVersions).toEqual(
        versionsThrough(LATEST_SCHEMA_VERSION),
      );
      expect(store.transactionCount).toBe(1);
    },
  );

  it('ne rejoue pas une migration déjà appliquée', async () => {
    const store = new MemoryMigrationStore();

    await runMigrations(store, SCHEMA_MIGRATIONS, LATEST_SCHEMA_VERSION);
    const statementsAfterFirstRun = [...store.executedStatements];

    await runMigrations(store, SCHEMA_MIGRATIONS, LATEST_SCHEMA_VERSION);

    expect(store.appliedVersions).toEqual([1]);
    expect(store.executedStatements).toEqual(statementsAfterFirstRun);
    expect(store.transactionCount).toBe(2);
  });

  it('rollback toutes les étapes en attente si une migration échoue', async () => {
    const store = new MemoryMigrationStore([1]);
    const failingMigrations: readonly SchemaMigration[] = [
      ...SCHEMA_MIGRATIONS,
      {
        version: 2,
        name: 'étape valide avant l’échec',
        async up(transaction) {
          await transaction.execute('CREATE TABLE pending (id INTEGER);');
        },
      },
      {
        version: 3,
        name: 'migration volontairement invalide',
        async up(transaction) {
          await transaction.execute(
            'CREATE TABLE partial_change (id INTEGER);',
          );
          throw new Error('échec simulé');
        },
      },
    ];

    await expect(runMigrations(store, failingMigrations, 3)).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'La migration a été annulée sans conserver de modification partielle',
        ),
        migrationVersion: 3,
        name: DatabaseMigrationError.name,
      }),
    );

    expect(store.appliedVersions).toEqual([1]);
    expect(store.executedStatements).toEqual([]);

    const repairedMigrations: readonly SchemaMigration[] = [
      ...SCHEMA_MIGRATIONS,
      {
        version: 2,
        name: 'étape valide avant la correction',
        async up(transaction) {
          await transaction.execute('CREATE TABLE pending (id INTEGER);');
        },
      },
      {
        version: 3,
        name: 'migration corrigée',
        async up(transaction) {
          await transaction.execute('CREATE TABLE recovered (id INTEGER);');
        },
      },
    ];

    await runMigrations(store, repairedMigrations, 3);

    expect(store.appliedVersions).toEqual([1, 2, 3]);
    expect(store.executedStatements).toEqual([
      'CREATE TABLE pending (id INTEGER);',
      'CREATE TABLE recovered (id INTEGER);',
    ]);
  });

  it('refuse une base créée par une version plus récente de l’application', async () => {
    const store = new MemoryMigrationStore([1, 2]);

    await expect(
      runMigrations(store, SCHEMA_MIGRATIONS, LATEST_SCHEMA_VERSION),
    ).rejects.toThrow('plus récent');

    expect(store.transactionCount).toBe(1);
    expect(store.appliedVersions).toEqual([1, 2]);
  });
});

function knownSchemaVersions(): number[] {
  return [0, ...SCHEMA_MIGRATIONS.map((migration) => migration.version)];
}

function versionsThrough(version: number): number[] {
  return Array.from({ length: version }, (_value, index) => index + 1);
}
