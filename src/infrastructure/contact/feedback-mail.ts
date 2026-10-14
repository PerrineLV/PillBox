import * as MailComposer from 'expo-mail-composer';

import { prepareFeedback, type FeedbackType } from '@/domain/contact/feedback';

export async function openFeedbackMail(
  message: string,
  type: FeedbackType,
): Promise<'opened' | 'unavailable'> {
  const mail = prepareFeedback(message, type);
  try {
    if (!(await MailComposer.isAvailableAsync())) return 'unavailable';
    await MailComposer.composeAsync(mail);
    // Le retour du composeur ne prouve pas que le message a été envoyé.
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
