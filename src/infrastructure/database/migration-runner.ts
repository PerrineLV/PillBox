export interface MigrationTransaction {
  readAppliedVersions(): Promise<readonly number[]>;
  execute(sql: string): Promise<void>;
  recordAppliedVersion(version: number): Promise<void>;
}

export interface MigrationStore {
  runExclusiveTransaction(
    task: (transaction: MigrationTransaction) => Promise<void>,
  ): Promise<void>;
}

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  up(transaction: MigrationTransaction): Promise<void>;
}

export class DatabaseMigrationError extends Error {
  readonly migrationVersion: number;
  readonly cause: unknown;

  constructor(migration: SchemaMigration, cause: unknown) {
    super(
      `La mise à jour de la base locale a échoué à l’étape ${migration.version} ` +
        `(${migration.name}). La migration a été annulée sans conserver de modification ` +
        'partielle. Le détail technique a été neutralisé pour protéger les données locales.',
    );
    this.name = 'DatabaseMigrationError';
    this.migrationVersion = migration.version;
    this.cause = cause;
  }
}

export async function runMigrations(
  store: MigrationStore,
  migrations: readonly SchemaMigration[],
  latestSchemaVersion: number,
): Promise<void> {
  validateMigrationPlan(migrations, latestSchemaVersion);

  await store.runExclusiveTransaction(async (transaction) => {
    const appliedVersions = await transaction.readAppliedVersions();
    validateAppliedVersions(appliedVersions, latestSchemaVersion);

    const currentVersion = appliedVersions.at(-1) ?? 0;
    const pendingMigrations = migrations.filter(
      (migration) => migration.version > currentVersion,
    );

    for (const migration of pendingMigrations) {
      try {
        await migration.up(transaction);
        await transaction.recordAppliedVersion(migration.version);
      } catch (error: unknown) {
        throw new DatabaseMigrationError(migration, error);
      }
    }
  });
}

function validateMigrationPlan(
  migrations: readonly SchemaMigration[],
  latestSchemaVersion: number,
): void {
  if (!Number.isInteger(latestSchemaVersion) || latestSchemaVersion < 0) {
    throw new Error('La version cible du schéma SQLite est invalide.');
  }

  if (migrations.length !== latestSchemaVersion) {
    throw new Error(
      `Le plan de migrations SQLite est incomplet pour la version ${latestSchemaVersion}.`,
    );
  }

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `La migration SQLite ${expectedVersion} est absente ou dans le mauvais ordre.`,
      );
    }
  });
}

function validateAppliedVersions(
  appliedVersions: readonly number[],
  latestSchemaVersion: number,
): void {
  appliedVersions.forEach((version, index) => {
    const expectedVersion = index + 1;
    if (version !== expectedVersion) {
      throw new Error(
        `L’historique SQLite est incohérent : version ${expectedVersion} attendue.`,
      );
    }
  });

  const currentVersion = appliedVersions.at(-1) ?? 0;
  if (currentVersion > latestSchemaVersion) {
    throw new Error(
      `La base locale utilise le schéma ${currentVersion}, plus récent que le schéma ` +
        `${latestSchemaVersion} pris en charge par cette version de l’application.`,
    );
  }
}
