import type { SQLiteDatabase, SQLiteRunResult } from 'expo-sqlite';

import {
  allocateItemCompletion,
  type ItemCompletionStatus,
} from '@/domain/preparations/pending-completion';
import {
  assertVerificationEvidence,
  BOX_VERIFICATION_METHODS,
  type BoxVerificationMethod,
  type KnownPreparation,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';
import { INTAKE_SLOTS, type IntakeSlot } from '@/domain/treatments/treatment';

export type SavedPreparationProgress = Readonly<{
  specialtyCis: string;
  boxId: number;
  /** Quantité couverte par cette boîte : le reste du besoin est apporté par d'autres lignes. */
  quantityHalfUnits: number;
  verification: BoxVerificationMethod;
  /** Chaîne brute du DataMatrix, absente lorsque la boîte a été choisie dans le stock. */
  scanRaw: string | null;
  nonFefoAcknowledged: boolean;
  /**
   * CIS réellement utilisé lorsqu'il diffère de `specialtyCis` (autre membre
   * du même groupe générique officiel, confirmé explicitement) ; `null` pour
   * une correspondance exacte. `specialtyCis` continue de désigner le
   * médicament attendu, jamais celui réellement scanné.
   */
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

export type SavedPreparation = Readonly<{
  id: number;
  snapshot: PreparationSnapshot;
  progress: readonly SavedPreparationProgress[];
}>;

export type PreparationHistoryEntry = Readonly<{
  id: number;
  startDate: string;
  endDate: string;
  completedAt: string;
  medications: readonly Readonly<{
    specialtyCis: string;
    specialtyName: string;
    quantityHalfUnits: number;
    boxId: number;
    presentationCip13: string;
    presentationLabel: string;
    lot: string | null;
    expirationDate: string;
    verification: BoxVerificationMethod;
    matchedCis: string | null;
    matchedSpecialtyName: string | null;
  }>[];
}>;

/**
 * Semaines déjà connues localement. Sert à empêcher un doublon et à proposer la
 * reprise d'une préparation incomplète plutôt qu'une nouvelle.
 */
export async function listPreparationWeeks(
  database: SQLiteDatabase,
): Promise<KnownPreparation[]> {
  const rows = await database.getAllAsync<{
    id: number;
    start_date: string;
    status: string;
  }>(
    `SELECT id, start_date, status FROM preparations
     ORDER BY start_date DESC, id DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    status: toPreparationStatus(row.status),
  }));
}

/**
 * Persiste uniquement un nouveau snapshot ; aucune mise à jour de son contenu
 * n'est exposée. La transaction refuse un doublon pour une semaine déjà validée
 * ainsi qu'une seconde préparation en cours : l'annulation ou la validation de
 * la préparation existante reste un geste explicite.
 */
export async function createPreparation(
  database: SQLiteDatabase,
  snapshot: PreparationSnapshot,
): Promise<number> {
  let insert: SQLiteRunResult | null = null;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const completed = await transaction.getFirstAsync<{ id: number }>(
      `SELECT id FROM preparations WHERE start_date = ? AND status = 'COMPLETED'`,
      snapshot.startDate,
    );
    if (completed !== null) {
      throw new Error('Cette semaine a déjà été préparée et validée.');
    }
    const draft = await transaction.getFirstAsync<{ id: number }>(
      `SELECT id FROM preparations WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`,
    );
    if (draft !== null) {
      throw new Error(
        'Une préparation est déjà en cours. Reprenez-la ou annulez-la avant d’en démarrer une autre.',
      );
    }
    insert = await transaction.runAsync(
      `INSERT INTO preparations (start_date, end_date) VALUES (?, ?)`,
      snapshot.startDate,
      snapshot.endDate,
    );
    const preparationId = insert.lastInsertRowId;
    for (const item of snapshot.items) {
      await transaction.runAsync(
        `INSERT INTO preparation_items
         (preparation_id, source_treatment_id, specialty_cis, specialty_name,
          pharmaceutical_form, intake_date, slot, quantity_half_units)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        preparationId,
        item.treatmentId,
        item.specialtyCis,
        item.specialtyName,
        item.pharmaceuticalForm,
        item.date,
        item.slot,
        item.quantityHalfUnits,
      );
    }
    for (const requirement of snapshot.requirements) {
      await transaction.runAsync(
        `INSERT INTO preparation_requirements
         (preparation_id, specialty_cis, specialty_name, required_half_units,
          usable_stock_half_units, missing_half_units)
         VALUES (?, ?, ?, ?, ?, ?)`,
        preparationId,
        requirement.specialtyCis,
        requirement.specialtyName,
        requirement.requiredHalfUnits,
        requirement.usableStockHalfUnits,
        requirement.missingHalfUnits,
      );
    }
  });
  if (insert === null)
    throw new Error('La préparation n’a pas pu être enregistrée.');
  return (insert as SQLiteRunResult).lastInsertRowId;
}

export async function getLatestDraftPreparation(
  database: SQLiteDatabase,
): Promise<SavedPreparation | null> {
  const preparation = await database.getFirstAsync<{
    id: number;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id, start_date, end_date FROM preparations
     WHERE status = 'DRAFT' ORDER BY id DESC LIMIT 1`,
  );
  if (preparation === null) return null;
  const items = await database.getAllAsync<{
    source_treatment_id: number;
    specialty_cis: string;
    specialty_name: string;
    pharmaceutical_form: string | null;
    intake_date: string;
    slot: PreparationSnapshot['items'][number]['slot'];
    quantity_half_units: number;
  }>(
    `SELECT source_treatment_id, specialty_cis, specialty_name,
      pharmaceutical_form, intake_date, slot, quantity_half_units
     FROM preparation_items WHERE preparation_id = ? ORDER BY id`,
    preparation.id,
  );
  const requirements = await database.getAllAsync<{
    specialty_cis: string;
    specialty_name: string;
    required_half_units: number;
    usable_stock_half_units: number;
    missing_half_units: number;
  }>(
    `SELECT specialty_cis, specialty_name, required_half_units,
      usable_stock_half_units, missing_half_units
     FROM preparation_requirements WHERE preparation_id = ?
     ORDER BY specialty_name`,
    preparation.id,
  );
  const progress = await database.getAllAsync<{
    specialty_cis: string;
    box_id: number;
    quantity_half_units: number;
    verification: string;
    scan_raw: string;
    non_fefo_acknowledged: number;
    matched_cis: string | null;
    matched_specialty_name: string | null;
  }>(
    `SELECT specialty_cis, box_id, quantity_half_units, verification,
      scan_raw, non_fefo_acknowledged, matched_cis, matched_specialty_name
     FROM preparation_progress WHERE preparation_id = ? ORDER BY box_id`,
    preparation.id,
  );
  const hydratedRequirements = requirements.map((row) => ({
    specialtyCis: row.specialty_cis,
    specialtyName: row.specialty_name,
    requiredHalfUnits: row.required_half_units,
    usableStockHalfUnits: row.usable_stock_half_units,
    missingHalfUnits: row.missing_half_units,
  }));
  return {
    id: preparation.id,
    snapshot: {
      startDate: preparation.start_date,
      endDate: preparation.end_date,
      items: items.map((row) => ({
        treatmentId: row.source_treatment_id,
        specialtyCis: row.specialty_cis,
        specialtyName: row.specialty_name,
        pharmaceuticalForm: row.pharmaceutical_form,
        date: row.intake_date,
        slot: row.slot,
        quantityHalfUnits: row.quantity_half_units,
      })),
      requirements: hydratedRequirements,
      hasShortages: hydratedRequirements.some(
        (item) => item.missingHalfUnits > 0,
      ),
    },
    progress: progress.map((row) => ({
      specialtyCis: row.specialty_cis,
      boxId: row.box_id,
      quantityHalfUnits: row.quantity_half_units,
      verification: toVerificationMethod(row.verification),
      scanRaw: row.scan_raw === '' ? null : row.scan_raw,
      nonFefoAcknowledged: row.non_fefo_acknowledged === 1,
      matchedCis: row.matched_cis,
      matchedSpecialtyName: row.matched_specialty_name,
    })),
  };
}

/**
 * Enregistre la contribution d'une boîte au besoin d'un médicament. Plusieurs
 * boîtes peuvent contribuer au même médicament : la ligne est identifiée par
 * boîte, pas seulement par médicament, afin qu'une boîte qui se termine en
 * cours de préparation puisse être complétée par une seconde sans écraser la
 * première.
 */
export async function savePreparationProgress(
  database: SQLiteDatabase,
  preparationId: number,
  progress: SavedPreparationProgress,
): Promise<void> {
  assertVerificationEvidence(progress.verification, progress.scanRaw);
  assertGenericMatchConsistency(progress);
  await database.runAsync(
    `INSERT INTO preparation_progress
      (preparation_id, specialty_cis, box_id, quantity_half_units,
       verification, scan_raw, non_fefo_acknowledged, matched_cis,
       matched_specialty_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(preparation_id, specialty_cis, box_id) DO UPDATE SET
       quantity_half_units = excluded.quantity_half_units,
       verification = excluded.verification,
       scan_raw = excluded.scan_raw,
       non_fefo_acknowledged = excluded.non_fefo_acknowledged,
       matched_cis = excluded.matched_cis,
       matched_specialty_name = excluded.matched_specialty_name,
       completed_at = CURRENT_TIMESTAMP`,
    preparationId,
    progress.specialtyCis,
    progress.boxId,
    progress.quantityHalfUnits,
    progress.verification,
    progress.scanRaw ?? '',
    progress.nonFefoAcknowledged ? 1 : 0,
    progress.matchedCis,
    progress.matchedSpecialtyName,
  );
}

/**
 * Une correspondance générique n'a de sens que pour un CIS différent de celui
 * attendu, et les deux champs vont toujours de pair : c'est le filet de
 * sécurité de ce module, la légitimité de la correspondance elle-même (même
 * groupe générique officiel + confirmation explicite) ayant déjà été établie
 * par l'appelant avant d'atteindre ce repository.
 */
function assertGenericMatchConsistency(
  progress: SavedPreparationProgress,
): void {
  if (
    (progress.matchedCis === null) !==
    (progress.matchedSpecialtyName === null)
  ) {
    throw new Error(
      'matchedCis et matchedSpecialtyName doivent être renseignés ensemble.',
    );
  }
  if (progress.matchedCis === progress.specialtyCis) {
    throw new Error(
      'matchedCis ne peut pas être identique au CIS attendu : ce cas est une correspondance exacte.',
    );
  }
}

/**
 * Abandonne une préparation en cours. Le snapshot et la progression sont
 * effacés : une préparation jamais validée n'a produit aucun mouvement de stock
 * et ne doit rien laisser dans l'historique. L'appel est idempotent et refuse
 * catégoriquement de toucher une préparation déjà validée.
 */
export async function cancelPreparation(
  database: SQLiteDatabase,
  preparationId: number,
): Promise<void> {
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const preparation = await transaction.getFirstAsync<{ status: string }>(
      'SELECT status FROM preparations WHERE id = ?',
      preparationId,
    );
    if (preparation === null) return;
    if (preparation.status !== 'DRAFT') {
      throw new Error(
        'Cette préparation est déjà terminée : elle ne peut plus être annulée.',
      );
    }
    const movements = await transaction.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM stock_movements WHERE preparation_id = ?',
      preparationId,
    );
    if (movements !== null && movements.count > 0) {
      throw new Error(
        'Des mouvements de stock existent pour cette préparation : annulation refusée.',
      );
    }
    await transaction.runAsync(
      'DELETE FROM preparation_progress WHERE preparation_id = ?',
      preparationId,
    );
    await transaction.runAsync(
      'DELETE FROM preparation_requirements WHERE preparation_id = ?',
      preparationId,
    );
    await transaction.runAsync(
      'DELETE FROM preparation_items WHERE preparation_id = ?',
      preparationId,
    );
    const deleted = await transaction.runAsync(
      `DELETE FROM preparations WHERE id = ? AND status = 'DRAFT'`,
      preparationId,
    );
    if (deleted.changes !== 1) {
      throw new Error('La préparation n’a pas pu être annulée.');
    }
  });
}

/**
 * Valide et consomme une préparation en une transaction exclusive. Toutes les
 * données de lot utiles à l'historique sont copiées au moment de la validation.
 *
 * Pour un médicament dont au moins un traitement source a la délivrance
 * encadrée active (ticket 30), une couverture inférieure au besoin — y
 * compris nulle — est acceptée : les cases non couvertes passent à l'état
 * « en attente de complément » (ticket 30b) plutôt que de bloquer la
 * validation. Pour tout autre médicament, le comportement historique est
 * inchangé : la couverture doit rester exacte. Retourne les CIS laissés en
 * attente, pour que l'appelant puisse y planifier le rappel dédié.
 */
export async function completePreparation(
  database: SQLiteDatabase,
  preparationId: number,
  completionDate: string,
): Promise<readonly string[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    throw new Error('La date de validation est invalide.');
  }
  const pendingSpecialtyCis: string[] = [];
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const preparation = await transaction.getFirstAsync<{ status: string }>(
      'SELECT status FROM preparations WHERE id = ?',
      preparationId,
    );
    if (preparation === null) throw new Error('Préparation introuvable.');
    if (preparation.status !== 'DRAFT') {
      throw new Error('Cette préparation est déjà terminée.');
    }

    const requirements = await transaction.getAllAsync<{
      specialty_cis: string;
      specialty_name: string;
      required_half_units: number;
    }>(
      `SELECT specialty_cis, specialty_name, required_half_units
       FROM preparation_requirements WHERE preparation_id = ?
       ORDER BY specialty_name`,
      preparationId,
    );

    for (const requirement of requirements) {
      // Un traitement couvert par une ligne d'ordonnance en mode FRACTIONAL
      // (ticket 45, anciennement `controlledDispensing` sur Treatment)
      // tolère une couverture partielle ou nulle ; tout autre traitement
      // conserve l'exigence historique de couverture exacte. Un même CIS
      // partagé par plusieurs traitements est relâché dès que l'un d'eux a
      // au moins une ligne FRACTIONAL.
      const controlledDispensingRow = await transaction.getFirstAsync<{
        active: number;
      }>(
        `SELECT EXISTS(
           SELECT 1 FROM preparation_items pi
           JOIN prescription_items presc ON presc.treatment_id = pi.source_treatment_id
           WHERE pi.preparation_id = ? AND pi.specialty_cis = ?
             AND presc.dispensing_mode = 'FRACTIONAL'
         ) AS active`,
        preparationId,
        requirement.specialty_cis,
      );
      const controlledDispensingActive = controlledDispensingRow?.active === 1;

      // Un même médicament peut être couvert par plusieurs boîtes lorsque la
      // première s'est terminée en cours de préparation : chaque ligne de
      // progression est une contribution distincte, décrémentée séparément.
      const usages = await transaction.getAllAsync<{
        box_id: number;
        quantity_half_units: number;
        verification: string;
        matched_cis: string | null;
        matched_specialty_name: string | null;
        box_specialty_cis: string | null;
        presentation_cip13: string | null;
        presentation_label: string | null;
        lot: string | null;
        expiration_date: string | null;
        remaining_quantity: number | null;
      }>(
        `SELECT progress.box_id, progress.quantity_half_units,
          progress.verification, progress.matched_cis,
          progress.matched_specialty_name,
          box.specialty_cis AS box_specialty_cis,
          box.presentation_cip13, box.presentation_label, box.lot,
          box.expiration_date, box.remaining_quantity
         FROM preparation_progress progress
         LEFT JOIN medication_boxes box ON box.id = progress.box_id
         WHERE progress.preparation_id = ? AND progress.specialty_cis = ?
         ORDER BY progress.box_id`,
        preparationId,
        requirement.specialty_cis,
      );

      if (usages.length === 0 && !controlledDispensingActive) {
        throw new Error(
          'Tous les médicaments doivent être vérifiés avant la validation finale.',
        );
      }

      let coveredHalfUnits = 0;
      for (const usage of usages) {
        if (
          usage.box_specialty_cis === null ||
          usage.presentation_cip13 === null ||
          usage.presentation_label === null ||
          usage.expiration_date === null ||
          usage.remaining_quantity === null
        ) {
          throw new Error(
            'Tous les médicaments doivent être vérifiés avant la validation finale.',
          );
        }
        // Un CIS différent n'est légitime que s'il s'agit de la correspondance
        // générique déjà validée lors de la vérification (matched_cis) : la
        // légitimité elle-même (même groupe générique + confirmation
        // explicite) n'est pas revérifiée ici, ce niveau ne fait que
        // s'assurer que la boîte n'a pas changé de médicament depuis.
        const acceptedBoxCis = usage.matched_cis ?? requirement.specialty_cis;
        if (usage.box_specialty_cis !== acceptedBoxCis) {
          throw new Error(
            'Une boîte vérifiée ne correspond plus au médicament attendu.',
          );
        }
        if (usage.expiration_date < completionDate) {
          throw new Error(
            'Une boîte sélectionnée est périmée. Vérifiez la préparation.',
          );
        }
        const consumedQuantity = usage.quantity_half_units / 2;
        const quantityAfter = usage.remaining_quantity - consumedQuantity;
        if (quantityAfter < 0) {
          throw new Error(
            'Le stock d’une boîte sélectionnée est insuffisant. Rechargez la préparation.',
          );
        }
        const update = await transaction.runAsync(
          `UPDATE medication_boxes
           SET remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND remaining_quantity = ?`,
          quantityAfter,
          usage.box_id,
          usage.remaining_quantity,
        );
        if (update.changes !== 1) {
          throw new Error(
            'Le stock a changé. Rechargez la préparation puis réessayez.',
          );
        }
        await transaction.runAsync(
          `INSERT INTO stock_movements
            (box_id, preparation_id, type, quantity_delta, quantity_after, explanation)
           VALUES (?, ?, 'PILLBOX_PREPARATION', ?, ?, ?)`,
          usage.box_id,
          preparationId,
          -consumedQuantity,
          quantityAfter,
          `Préparation du pilulier du ${completionDate}`,
        );
        await transaction.runAsync(
          `INSERT INTO preparation_box_usages
            (preparation_id, specialty_cis, specialty_name, box_id,
             presentation_cip13, presentation_label, lot,
             expiration_date, quantity_half_units, verification,
             matched_cis, matched_specialty_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          preparationId,
          requirement.specialty_cis,
          requirement.specialty_name,
          usage.box_id,
          usage.presentation_cip13,
          usage.presentation_label,
          usage.lot,
          usage.expiration_date,
          usage.quantity_half_units,
          toVerificationMethod(usage.verification),
          usage.matched_cis,
          usage.matched_specialty_name,
        );
        coveredHalfUnits += usage.quantity_half_units;
      }
      if (coveredHalfUnits > requirement.required_half_units) {
        throw new Error(
          'La quantité vérifiée dépasse le besoin de la semaine.',
        );
      }
      if (
        coveredHalfUnits !== requirement.required_half_units &&
        !controlledDispensingActive
      ) {
        throw new Error(
          'La quantité vérifiée ne couvre pas exactement le besoin de la semaine.',
        );
      }

      if (controlledDispensingActive) {
        const hasPending = await allocateAndPersistItemCompletion(
          transaction,
          preparationId,
          requirement.specialty_cis,
          coveredHalfUnits,
        );
        if (hasPending) pendingSpecialtyCis.push(requirement.specialty_cis);
      }
    }

    const completed = await transaction.runAsync(
      `UPDATE preparations
       SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'DRAFT'`,
      preparationId,
    );
    if (completed.changes !== 1) {
      throw new Error('Cette préparation est déjà terminée.');
    }
  });
  return pendingSpecialtyCis;
}

type CompletionTransaction = Pick<SQLiteDatabase, 'getAllAsync' | 'runAsync'>;

type PendingItemRow = {
  id: number;
  source_treatment_id: number;
  intake_date: string;
  slot: IntakeSlot;
  quantity_half_units: number;
};

/**
 * Alloue une couverture aux cases d'un médicament à délivrance encadrée (voir
 * `allocateItemCompletion`) et persiste le résultat sur `preparation_items`.
 * Retourne `true` si au moins une case reste en attente de complément.
 */
async function persistItemCompletion(
  transaction: CompletionTransaction,
  specialtyCis: string,
  rows: readonly PendingItemRow[],
  coveredHalfUnits: number,
): Promise<boolean> {
  // Trié avec le même comparateur qu'`allocateItemCompletion` (interne à la
  // fonction) : un tri stable d'une entrée déjà triée ne change pas l'ordre,
  // ce qui permet de recorréler chaque résultat à l'id de sa ligne d'origine
  // par simple position, sans faire porter d'identifiant technique au domaine.
  const ordered = [...rows].sort(
    (left, right) =>
      left.intake_date.localeCompare(right.intake_date) ||
      INTAKE_SLOTS.indexOf(left.slot) - INTAKE_SLOTS.indexOf(right.slot),
  );
  const allocation = allocateItemCompletion(
    ordered.map((row) => ({
      treatmentId: row.source_treatment_id,
      specialtyCis,
      specialtyName: '',
      pharmaceuticalForm: null,
      date: row.intake_date,
      slot: row.slot,
      quantityHalfUnits: row.quantity_half_units,
    })),
    coveredHalfUnits,
  );
  let hasPending = false;
  for (const [index, row] of ordered.entries()) {
    const status: ItemCompletionStatus = allocation[index].status;
    if (status === 'PENDING_COMPLEMENT') hasPending = true;
    await transaction.runAsync(
      `UPDATE preparation_items SET completion_status = ? WHERE id = ?`,
      status,
      row.id,
    );
  }
  return hasPending;
}

async function allocateAndPersistItemCompletion(
  transaction: CompletionTransaction,
  preparationId: number,
  specialtyCis: string,
  coveredHalfUnits: number,
): Promise<boolean> {
  const rows = await transaction.getAllAsync<PendingItemRow>(
    `SELECT id, source_treatment_id, intake_date, slot, quantity_half_units
     FROM preparation_items WHERE preparation_id = ? AND specialty_cis = ?`,
    preparationId,
    specialtyCis,
  );
  return persistItemCompletion(
    transaction,
    specialtyCis,
    rows,
    coveredHalfUnits,
  );
}

export type PendingCompletionCase = Readonly<{
  preparationId: number;
  preparationStartDate: string;
  preparationEndDate: string;
  specialtyCis: string;
  specialtyName: string;
  /**
   * Traitement à l'origine de la première case en attente rencontrée pour ce
   * médicament. En pratique un CIS n'a qu'un traitement actif ; en cas
   * d'homonymie inattendue, le premier trouvé est retenu sans en privilégier
   * un autre — sert uniquement à retrouver une équivalence générique déjà
   * confirmée lors d'un complément ultérieur.
   */
  treatmentId: number;
  pendingItems: readonly Readonly<{ date: string; slot: IntakeSlot }>[];
  pendingHalfUnits: number;
  /** Date théorique courante du traitement (ticket 30), purement informative. */
  theoreticalRenewalDate: string | null;
}>;

/**
 * Cases encore « en attente de complément » (ticket 30b), toutes préparations
 * validées confondues, groupées par médicament au sein de chaque préparation.
 */
export async function getPendingCompletionCases(
  database: SQLiteDatabase,
): Promise<readonly PendingCompletionCase[]> {
  const rows = await database.getAllAsync<{
    preparation_id: number;
    start_date: string;
    end_date: string;
    specialty_cis: string;
    specialty_name: string;
    intake_date: string;
    slot: IntakeSlot;
    quantity_half_units: number;
    source_treatment_id: number;
  }>(
    `SELECT pi.preparation_id, p.start_date, p.end_date, pi.specialty_cis,
      pi.specialty_name, pi.intake_date, pi.slot, pi.quantity_half_units,
      pi.source_treatment_id
     FROM preparation_items pi
     JOIN preparations p ON p.id = pi.preparation_id
     WHERE pi.completion_status = 'PENDING_COMPLEMENT'
     ORDER BY p.start_date, pi.specialty_name, pi.intake_date, pi.slot`,
  );
  if (rows.length === 0) return [];

  const treatmentIds = [...new Set(rows.map((row) => row.source_treatment_id))];
  const placeholders = treatmentIds.map(() => '?').join(', ');
  // La date théorique retenue par traitement est celle de la ligne
  // d'ordonnance FRACTIONAL la plus récemment émise (ticket 45) : au plus
  // une ligne « active » par traitement a du sens fonctionnellement, sans
  // être contraint en base — voir `listPrescriptionItems`.
  const treatments = await database.getAllAsync<{
    id: number;
    theoretical_renewal_date: string | null;
  }>(
    `SELECT t.id,
      (SELECT presc.theoretical_renewal_date
       FROM prescription_items presc
       JOIN prescriptions p ON p.id = presc.prescription_id
       WHERE presc.treatment_id = t.id AND presc.dispensing_mode = 'FRACTIONAL'
       ORDER BY p.issue_date DESC, presc.id DESC
       LIMIT 1) AS theoretical_renewal_date
     FROM treatments t WHERE t.id IN (${placeholders})`,
    ...treatmentIds,
  );
  const theoreticalDateByTreatmentId = new Map(
    treatments.map((row) => [row.id, row.theoretical_renewal_date]),
  );

  type MutableCase = {
    preparationId: number;
    preparationStartDate: string;
    preparationEndDate: string;
    specialtyCis: string;
    specialtyName: string;
    treatmentId: number;
    pendingItems: { date: string; slot: IntakeSlot }[];
    pendingHalfUnits: number;
    theoreticalRenewalDate: string | null;
  };
  const groups = new Map<string, MutableCase>();
  for (const row of rows) {
    const key = `${row.preparation_id}:${row.specialty_cis}`;
    const group = groups.get(key) ?? {
      preparationId: row.preparation_id,
      preparationStartDate: row.start_date,
      preparationEndDate: row.end_date,
      specialtyCis: row.specialty_cis,
      specialtyName: row.specialty_name,
      treatmentId: row.source_treatment_id,
      pendingItems: [],
      pendingHalfUnits: 0,
      theoreticalRenewalDate:
        theoreticalDateByTreatmentId.get(row.source_treatment_id) ?? null,
    };
    group.pendingItems.push({ date: row.intake_date, slot: row.slot });
    group.pendingHalfUnits += row.quantity_half_units;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    Object.freeze({
      ...group,
      pendingItems: Object.freeze(group.pendingItems),
    }),
  );
}

export type PendingCompletionContribution = Readonly<{
  boxId: number;
  /** Quantité couverte par cette boîte, déjà calculée par `verifyPreparationBox`. */
  quantityHalfUnits: number;
  verification: BoxVerificationMethod;
  scanRaw: string | null;
  matchedCis: string | null;
  matchedSpecialtyName: string | null;
}>;

/**
 * Complète une case « en attente de complément » (ticket 30b) dès qu'une
 * boîte devient disponible, sans reprendre tout le flux de préparation.
 * Décrémente le stock et journalise comme une préparation ordinaire.
 * Retourne `true` lorsque plus aucune case de ce médicament, pour cette
 * préparation, ne reste en attente.
 */
export async function completePendingItem(
  database: SQLiteDatabase,
  preparationId: number,
  specialtyCis: string,
  contribution: PendingCompletionContribution,
  completionDate: string,
): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completionDate)) {
    throw new Error('La date de complément est invalide.');
  }
  assertVerificationEvidence(contribution.verification, contribution.scanRaw);
  if (
    (contribution.matchedCis === null) !==
    (contribution.matchedSpecialtyName === null)
  ) {
    throw new Error(
      'matchedCis et matchedSpecialtyName doivent être renseignés ensemble.',
    );
  }
  if (contribution.matchedCis === specialtyCis) {
    throw new Error(
      'matchedCis ne peut pas être identique au CIS attendu : ce cas est une correspondance exacte.',
    );
  }

  let resolved = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const preparation = await transaction.getFirstAsync<{ status: string }>(
      'SELECT status FROM preparations WHERE id = ?',
      preparationId,
    );
    if (preparation === null) throw new Error('Préparation introuvable.');
    if (preparation.status !== 'COMPLETED') {
      throw new Error('Cette préparation n’a pas encore été validée.');
    }

    const pendingItems = await transaction.getAllAsync<PendingItemRow>(
      `SELECT id, source_treatment_id, intake_date, slot, quantity_half_units
       FROM preparation_items
       WHERE preparation_id = ? AND specialty_cis = ? AND completion_status = 'PENDING_COMPLEMENT'`,
      preparationId,
      specialtyCis,
    );
    if (pendingItems.length === 0) {
      throw new Error(
        'Aucune case en attente de complément pour ce médicament.',
      );
    }
    const pendingHalfUnits = pendingItems.reduce(
      (sum, item) => sum + item.quantity_half_units,
      0,
    );
    if (contribution.quantityHalfUnits > pendingHalfUnits) {
      throw new Error(
        'La quantité vérifiée dépasse ce qui reste en attente de complément.',
      );
    }

    const box = await transaction.getFirstAsync<{
      specialty_cis: string;
      presentation_cip13: string;
      presentation_label: string;
      lot: string | null;
      expiration_date: string;
      remaining_quantity: number;
    }>(
      `SELECT specialty_cis, presentation_cip13, presentation_label, lot,
        expiration_date, remaining_quantity
       FROM medication_boxes WHERE id = ?`,
      contribution.boxId,
    );
    if (box === null) throw new Error('Boîte introuvable.');
    const acceptedCis = contribution.matchedCis ?? specialtyCis;
    if (box.specialty_cis !== acceptedCis) {
      throw new Error('Cette boîte ne correspond pas au médicament attendu.');
    }
    if (box.expiration_date < completionDate) {
      throw new Error('Cette boîte est périmée.');
    }
    const consumedQuantity = contribution.quantityHalfUnits / 2;
    const quantityAfter = box.remaining_quantity - consumedQuantity;
    if (quantityAfter < 0) {
      throw new Error('Le stock de cette boîte est insuffisant.');
    }
    const update = await transaction.runAsync(
      `UPDATE medication_boxes
       SET remaining_quantity = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND remaining_quantity = ?`,
      quantityAfter,
      contribution.boxId,
      box.remaining_quantity,
    );
    if (update.changes !== 1) {
      throw new Error('Le stock a changé. Rechargez puis réessayez.');
    }
    await transaction.runAsync(
      `INSERT INTO stock_movements
        (box_id, preparation_id, type, quantity_delta, quantity_after, explanation)
       VALUES (?, ?, 'PILLBOX_PREPARATION', ?, ?, ?)`,
      contribution.boxId,
      preparationId,
      -consumedQuantity,
      quantityAfter,
      `Complément différé de la préparation du ${completionDate}`,
    );

    const requirement = await transaction.getFirstAsync<{
      specialty_name: string;
    }>(
      `SELECT specialty_name FROM preparation_requirements
       WHERE preparation_id = ? AND specialty_cis = ?`,
      preparationId,
      specialtyCis,
    );
    await transaction.runAsync(
      `INSERT INTO preparation_box_usages
        (preparation_id, specialty_cis, specialty_name, box_id,
         presentation_cip13, presentation_label, lot, expiration_date,
         quantity_half_units, verification, matched_cis, matched_specialty_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(preparation_id, specialty_cis, box_id) DO UPDATE SET
         quantity_half_units = quantity_half_units + excluded.quantity_half_units`,
      preparationId,
      specialtyCis,
      requirement?.specialty_name ?? specialtyCis,
      contribution.boxId,
      box.presentation_cip13,
      box.presentation_label,
      box.lot,
      box.expiration_date,
      contribution.quantityHalfUnits,
      contribution.verification,
      contribution.matchedCis,
      contribution.matchedSpecialtyName,
    );

    const hasPending = await persistItemCompletion(
      transaction,
      specialtyCis,
      pendingItems,
      contribution.quantityHalfUnits,
    );
    resolved = !hasPending;
  });
  return resolved;
}

export async function listPreparationHistory(
  database: SQLiteDatabase,
): Promise<PreparationHistoryEntry[]> {
  const preparations = await database.getAllAsync<{
    id: number;
    start_date: string;
    end_date: string;
    completed_at: string;
  }>(
    `SELECT id, start_date, end_date, completed_at FROM preparations
     WHERE status = 'COMPLETED' ORDER BY completed_at DESC, id DESC`,
  );
  const result: PreparationHistoryEntry[] = [];
  for (const preparation of preparations) {
    const medications = await database.getAllAsync<{
      specialty_cis: string;
      specialty_name: string;
      quantity_half_units: number;
      box_id: number;
      presentation_cip13: string;
      presentation_label: string;
      lot: string | null;
      expiration_date: string;
      verification: string;
      matched_cis: string | null;
      matched_specialty_name: string | null;
    }>(
      `SELECT specialty_cis, specialty_name, quantity_half_units, box_id,
        presentation_cip13, presentation_label, lot, expiration_date, verification,
        matched_cis, matched_specialty_name
       FROM preparation_box_usages WHERE preparation_id = ?
       ORDER BY specialty_name, box_id`,
      preparation.id,
    );
    result.push({
      id: preparation.id,
      startDate: preparation.start_date,
      endDate: preparation.end_date,
      completedAt: preparation.completed_at,
      medications: medications.map((item) => ({
        specialtyCis: item.specialty_cis,
        specialtyName: item.specialty_name,
        quantityHalfUnits: item.quantity_half_units,
        boxId: item.box_id,
        presentationCip13: item.presentation_cip13,
        presentationLabel: item.presentation_label,
        lot: item.lot,
        expirationDate: item.expiration_date,
        verification: toVerificationMethod(item.verification),
        matchedCis: item.matched_cis,
        matchedSpecialtyName: item.matched_specialty_name,
      })),
    });
  }
  return result;
}

function toPreparationStatus(value: string): KnownPreparation['status'] {
  if (value !== 'DRAFT' && value !== 'COMPLETED')
    throw new Error(
      'La base locale contient un statut de préparation inconnu.',
    );
  return value;
}

function toVerificationMethod(value: string | null): BoxVerificationMethod {
  if (!(BOX_VERIFICATION_METHODS as readonly (string | null)[]).includes(value))
    throw new Error('La base locale contient une vérification inconnue.');
  return value as BoxVerificationMethod;
}
