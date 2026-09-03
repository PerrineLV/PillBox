import { View } from 'react-native';

import { colors } from './theme';

/**
 * Jeu d'icônes au trait, dessiné en vues natives. PillBox n'embarque aucune
 * bibliothèque d'icônes ni SVG : ces formes simples suffisent, restent
 * lisibles à 16-22 px et ne coûtent aucune dépendance.
 *
 * Toutes les icônes sont décoratives : l'élément qui les porte doit toujours
 * fournir son propre libellé accessible.
 */
export type IconProps = Readonly<{
  size?: number;
  color?: string;
  strokeWidth?: number;
}>;

type Resolved = Required<IconProps>;

function resolve({
  size = 19,
  color = colors.brand,
  strokeWidth = 2.2,
}: IconProps): Resolved {
  return { size, color, strokeWidth };
}

const CHEVRON_ROTATIONS = {
  right: '45deg',
  down: '135deg',
  up: '-45deg',
} as const;

export function ChevronIcon({
  direction = 'right',
  ...props
}: IconProps & { direction?: keyof typeof CHEVRON_ROTATIONS }) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.42;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderColor: color,
          borderRightWidth: strokeWidth,
          borderTopWidth: strokeWidth,
          height: side,
          transform: [{ rotate: CHEVRON_ROTATIONS[direction] }],
          width: side,
        }}
      />
    </View>
  );
}

export function SearchIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const lens = size * 0.62;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderColor: color,
          borderRadius: lens,
          borderWidth: strokeWidth,
          height: lens,
          marginBottom: size * 0.12,
          marginRight: size * 0.12,
          width: lens,
        }}
      />
      <View
        style={{
          backgroundColor: color,
          borderRadius: strokeWidth,
          bottom: size * 0.14,
          height: size * 0.3,
          position: 'absolute',
          right: size * 0.16,
          transform: [{ rotate: '-45deg' }],
          width: strokeWidth,
        }}
      />
    </View>
  );
}

export function BellIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderColor: color,
          borderTopLeftRadius: size * 0.4,
          borderTopRightRadius: size * 0.4,
          borderWidth: strokeWidth,
          height: size * 0.56,
          width: size * 0.72,
        }}
      />
      <View
        style={{
          backgroundColor: color,
          borderRadius: strokeWidth,
          height: strokeWidth,
          marginTop: size * 0.04,
          width: size * 0.94,
        }}
      />
    </View>
  );
}

export function BoxIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.8;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          alignItems: 'center',
          borderColor: color,
          borderRadius: size * 0.16,
          borderWidth: strokeWidth,
          height: side,
          justifyContent: 'center',
          width: side,
        }}
      >
        <View
          style={{
            backgroundColor: color,
            height: strokeWidth,
            position: 'absolute',
            top: side * 0.28,
            width: side,
          }}
        />
      </View>
    </View>
  );
}

export function CapsuleIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          alignItems: 'center',
          borderColor: color,
          borderRadius: size * 0.36,
          borderWidth: strokeWidth,
          height: size * 0.62,
          justifyContent: 'center',
          transform: [{ rotate: '-45deg' }],
          width: size,
        }}
      >
        <View
          style={{ backgroundColor: color, height: '100%', width: strokeWidth }}
        />
      </View>
    </View>
  );
}

export function CalendarIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.82;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderColor: color,
          borderRadius: size * 0.16,
          borderWidth: strokeWidth,
          height: side,
          width: side,
        }}
      >
        <View
          style={{
            backgroundColor: color,
            height: strokeWidth,
            marginTop: side * 0.24,
            width: '100%',
          }}
        />
      </View>
    </View>
  );
}

export function ClockIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.84;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          alignItems: 'center',
          borderColor: color,
          borderRadius: side,
          borderWidth: strokeWidth,
          height: side,
          justifyContent: 'center',
          width: side,
        }}
      >
        <View
          style={{
            backgroundColor: color,
            borderRadius: strokeWidth,
            height: strokeWidth,
            marginRight: side * 0.16,
            width: side * 0.3,
          }}
        />
        <View
          style={{
            backgroundColor: color,
            borderRadius: strokeWidth,
            bottom: side * 0.5,
            height: side * 0.26,
            position: 'absolute',
            width: strokeWidth,
          }}
        />
      </View>
    </View>
  );
}

export function LockIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderColor: color,
          borderTopLeftRadius: size * 0.3,
          borderTopRightRadius: size * 0.3,
          borderWidth: strokeWidth,
          borderBottomWidth: 0,
          height: size * 0.3,
          width: size * 0.5,
        }}
      />
      <View
        style={{
          borderColor: color,
          borderRadius: size * 0.12,
          borderWidth: strokeWidth,
          height: size * 0.46,
          width: size * 0.8,
        }}
      />
    </View>
  );
}

export function ShieldIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderBottomLeftRadius: size * 0.42,
          borderBottomRightRadius: size * 0.42,
          borderColor: color,
          borderTopLeftRadius: size * 0.12,
          borderTopRightRadius: size * 0.12,
          borderWidth: strokeWidth,
          height: size * 0.86,
          width: size * 0.72,
        }}
      />
    </View>
  );
}

/** Flèche verticale : vers le bas pour un import, vers le haut pour un export. */
export function ArrowIcon({
  direction,
  ...props
}: IconProps & { direction: 'up' | 'down' }) {
  const { size, color, strokeWidth } = resolve(props);
  const head = size * 0.34;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          backgroundColor: color,
          borderRadius: strokeWidth,
          height: size * 0.68,
          width: strokeWidth,
        }}
      />
      <View
        style={{
          borderColor: color,
          borderLeftWidth: strokeWidth,
          borderTopWidth: strokeWidth,
          height: head,
          position: 'absolute',
          top: direction === 'up' ? size * 0.16 : undefined,
          bottom: direction === 'down' ? size * 0.16 : undefined,
          transform: [{ rotate: direction === 'up' ? '45deg' : '-135deg' }],
          width: head,
        }}
      />
    </View>
  );
}

export function WarningIcon(props: IconProps) {
  const { size, color } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderBottomColor: color,
          borderBottomWidth: size * 0.78,
          borderLeftColor: 'transparent',
          borderLeftWidth: size * 0.45,
          borderRightColor: 'transparent',
          borderRightWidth: size * 0.45,
          height: 0,
          width: 0,
        }}
      />
    </View>
  );
}

/** Coche seule, sans cercle : elle confirme sans réclamer l'attention. */
export function CheckIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          borderBottomWidth: strokeWidth,
          borderColor: color,
          borderLeftWidth: strokeWidth,
          height: size * 0.3,
          marginTop: -size * 0.12,
          transform: [{ rotate: '-45deg' }],
          width: size * 0.58,
        }}
      />
    </View>
  );
}

export function InfoIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.86;
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          alignItems: 'center',
          borderColor: color,
          borderRadius: side,
          borderWidth: strokeWidth * 0.8,
          height: side,
          justifyContent: 'center',
          width: side,
        }}
      >
        <View
          style={{
            backgroundColor: color,
            borderRadius: strokeWidth,
            height: strokeWidth * 0.9,
            marginBottom: side * 0.1,
            width: strokeWidth * 0.9,
          }}
        />
        <View
          style={{
            backgroundColor: color,
            borderRadius: strokeWidth,
            height: side * 0.3,
            width: strokeWidth * 0.9,
          }}
        />
      </View>
    </View>
  );
}

/** Cercle barré d'une croix : l'échec, distinct du triangle d'avertissement. */
export function ErrorIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  const side = size * 0.86;
  const bar = {
    backgroundColor: color,
    borderRadius: strokeWidth,
    height: strokeWidth * 0.9,
    position: 'absolute' as const,
    width: side * 0.5,
  };
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          alignItems: 'center',
          borderColor: color,
          borderRadius: side,
          borderWidth: strokeWidth * 0.8,
          height: side,
          justifyContent: 'center',
          width: side,
        }}
      >
        <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
      </View>
    </View>
  );
}

export function PlusIcon(props: IconProps) {
  const { size, color, strokeWidth } = resolve(props);
  return (
    <View accessibilityElementsHidden style={box(size)}>
      <View
        style={{
          backgroundColor: color,
          borderRadius: strokeWidth,
          height: strokeWidth,
          position: 'absolute',
          width: size * 0.76,
        }}
      />
      <View
        style={{
          backgroundColor: color,
          borderRadius: strokeWidth,
          height: size * 0.76,
          position: 'absolute',
          width: strokeWidth,
        }}
      />
    </View>
  );
}

function box(size: number) {
  return {
    alignItems: 'center' as const,
    height: size,
    justifyContent: 'center' as const,
    width: size,
  };
}
