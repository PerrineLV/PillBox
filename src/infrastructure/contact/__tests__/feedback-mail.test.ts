import * as MailComposer from 'expo-mail-composer';
import { CONTACT_EMAIL } from '@/domain/contact/feedback';
import { openFeedbackMail } from '../feedback-mail';

jest.mock('expo-mail-composer', () => ({
  MailComposerStatus: { CANCELLED: 'cancelled' },
  isAvailableAsync: jest.fn(async () => true),
  composeAsync: jest.fn(async () => ({ status: 'cancelled' })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(MailComposer.isAvailableAsync).mockResolvedValue(true);
  jest
    .mocked(MailComposer.composeAsync)
    .mockResolvedValue({ status: MailComposer.MailComposerStatus.CANCELLED });
});

it.each([
  ['problem', 'PillBox — Problème'],
  ['suggestion', 'PillBox — Suggestion'],
] as const)(
  'prépare uniquement le destinataire et l’objet (%s)',
  async (type, subject) => {
    await openFeedbackMail(type);
    expect(MailComposer.composeAsync).toHaveBeenCalledWith({
      recipients: [CONTACT_EMAIL],
      subject,
      isHtml: false,
    });
  },
);

it('permet le repli sans composeur', async () => {
  jest.mocked(MailComposer.isAvailableAsync).mockResolvedValue(false);
  expect(await openFeedbackMail('suggestion')).toBe('unavailable');
  expect(MailComposer.composeAsync).not.toHaveBeenCalled();
});

it.each(['availability', 'opening'])(
  'permet le repli en cas d’erreur %s',
  async (step) => {
    if (step === 'availability')
      jest
        .mocked(MailComposer.isAvailableAsync)
        .mockRejectedValueOnce(new Error('indisponible'));
    else
      jest
        .mocked(MailComposer.composeAsync)
        .mockRejectedValueOnce(new Error('indisponible'));
    expect(await openFeedbackMail('problem')).toBe('unavailable');
  },
);

it('ne transforme pas l’annulation en confirmation d’envoi', async () => {
  expect(await openFeedbackMail('problem')).toBe('opened');
  expect(MailComposer.composeAsync).toHaveBeenCalledTimes(1);
});
