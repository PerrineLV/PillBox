import { SQLiteProvider } from 'expo-sqlite';
import {
  Component,
  createContext,
  useContext,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  createSerialTaskQueue,
  type SerialTaskQueue,
} from './serial-task-queue';
import { initializeSQLiteDatabase } from './sqlite-connection';
import { logCrash } from '@/infrastructure/logging/crash-logger';

const DATABASE_NAME = 'pillbox.db';

interface DatabaseProviderProps {
  children: ReactNode;
}

interface DatabaseErrorBoundaryState {
  error: Error | null;
}

const DatabaseTaskQueueContext = createContext<SerialTaskQueue | null>(null);

/**
 * File partagée par les accès SQLite lancés automatiquement (synchronisation
 * des rappels, réconciliation des reports, actions de notification en attente,
 * vérification de mise à jour). Une seule de ces opérations s’exécute à la
 * fois, quel que soit l’ordre de montage des composants.
 */
export function useDatabaseTaskQueue(): SerialTaskQueue {
  const queue = useContext(DatabaseTaskQueueContext);
  if (queue === null)
    throw new Error('useDatabaseTaskQueue exige un DatabaseProvider parent.');
  return queue;
}

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  const queue = useRef<SerialTaskQueue | null>(null);
  queue.current ??= createSerialTaskQueue();
  return (
    <DatabaseErrorBoundary>
      <DatabaseTaskQueueContext.Provider value={queue.current}>
        <SQLiteProvider
          databaseName={DATABASE_NAME}
          onInit={initializeSQLiteDatabase}
        >
          {children}
        </SQLiteProvider>
      </DatabaseTaskQueueContext.Provider>
    </DatabaseErrorBoundary>
  );
}

class DatabaseErrorBoundary extends Component<
  DatabaseProviderProps,
  DatabaseErrorBoundaryState
> {
  state: DatabaseErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DatabaseErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    void logCrash(error);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <View style={styles.container}>
          <Text accessibilityRole="alert" style={styles.title}>
            Impossible de mettre à jour la base locale
          </Text>
          <Text style={styles.message}>
            La migration locale a échoué. Aucun détail de donnée ni chemin de
            fichier n’est affiché.
          </Text>
          <Text style={styles.message}>
            La base n’a pas été réinitialisée. Fermez l’application et
            réessayez.
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
});
