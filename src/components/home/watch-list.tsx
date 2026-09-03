import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  attentionItemActionLabel,
  attentionItemHref,
} from './attention-item-route';
import {
  watchItemPresentation,
  type WatchAttentionItem,
} from './watch-item-labels';
import {
  colors,
  radii,
  severity as severityScale,
  sizes,
  typography,
} from '@/ui';

/**
 * Liste dense à filets fins : chaque ligne mène à l'écran qui permet d'agir
 * sur l'alerte (le stock concerné, la boîte, l'ordonnance).
 */
export function WatchList({
  items,
}: Readonly<{ items: readonly WatchAttentionItem[] }>) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => {
        const presentation = watchItemPresentation(item);
        return (
          <Pressable
            key={item.id}
            accessibilityLabel={`${presentation.title}. ${presentation.detail}. ${attentionItemActionLabel(item)}`}
            accessibilityRole="button"
            onPress={() => router.navigate(attentionItemHref(item))}
            style={({ pressed }) => [
              styles.row,
              index > 0 && styles.rowDivided,
              pressed && styles.rowPressed,
            ]}
          >
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: severityScale[presentation.severity].text,
                },
              ]}
            />
            <View style={styles.text}>
              <Text style={styles.title}>{presentation.title}</Text>
              <Text style={styles.detail}>{presentation.detail}</Text>
            </View>
            <Text
              accessibilityElementsHidden
              maxFontSizeMultiplier={1.2}
              style={styles.chevron}
            >
              ›
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: colors.surface,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivided: { borderTopColor: colors.hairline, borderTopWidth: 1 },
  rowPressed: { backgroundColor: colors.background },
  dot: { borderRadius: radii.pill, height: 8, width: 8 },
  text: { flex: 1, gap: 3, minWidth: 0 },
  title: { ...typography.itemTitle, fontSize: 14.5 },
  detail: { ...typography.detail, lineHeight: 17 },
  chevron: { color: colors.textTertiary, flexShrink: 0, fontSize: 22 },
});
