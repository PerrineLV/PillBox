import { useRef, useState } from 'react';
import { Text } from 'react-native';

import {
  CONTACT_EMAIL,
  FEEDBACK_TYPES,
  type FeedbackType,
} from '@/domain/contact/feedback';
import { openFeedbackMail } from '@/infrastructure/contact/feedback-mail';
import {
  AppCard,
  AppField,
  AppScreen,
  Message,
  PillButton,
  Section,
  SelectField,
  StackHeader,
  typography,
} from '@/ui';

export default function ContactScreen() {
  const [message, setMessage] = useState('');
  const [type, setType] = useState<FeedbackType>('');
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [notice, setNotice] = useState<'opened' | 'unavailable' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function continueByMail() {
    if (openingRef.current) return;
    if (message.trim() === '') {
      setError('Saisissez un message avant de continuer.');
      return;
    }
    openingRef.current = true;
    setOpening(true);
    setError(null);
    try {
      setNotice(await openFeedbackMail(message, type));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }

  return (
    <AppScreen header={<StackHeader title="Faire un retour" />}>
      <Section label="Aide et contact">
        <AppCard>
          <Text style={typography.detail}>
            Un problème, une suggestion ? Ce canal concerne l’application et ne
            fournit pas de conseil médical. N’incluez pas de données de santé
            dans votre message.
          </Text>
          <Text style={typography.detail}>Destinataire : {CONTACT_EMAIL}</Text>
          <SelectField<FeedbackType>
            label="Type de retour (facultatif)"
            options={FEEDBACK_TYPES}
            value={type}
            onChange={setType}
          />
          <AppField
            label="Votre message (obligatoire)"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            editable={!opening}
            value={message}
            onChangeText={(text) => {
              setMessage(text);
              setError(null);
              setNotice(null);
            }}
            error={error}
          />
          <Text style={typography.detail}>
            Seuls le type de retour et votre message sont préparés. Aucun
            diagnostic ni pièce jointe n’est ajouté. Vous pourrez relire et
            envoyer vous-même dans votre messagerie. L’envoi communiquera aussi
            votre adresse e-mail au destinataire.
          </Text>
          <PillButton
            label="Continuer par e-mail"
            disabled={opening || message.trim() === ''}
            onPress={() => void continueByMail()}
          />
          {notice === 'opened' ? (
            <Message>
              Votre texte est conservé ici. PillBox ne peut pas confirmer
              l’envoi depuis votre messagerie.
            </Message>
          ) : null}
          {notice === 'unavailable' ? (
            <Message tone="error">
              Impossible d’ouvrir une messagerie. Votre texte est conservé :
              vous pouvez le copier ci-dessous.
            </Message>
          ) : null}
        </AppCard>
      </Section>
      <Section label="Copier pour envoyer autrement">
        <AppCard>
          <Text style={typography.detail}>
            Faites un appui long sur l’adresse ou le message, puis choisissez
            Copier dans le menu de sélection. Rien n’est copié automatiquement.
          </Text>
          <Text
            selectable
            accessibilityLabel={`Adresse de contact : ${CONTACT_EMAIL}`}
            style={typography.detail}
          >
            {CONTACT_EMAIL}
          </Text>
          {message !== '' ? (
            <Text
              selectable
              accessibilityLabel={`Message à copier : ${message}`}
              style={typography.detail}
            >
              {message}
            </Text>
          ) : null}
        </AppCard>
      </Section>
    </AppScreen>
  );
}
