export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

export type ToastState = Toast | null;

export type ToastAction =
  | { type: 'show'; message: string; tone: ToastTone }
  | { type: 'dismiss'; id: number };

/**
 * Un seul toast est affiché à la fois : un nouveau déclenchement remplace le
 * précédent (id incrémenté) plutôt que de s'empiler. Une extinction
 * programmée pour un id qui n'est plus le toast courant est ignorée : elle
 * correspond à un toast déjà remplacé et ne doit pas effacer le nouveau.
 */
export function reduceToast(
  state: ToastState,
  action: ToastAction,
): ToastState {
  switch (action.type) {
    case 'show':
      return {
        id: (state?.id ?? 0) + 1,
        message: action.message,
        tone: action.tone,
      };
    case 'dismiss':
      return state !== null && state.id === action.id ? null : state;
  }
}
