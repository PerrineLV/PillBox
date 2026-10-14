import * as MailComposer from 'expo-mail-composer';
import { CONTACT_EMAIL, prepareFeedback } from '@/domain/contact/feedback';
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

it.each(['', '  ', '\n\t'])(
  'refuse un message vide avant tout appel natif',
  async (message) => {
    await expect(openFeedbackMail(message, '')).rejects.toThrow('Saisissez');
    expect(MailComposer.isAvailableAsync).not.toHaveBeenCalled();
    expect(MailComposer.composeAsync).not.toHaveBeenCalled();
  },
);

it('prépare exclusivement le texte exact et le type choisi', async () => {
  const message = '  Écran figé & bouton ?\nDeuxième ligne : 50% + # <test>  ';
  await openFeedbackMail(message, 'problem');
  expect(MailComposer.composeAsync).toHaveBeenCalledWith({
    recipients: [CONTACT_EMAIL],
    subject: 'PillBox — Problème',
    body: message,
    isHtml: false,
  });
  expect(prepareFeedback('Bonjour', '').subject).toBe(
    'PillBox — Retour utilisateur',
  );
});

it('permet le repli sans composeur', async () => {
  jest.mocked(MailComposer.isAvailableAsync).mockResolvedValue(false);
  expect(await openFeedbackMail('Bonjour', 'suggestion')).toBe('unavailable');
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
    expect(await openFeedbackMail('Bonjour', 'other')).toBe('unavailable');
  },
);

it('ne transforme pas l’annulation en confirmation d’envoi', async () => {
  expect(await openFeedbackMail('Bonjour', '')).toBe('opened');
  expect(MailComposer.composeAsync).toHaveBeenCalledTimes(1);
});
