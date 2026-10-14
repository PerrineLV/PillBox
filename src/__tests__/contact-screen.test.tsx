import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import ContactScreen from '@/app/settings/contact';
import { openFeedbackMail } from '@/infrastructure/contact/feedback-mail';
import { PillButton } from '@/ui';

jest.mock('expo-router', () => ({
  usePathname: () => '/settings/contact',
  router: { back: jest.fn() },
}));
jest.mock('@/infrastructure/contact/feedback-mail', () => ({
  openFeedbackMail: jest.fn(async () => 'opened'),
}));

let renderer: ReactTestRenderer;
const button = () => renderer.root.findByType(PillButton);
const input = () => renderer.root.findByType(TextInput);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(openFeedbackMail).mockResolvedValue('opened');
  act(() => {
    renderer = create(<ContactScreen />);
  });
});
afterEach(() => {
  act(() => renderer.unmount());
});

it('bloque les messages vides et ne contacte rien à l’ouverture', () => {
  expect(button().props.disabled).toBe(true);
  act(() => input().props.onChangeText(' \n '));
  expect(button().props.disabled).toBe(true);
  expect(openFeedbackMail).not.toHaveBeenCalled();
});

it.each(['opened', 'unavailable'] as const)(
  'conserve le texte au retour %s et le rend copiable',
  async (result) => {
    jest.mocked(openFeedbackMail).mockResolvedValue(result);
    const message = 'Écran & accents\nSeconde ligne';
    act(() => input().props.onChangeText(message));
    await act(async () => {
      button().props.onPress();
      button().props.onPress();
    });
    expect(openFeedbackMail).toHaveBeenCalledTimes(1);
    expect(input().props.value).toBe(message);
    const selectable = renderer.root
      .findAllByType(Text)
      .filter((node) => node.props.selectable);
    expect(selectable.map((node) => node.props.children)).toEqual([
      'pillbox.app@protonmail.com',
      message,
    ]);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Message envoyé');
    expect(JSON.stringify(renderer.toJSON())).toContain(
      result === 'opened' ? 'ne peut pas confirmer' : 'Impossible d’ouvrir',
    );
  },
);
