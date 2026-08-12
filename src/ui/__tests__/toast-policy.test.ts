import {
  reduceToast,
  type ToastAction,
  type ToastState,
} from '../toast-policy';

function apply(actions: readonly ToastAction[]): ToastState {
  return actions.reduce(reduceToast, null as ToastState);
}

describe('affichage', () => {
  it('n’affiche aucun toast au départ', () => {
    expect(apply([])).toBeNull();
  });

  it('affiche le message et le ton demandés', () => {
    const state = apply([
      { type: 'show', message: 'Rappel désactivé.', tone: 'success' },
    ]);
    expect(state).toMatchObject({
      message: 'Rappel désactivé.',
      tone: 'success',
    });
  });
});

describe('remplacement sans empilement', () => {
  it('remplace le toast précédent par le nouveau plutôt que de les cumuler', () => {
    const state = apply([
      { type: 'show', message: 'Premier message.', tone: 'info' },
      { type: 'show', message: 'Second message.', tone: 'error' },
    ]);
    expect(state).toMatchObject({
      message: 'Second message.',
      tone: 'error',
    });
  });

  it('attribue un identifiant différent à chaque nouveau toast', () => {
    const first = apply([
      { type: 'show', message: 'Premier message.', tone: 'info' },
    ]);
    const second = apply([
      { type: 'show', message: 'Premier message.', tone: 'info' },
      { type: 'show', message: 'Second message.', tone: 'info' },
    ]);
    expect(first?.id).not.toBe(second?.id);
  });
});

describe('extinction automatique', () => {
  it('efface le toast quand l’extinction programmée correspond au toast affiché', () => {
    const shown = reduceToast(null, {
      type: 'show',
      message: 'Sauvegarde exportée.',
      tone: 'success',
    });
    const state = reduceToast(shown, { type: 'dismiss', id: shown!.id });
    expect(state).toBeNull();
  });

  it('ignore une extinction programmée pour un toast déjà remplacé', () => {
    const first = reduceToast(null, {
      type: 'show',
      message: 'Premier message.',
      tone: 'info',
    });
    const second = reduceToast(first, {
      type: 'show',
      message: 'Second message.',
      tone: 'success',
    });
    // L'extinction programmée pour le premier toast arrive après son
    // remplacement : elle ne doit pas effacer le second, encore affiché.
    const state = reduceToast(second, { type: 'dismiss', id: first!.id });
    expect(state).toMatchObject({ message: 'Second message.' });
  });
});
