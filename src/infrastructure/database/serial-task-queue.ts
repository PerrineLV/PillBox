/**
 * File d’exécution sérielle des accès SQLite déclenchés automatiquement.
 *
 * Plusieurs composants montés sous `DatabaseProvider` lancent leurs propres
 * lectures et écritures dès leur montage, juste après la migration. Comme
 * `withExclusiveTransactionAsync` ouvre sa propre connexion, deux écritures qui
 * se chevauchent se disputent le verrou du fichier et SQLite refuse la seconde
 * (« database is locked »). La file garantit qu’une seule de ces opérations est
 * en cours à un instant donné, sans imposer d’ordre de montage aux composants
 * ni modifier leur logique.
 *
 * Elle ne couvre que les opérations automatiques : les écritures déclenchées
 * par une action explicite à l’écran restent directes.
 */

export type DatabaseTask<T> = () => Promise<T>;

/** Exécute une tâche en respectant la sérialisation en vigueur. */
export type TaskRunner = <T>(task: DatabaseTask<T>) => Promise<T>;

export interface TaskQueueOptions {
  /**
   * Place la tâche devant celles qui attendent, jamais devant celle en cours.
   * Réservé aux actions déclenchées hors de l’application, qui doivent aboutir
   * sans attendre la fin d’une synchronisation.
   */
  readonly first?: boolean;
}

export interface SerialTaskQueue {
  run<T>(task: DatabaseTask<T>, options?: TaskQueueOptions): Promise<T>;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  const waiting: (() => Promise<void>)[] = [];
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      for (
        let next = waiting.shift();
        next !== undefined;
        next = waiting.shift()
      )
        await next();
    } finally {
      draining = false;
    }
  }

  return {
    run<T>(task: DatabaseTask<T>, options?: TaskQueueOptions): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        // L’échec d’une tâche est rendu à son seul appelant : la file continue
        // de vider les suivantes, sinon une erreur réseau ou de permission
        // bloquerait durablement tous les accès automatiques à la base.
        const step = async (): Promise<void> => {
          try {
            resolve(await task());
          } catch (error: unknown) {
            reject(error);
          }
        };
        if (options?.first === true) waiting.unshift(step);
        else waiting.push(step);
        void drain();
      });
    },
  };
}
