import { isIntakeSlot, type IntakeSlot } from '@/domain/treatments/treatment';

/**
 * Ce que PillBox doit ouvrir lorsqu’une notification locale est touchée.
 *
 * La décision est volontairement séparée d’Expo Router et d’`expo-notifications` :
 * elle doit rester testable, et surtout elle ne doit jamais s’exécuter avant que
 * l’arbre de navigation soit monté. Sur un démarrage à froid déclenché par une
 * notification, la base SQLite s’ouvre encore et le verrou local peut masquer le
 * contenu : le `<Stack>` n’existe pas et toute navigation immédiate lève une
 * erreur fatale qui empêche l’application de s’ouvrir.
 */

export const PREPARATION_REMINDER_KIND = 'pillbox-preparation-reminder';
export const INTAKE_REMINDER_KIND = 'pillbox-intake-reminder';
export const POSTPONED_INTAKE_KIND = 'pillbox-postponed-intake-reminder';
/**
 * Rappel dédié au complément d'une case « en attente de complément » d'un
 * traitement à délivrance encadrée (ticket 30b) : mécanisme séparé du rappel
 * hebdomadaire de préparation et des rappels quotidiens de prise ci-dessus.
 */
export const PENDING_COMPLETION_REMINDER_KIND =
  'pillbox-pending-completion-reminder';

export const PREPARATION_ROUTE = '/preparations/new' as const;
export const PLANNED_INTAKE_ROUTE = '/intakes/planned' as const;
/** Repli lorsque la préparation et le médicament concernés ne sont pas connus. */
export const PENDING_COMPLETION_ROUTE = '/preparations/history' as const;
/** Cible directe lorsque la notification transporte préparation et médicament. */
export const PENDING_COMPLETION_COMPLETE_ROUTE =
  '/preparations/complete' as const;

export interface IntakeGroupReference {
  readonly date: string;
  readonly slot: IntakeSlot;
}

export type NotificationTarget =
  | { readonly kind: 'preparation' }
  | {
      readonly kind: 'planned-intake';
      readonly at: string;
      readonly groups: readonly IntakeGroupReference[];
    }
  | ({ readonly kind: 'postponed-intake' } & IntakeGroupReference)
  | {
      readonly kind: 'pending-completion';
      /**
       * Préparation et médicament concernés, lorsque la notification les
       * transporte de façon exploitable (ticket 41) ; `null` pour une
       * notification programmée avant ce ticket ou une donnée illisible —
       * jamais une préparation ou un médicament devinés.
       */
      readonly preparationId: number | null;
      readonly specialtyCis: string | null;
    };

const GROUP_PATTERN = /^(\d{4}-\d{2}-\d{2}):([a-z]+)$/;

/**
 * Traduit les données transportées par une notification en écran à ouvrir.
 * Toute donnée inconnue, absente ou illisible renvoie `null` : PillBox ouvre
 * alors simplement son écran d’accueil plutôt que de deviner une destination.
 */
export function notificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  switch (record.kind) {
    case PREPARATION_REMINDER_KIND:
      return record.url === PREPARATION_ROUTE ? { kind: 'preparation' } : null;
    case INTAKE_REMINDER_KIND:
      return typeof record.scheduledAt === 'string'
        ? {
            kind: 'planned-intake',
            at: record.scheduledAt,
            groups: parseIntakeGroups(record.groups),
          }
        : null;
    case POSTPONED_INTAKE_KIND:
      return typeof record.date === 'string' &&
        typeof record.slot === 'string' &&
        isIntakeSlot(record.slot)
        ? { kind: 'postponed-intake', date: record.date, slot: record.slot }
        : null;
    case PENDING_COMPLETION_REMINDER_KIND: {
      const validPreparationId =
        typeof record.preparationId === 'number' &&
        Number.isSafeInteger(record.preparationId) &&
        record.preparationId > 0;
      const validSpecialtyCis =
        typeof record.specialtyCis === 'string' &&
        record.specialtyCis.length > 0;
      return {
        kind: 'pending-completion',
        preparationId:
          validPreparationId && validSpecialtyCis
            ? (record.preparationId as number)
            : null,
        specialtyCis:
          validPreparationId && validSpecialtyCis
            ? (record.specialtyCis as string)
            : null,
      };
    }
    default:
      return null;
  }
}

export function parseIntakeGroups(raw: unknown): IntakeGroupReference[] {
  if (typeof raw !== 'string') return [];
  return raw.split(',').flatMap((item) => {
    const match = GROUP_PATTERN.exec(item);
    if (match === null || !isIntakeSlot(match[2])) return [];
    const date = new Date(`${match[1]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== match[1]
      ? []
      : [{ date: match[1], slot: match[2] }];
  });
}

export function serializeIntakeGroups(
  groups: readonly IntakeGroupReference[],
): string {
  return groups.map((group) => `${group.date}:${group.slot}`).join(',');
}

export interface DeferredNotificationNavigation {
  /** Enregistre l’appui sur une notification et navigue dès que possible. */
  request(target: NotificationTarget): void;
  /** Rejoue l’appui en attente, typiquement quand le routeur vient de se monter. */
  flush(): void;
}

export function createDeferredNotificationNavigation(options: {
  /** Vrai uniquement lorsque l’arbre de navigation accepte une navigation. */
  isReady: () => boolean;
  navigate: (target: NotificationTarget) => void;
  /** Marque la réponse comme traitée pour ne pas la rejouer au prochain montage. */
  acknowledge: () => void;
}): DeferredNotificationNavigation {
  let pending: NotificationTarget | null = null;

  function flush(): void {
    if (pending === null || !options.isReady()) return;
    const target = pending;
    pending = null;
    try {
      options.navigate(target);
    } catch {
      // Arriver sur le bon écran est un confort ; ouvrir l’application est la
      // garantie attendue. Aucune donnée de la notification n’est journalisée.
    }
    options.acknowledge();
  }

  return {
    request(target) {
      pending = target;
      flush();
    },
    flush,
  };
}
