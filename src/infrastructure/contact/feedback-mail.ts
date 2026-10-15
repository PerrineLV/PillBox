import * as MailComposer from 'expo-mail-composer';

import { prepareFeedback, type FeedbackType } from '@/domain/contact/feedback';

export async function openFeedbackMail(
  type: FeedbackType,
): Promise<'opened' | 'unavailable'> {
  try {
    if (!(await MailComposer.isAvailableAsync())) return 'unavailable';
    await MailComposer.composeAsync(prepareFeedback(type));
    // Le retour du composeur ne prouve pas que le message a été envoyé.
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
