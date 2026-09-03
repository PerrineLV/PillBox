import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isBottomNavigationVisible } from './components';
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon } from './icons';
import {
  reduceToast,
  type Toast,
  type ToastActionButton,
  type ToastTone,
} from './toast-policy';
import {
  colors,
  layout,
  onDarkSurfaces,
  radii,
  sizes,
  toastToneColors,
} from './theme';

/**
 * Un toast sans action se lit d'un coup d'œil. Avec une action, il faut lire
 * le message *puis* atteindre le bouton : la durée est allongée en
 * conséquence, sans quoi « Annuler » disparaîtrait avant d'être atteignable.
 */
const TOAST_DURATION_MS = 2500;
const TOAST_ACTION_DURATION_MS = 5000;

const ENTER_MS = 180;
const EXIT_MS = 140;
/** Décalage vertical de l'entrée : le toast monte depuis le bas de l'écran. */
const ENTER_OFFSET = 12;
/** Dégagement au-dessus de la barre d'onglets ou de la marge de sécurité. */
const BOTTOM_CLEARANCE = 16;

type ToastContextValue = {
  showToast(
    message: string,
    tone?: ToastTone,
    action?: ToastActionButton,
  ): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Monté une seule fois au niveau racine de l'application : tout écran peut
 * déclencher un toast via useToast(), sans mécanisme local propre à l'écran.
 *
 * Le toast s'affiche en bas, là où se font les gestes qui le déclenchent, sur
 * la surface sombre commune à l'en-tête d'accueil et au scan : il se lit comme
 * du chrome et non comme du contenu, et passe aussi bien sur le fond crème que
 * sur un en-tête vert profond. Seule l'icône porte la tonalité ; le fond ne
 * change jamais.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, dispatch] = useReducer(reduceToast, null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info', action?: ToastActionButton) => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      dispatch({ type: 'show', message, tone, action });
    },
    [],
  );

  useEffect(() => {
    if (toast === null) return;
    const id = toast.id;
    timeoutRef.current = setTimeout(
      () => {
        timeoutRef.current = null;
        dispatch({ type: 'dismiss', id });
      },
      toast.action === null ? TOAST_DURATION_MS : TOAST_ACTION_DURATION_MS,
    );
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, [toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <ToastOverlay
          toast={toast}
          onDismiss={(id) => dispatch({ type: 'dismiss', id })}
        />
      </View>
    </ToastContext.Provider>
  );
}

/**
 * Garde le toast monté le temps de son animation de sortie : l'état a déjà été
 * remis à zéro par le réducteur, mais le contenu doit rester visible pour
 * s'effacer en douceur.
 */
function ToastOverlay({
  toast,
  onDismiss,
}: Readonly<{ toast: Toast | null; onDismiss(id: number): void }>) {
  const insets = useSafeAreaInsets();
  const bottomInset = isBottomNavigationVisible(usePathname())
    ? 0
    : insets.bottom;
  const [shown, setShown] = useState<Toast | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (toast !== null) {
      setShown(toast);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_MS,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: EXIT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [toast, progress]);

  if (shown === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { bottom: bottomInset + BOTTOM_CLEARANCE }]}
    >
      <Animated.View
        accessibilityLiveRegion={
          shown.tone === 'error' || shown.tone === 'warning'
            ? 'assertive'
            : 'polite'
        }
        accessibilityRole="alert"
        style={[
          styles.toast,
          {
            opacity: progress,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [ENTER_OFFSET, 0],
                }),
              },
            ],
          },
        ]}
      >
        <ToastIcon tone={shown.tone} />
        <Text style={styles.message}>{shown.message}</Text>
        {shown.action ? (
          <ToastAction
            action={shown.action}
            onDone={() => onDismiss(shown.id)}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

function ToastIcon({ tone }: Readonly<{ tone: ToastTone }>) {
  const color = toastToneColors[tone];
  if (tone === 'success') return <CheckIcon color={color} size={18} />;
  if (tone === 'warning') return <WarningIcon color={color} size={18} />;
  if (tone === 'error') return <ErrorIcon color={color} size={18} />;
  return <InfoIcon color={color} size={18} />;
}

/**
 * Le toast s'efface dès que l'action est déclenchée : la laisser affichée
 * inviterait à l'actionner une seconde fois, alors qu'elle a déjà eu lieu.
 */
function ToastAction({
  action,
  onDone,
}: Readonly<{ action: ToastActionButton; onDone(): void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        action.onPress();
        onDone();
      }}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Text style={styles.actionLabel}>{action.label}</Text>
    </Pressable>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null)
    throw new Error('useToast doit être utilisé sous ToastProvider.');
  return context;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    left: layout.screenPadding,
    position: 'absolute',
    right: layout.screenPadding,
  },
  toast: {
    alignItems: 'center',
    backgroundColor: colors.headerDark,
    borderRadius: radii.banner,
    flexDirection: 'row',
    gap: 11,
    minHeight: sizes.minTouch,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  message: {
    color: colors.onDark,
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
  },
  action: {
    alignItems: 'center',
    borderRadius: radii.pill,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
  },
  actionPressed: { backgroundColor: onDarkSurfaces.control },
  actionLabel: {
    color: colors.accentOnDark,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 17,
  },
});
