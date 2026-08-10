import { createSerialTaskQueue } from '../serial-task-queue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: Error) => void;
} {
  let resolve = (): void => undefined;
  let reject = (_reason: Error): void => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Laisse la file enchaîner ses tâches déjà prêtes. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('file d’exécution sérielle des accès à la base', () => {
  it('n’exécute jamais deux tâches en même temps', async () => {
    const queue = createSerialTaskQueue();
    const started: string[] = [];
    const finished: string[] = [];
    const first = deferred();
    const second = deferred();

    const runs = [
      queue.run(async () => {
        started.push('a');
        await first.promise;
        finished.push('a');
      }),
      queue.run(async () => {
        started.push('b');
        await second.promise;
        finished.push('b');
      }),
    ];

    // La seconde tâche est lancée alors que la première n’est pas terminée.
    await flush();
    expect(started).toEqual(['a']);

    first.resolve();
    await flush();
    expect(started).toEqual(['a', 'b']);

    second.resolve();
    await Promise.all(runs);
    expect(finished).toEqual(['a', 'b']);
  });

  it('rend la valeur de la tâche à son appelant', async () => {
    const queue = createSerialTaskQueue();
    await expect(queue.run(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('n’interrompt pas la file quand une tâche échoue', async () => {
    const queue = createSerialTaskQueue();
    const failure = queue.run(() => Promise.reject(new Error('écriture')));
    const next = queue.run(() => Promise.resolve('suivante'));

    await expect(failure).rejects.toThrow('écriture');
    await expect(next).resolves.toBe('suivante');
  });

  it('place une tâche prioritaire devant celles qui attendent, jamais devant celle en cours', async () => {
    const queue = createSerialTaskQueue();
    const order: string[] = [];
    const running = deferred();

    const runs = [
      queue.run(async () => {
        order.push('en cours');
        await running.promise;
      }),
      queue.run(() => {
        order.push('en attente');
        return Promise.resolve();
      }),
    ];
    await flush();

    runs.push(
      queue.run(
        () => {
          order.push('prioritaire');
          return Promise.resolve();
        },
        { first: true },
      ),
    );

    running.resolve();
    await Promise.all(runs);
    expect(order).toEqual(['en cours', 'prioritaire', 'en attente']);
  });
});
