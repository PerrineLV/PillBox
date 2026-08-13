import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Message } from './components';
import { reduceToast, type ToastTone } from './toast-policy';
import { spacing } from './theme';

const TOAST_DURATION_MS = 4000;

type ToastContextValue = {
  showToast(message: string, tone?: ToastTone): void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Monté une seule fois au niveau racine de l'application : tout écran peut
 * déclencher un toast via useToast(), sans mécanisme local propre à l'écran.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, dispatch] = useReducer(reduceToast, null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    dispatch({ type: 'show', message, tone });
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const id = toast.id;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      dispatch({ type: 'dismiss', id });
    }, TOAST_DURATION_MS);
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, [toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {toast ? (
          <View pointerEvents="box-none" style={styles.overlay}>
            <SafeAreaView edges={['top']} style={styles.safeArea}>
              <View accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Message tone={toast.tone}>{toast.message}</Message>
              </View>
            </SafeAreaView>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null)
    throw new Error('useToast doit être utilisé sous ToastProvider.');
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  root: { flex: 1 },
  safeArea: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
