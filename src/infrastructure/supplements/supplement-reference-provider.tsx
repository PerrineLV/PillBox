import supplementReferenceAsset from '../../../assets/medications/compl-alim.db';
import {
  SQLiteProvider,
  useSQLiteContext,
  type SQLiteDatabase,
} from 'expo-sqlite';
import { createContext, useContext, type ReactNode } from 'react';

const SupplementReferenceContext = createContext<SQLiteDatabase | null>(null);

export function SupplementReferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SQLiteProvider
      databaseName="compl-alim-reference.db"
      assetSource={{ assetId: supplementReferenceAsset, forceOverwrite: true }}
      options={{ useNewConnection: true }}
    >
      <SupplementReferenceContextProvider>
        {children}
      </SupplementReferenceContextProvider>
    </SQLiteProvider>
  );
}

function SupplementReferenceContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const database = useSQLiteContext();
  return (
    <SupplementReferenceContext.Provider value={database}>
      {children}
    </SupplementReferenceContext.Provider>
  );
}

export function useSupplementReferenceDatabase(): SQLiteDatabase {
  const database = useContext(SupplementReferenceContext);
  if (database === null)
    throw new Error('Référentiel Compl’Alim indisponible.');
  return database;
}
