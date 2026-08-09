import { SQLiteProvider } from 'expo-sqlite';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { migrateSQLiteDatabase } from './sqlite-migrations';

const DATABASE_NAME = 'pillbox.db';

interface DatabaseProviderProps {
  children: ReactNode;
}

interface DatabaseErrorBoundaryState {
  error: Error | null;
}

export function DatabaseProvider({ children }: DatabaseProviderProps) {
  return (
    <DatabaseErrorBoundary>
      <SQLiteProvider
        databaseName={DATABASE_NAME}
        onInit={migrateSQLiteDatabase}
      >
        {children}
      </SQLiteProvider>
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

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // L’erreur est présentée localement. Aucun reset automatique n’est tenté.
  }

  render() {
    if (this.state.error !== null) {
      return (
        <View style={styles.container}>
          <Text accessibilityRole="alert" style={styles.title}>
            Impossible de mettre à jour la base locale
          </Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
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
