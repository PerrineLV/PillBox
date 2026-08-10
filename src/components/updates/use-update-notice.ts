import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import type { UpdateNotice } from '@/domain/updates/update-notice';
import {
  checkForUpdate,
  postponeUpdate,
} from '@/infrastructure/updates/update-check-service';

/**
 * Vérifie la disponibilité d'une nouvelle version au lancement puis à chaque
 * retour au premier plan — jamais à chaque changement d'écran. Le service
 * applique en plus son propre intervalle avant de solliciter le réseau.
 */
export function useUpdateNotice(): {
  notice: UpdateNotice | null;
  download(): void;
  postpone(): void;
} {
  const database = useSQLiteContext();
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    let active = true;
    const check = () => {
      void checkForUpdate(database).then((result) => {
        if (active) setNotice(result);
      });
    };

    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [database]);

  const download = useCallback(() => {
    if (notice === null) return;
    // L'installation reste une action explicite : PillBox ouvre simplement le
    // lien GitHub dans le navigateur et ne télécharge ni n'installe rien.
    void Linking.openURL(notice.downloadUrl).catch(() => {
      /* Un navigateur indisponible ne doit pas interrompre l'application. */
    });
  }, [notice]);

  const postpone = useCallback(() => {
    if (notice === null) return;
    setNotice(null);
    void postponeUpdate(database, notice.version);
  }, [database, notice]);

  return { notice, download, postpone };
}
