import { Stack } from 'expo-router';

import { DatabaseProvider } from '@/infrastructure/database/database-provider';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </DatabaseProvider>
  );
}
