/**
 * Équivalent SQL de generateIntakes, évalué à la date de la ligne.
 * Garde les lectures et les validations atomiques cohérentes, même après un
 * redémarrage ou une action provenant d'une ancienne notification. Les lignes
 * historiques restent en base ; seuls les UNSET sont soumis à ce filtre.
 * `record` est un alias SQL interne, jamais une saisie utilisateur.
 */
export function applicableIntakeSql(record = 'intake_records'): string {
  const weekday = `CASE strftime('%w', ${record}.intake_date)
    WHEN '0' THEN 'sunday' WHEN '1' THEN 'monday' WHEN '2' THEN 'tuesday'
    WHEN '3' THEN 'wednesday' WHEN '4' THEN 'thursday'
    WHEN '5' THEN 'friday' WHEN '6' THEN 'saturday' END`;
  return `EXISTS (
    SELECT 1 FROM treatments t
    JOIN treatment_phases p ON p.treatment_id = t.id
    JOIN treatment_phase_dosages d ON d.phase_id = p.id
    WHERE t.id = ${record}.source_treatment_id
      AND t.archived_at IS NULL AND t.dosage_kind = 'SCHEDULED'
      AND d.slot = ${record}.slot
      AND (
        (p.frequency_type = 'legacy_weekdays' AND d.weekday = ${weekday})
        OR (
          p.start_date <= ${record}.intake_date
          AND (p.end_date IS NULL OR p.end_date >= ${record}.intake_date)
          AND (
            p.frequency_type = 'daily'
            OR (p.frequency_type = 'weekly' AND p.weekly_weekday = ${weekday})
            OR (p.frequency_type = 'interval'
              AND CAST(julianday(${record}.intake_date) - julianday(p.anchor_date) AS INTEGER) % p.interval_days = 0)
          )
        )
      )
  )`;
}
