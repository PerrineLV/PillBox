import { formatFrenchDate, type SourceDates } from './bdpm-source-dates';

const SNAPSHOT_SENTENCE_PATTERN =
  /Le snapshot actuellement livré \(`assets\/medications\/medications\.db`\) a été construit avec .*?, dates affichées par la BDPM au téléchargement\./s;

export function updateReferenceDocDates(
  markdown: string,
  dates: SourceDates,
): string {
  if (!SNAPSHOT_SENTENCE_PATTERN.test(markdown)) {
    throw new Error(
      'docs/medications-reference.md: phrase des dates du snapshot introuvable, mise à jour automatique refusée.',
    );
  }
  return markdown.replace(
    SNAPSHOT_SENTENCE_PATTERN,
    formatSnapshotSentence(dates),
  );
}

function formatSnapshotSentence(dates: SourceDates): string {
  const specialties = formatFrenchDate(dates.specialtiesSourceDate);
  const presentations = formatFrenchDate(dates.presentationsSourceDate);
  const generics = formatFrenchDate(dates.genericsSourceDate);
  return (
    'Le snapshot actuellement livré (`assets/medications/medications.db`) a été construit avec ' +
    `le fichier des spécialités daté du **${specialties}**, ` +
    `le fichier des présentations daté du **${presentations}** ` +
    `et le fichier des groupes génériques daté du **${generics}**, dates affichées par la BDPM au téléchargement.`
  );
}
