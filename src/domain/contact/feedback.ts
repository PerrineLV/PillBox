export const CONTACT_EMAIL = 'pillbox.app@protonmail.com';

export const FEEDBACK_TYPES = [
  { value: '', label: 'Non précisé' },
  { value: 'problem', label: 'Problème' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'other', label: 'Autre' },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number]['value'];

/** Seuls le type choisi et le texte saisi quittent le formulaire. */
export function prepareFeedback(message: string, type: FeedbackType) {
  if (message.trim() === '') {
    throw new Error('Saisissez un message avant de continuer.');
  }
  const label = FEEDBACK_TYPES.find((option) => option.value === type)!.label;
  return {
    recipients: [CONTACT_EMAIL],
    subject:
      type === '' ? 'PillBox — Retour utilisateur' : `PillBox — ${label}`,
    body: message,
    isHtml: false,
  };
}
