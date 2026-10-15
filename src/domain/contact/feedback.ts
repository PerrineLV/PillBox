export const CONTACT_EMAIL = 'pillbox.app@protonmail.com';

export type FeedbackType = 'problem' | 'suggestion';

const SUBJECTS: Readonly<Record<FeedbackType, string>> = {
  problem: 'PillBox — Problème',
  suggestion: 'PillBox — Suggestion',
};

/** Seuls le destinataire et l’objet sont préparés : le message reste vide. */
export function prepareFeedback(type: FeedbackType) {
  return {
    recipients: [CONTACT_EMAIL],
    subject: SUBJECTS[type],
    isHtml: false,
  };
}
