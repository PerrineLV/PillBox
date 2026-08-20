import medicationReferenceAsset from '../../../assets/medications/medications.db';
import {
  SQLiteProvider,
  useSQLiteContext,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { createContext, useContext, type ReactNode } from 'react';

const MedicationReferenceDatabaseContext = createContext<SQLiteDatabase | null>(
  null,
);

/**
 * Ouvre le référentiel BDPM une seule fois pour toute l'arborescence de
 * navigation. Le contexte dédié évite de masquer la connexion `pillbox.db`,
 * elle aussi fournie par un `SQLiteProvider` imbriqué.
 */
export function MedicationReferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SQLiteProvider
      databaseName="medication-reference.db"
      assetSource={{
        assetId: medicationReferenceAsset,
        forceOverwrite: true,
      }}
      options={{ useNewConnection: true }}
    >
      <MedicationReferenceDatabaseContextProvider>
        {children}
      </MedicationReferenceDatabaseContextProvider>
    </SQLiteProvider>
  );
}

function MedicationReferenceDatabaseContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const database = useSQLiteContext();
  return (
    <MedicationReferenceDatabaseContext.Provider value={database}>
      {children}
    </MedicationReferenceDatabaseContext.Provider>
  );
}

/** Retourne la connexion BDPM partagée par tous les écrans. */
export function useMedicationReferenceDatabase(): SQLiteDatabase {
  const database = useContext(MedicationReferenceDatabaseContext);
  // Les tests unitaires de composants montent parfois le sous-arbre seul avec
  // leur contexte SQLite simulé. Dans l'application, `database` est toujours
  // fourni par `MedicationReferenceProvider` et reste donc la connexion BDPM
  // partagée, indépendamment de la connexion personnelle imbriquée.
  const standaloneDatabase = useSQLiteContext();
  return database ?? standaloneDatabase;
}
