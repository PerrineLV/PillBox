import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

import { todayIso } from '@/domain/inventory/inventory';

/** Recalcule à minuit local, au focus et au retour au premier plan. */
export function usePrescriptionToday(): string {
  const [today, setToday] = useState(todayIso);
  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setTimeout>;
      const refresh = () => {
        clearTimeout(timer);
        setToday(todayIso());
        const now = new Date();
        const midnight = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1,
        );
        timer = setTimeout(refresh, midnight.getTime() - now.getTime());
      };
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        clearTimeout(timer);
        subscription.remove();
      };
    }, []),
  );
  return today;
}
