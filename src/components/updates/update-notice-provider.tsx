import { createContext, useContext, type ReactNode } from 'react';

import { useUpdateNotice } from './use-update-notice';
import type { UpdateNotice } from '@/domain/updates/update-notice';

type UpdateNoticeState = Readonly<{
  notice: UpdateNotice | null;
  download(): void;
  postpone(): void;
}>;

const UpdateNoticeContext = createContext<UpdateNoticeState | null>(null);

/**
 * Une seule vérification de version pour toute l'application.
 *
 * Deux surfaces la consomment : la carte de l'écran Plus et la pastille de
 * l'onglet du même nom. Sans état partagé, chacune interrogerait GitHub de son
 * côté et écarter la carte laisserait la pastille allumée.
 */
export function UpdateNoticeProvider({ children }: { children: ReactNode }) {
  return (
    <UpdateNoticeContext.Provider value={useUpdateNotice()}>
      {children}
    </UpdateNoticeContext.Provider>
  );
}

export function useUpdateNoticeState(): UpdateNoticeState {
  const context = useContext(UpdateNoticeContext);
  if (context === null)
    throw new Error(
      'useUpdateNoticeState doit être utilisé sous UpdateNoticeProvider.',
    );
  return context;
}
