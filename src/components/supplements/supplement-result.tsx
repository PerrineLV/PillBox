import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { SupplementSearchResult } from '@/infrastructure/supplements/supplement-reference';
import { DenseRow, PillButton, spacing, typography } from '@/ui';

export function SupplementResult({
  result,
  returnTo,
  first,
}: Readonly<{
  result: SupplementSearchResult;
  returnTo?: string;
  first: boolean;
}>) {
  const [expanded, setExpanded] = useState(false);
  const identity = result.brand
    ? `Marque : ${result.brand}`
    : result.operator
      ? `Opérateur responsable : ${result.operator}`
      : 'Marque et opérateur non renseignés';
  return (
    <View>
      <DenseRow
        first={first}
        title={result.name}
        detail={
          <View>
            <Text style={typography.detail}>{identity}</Text>
            <Text style={typography.detail}>
              {result.form ?? 'Forme non renseignée'} · Réf. {result.externalId}
            </Text>
            <Text style={typography.detail}>
              {expanded
                ? 'Masquer les détails'
                : 'Voir les détails avant de choisir'}
            </Text>
          </View>
        }
        accessibilityLabel={`${result.name}. ${identity}. ${result.form ?? 'Forme non renseignée'}. Référence Compl’Alim ${result.externalId}. ${expanded ? 'Masquer' : 'Afficher'} les détails`}
        onPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View style={{ gap: spacing.sm, padding: spacing.md }}>
          <Text style={typography.detail}>
            Complément · Compl’Alim · Référence {result.externalId}
          </Text>
          {!result.brand ? (
            <Text style={typography.detail}>
              Marque non renseignée ; l’opérateur n’est pas nécessairement la
              marque.
            </Text>
          ) : null}
          <Text style={typography.detail}>
            Opérateur responsable : {result.operator ?? 'non renseigné'}
          </Text>
          <Text style={typography.detail}>
            Gamme : {result.productRange ?? 'non renseignée'}
          </Text>
          <Text style={typography.detail}>
            Dosage produit et conditionnement non disponibles dans ce
            référentiel. Vérifiez l’identité sur votre boîte ; si ces
            informations ne suffisent pas, ajoutez le produit manuellement.
            Aucune posologie n’est déduite.
          </Text>
          <PillButton
            label="Choisir cette référence"
            tone="outline"
            onPress={() =>
              router.push({
                pathname: '/treatments/new',
                params: {
                  source: 'COMPL_ALIM',
                  externalId: result.externalId,
                  name: result.name,
                  form: result.form ?? '',
                  ...(returnTo ? { returnTo } : {}),
                },
              })
            }
          />
        </View>
      ) : null}
    </View>
  );
}
