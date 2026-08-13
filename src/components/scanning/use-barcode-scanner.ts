import { useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';

/**
 * Plomberie caméra commune aux écrans qui vérifient une boîte par DataMatrix
 * (ajout au stock, préparation, complément d'une case en attente) : état de
 * permission caméra et verrou anti-double-scan. Le traitement du résultat
 * scanné (parsing GS1, matching, vérification métier) reste propre à chaque
 * écran.
 */
export function useBarcodeScanner() {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);

  return {
    permission,
    requestPermission,
    /** À appeler avant de (re)lancer un scan, pour autoriser le prochain résultat. */
    unlock(): void {
      locked.current = false;
    },
    /**
     * Verrouille immédiatement et renvoie `true` si cet appel doit être
     * traité, `false` si un résultat est déjà en cours de traitement (la
     * caméra déclenche parfois `onBarcodeScanned` plusieurs fois avant que
     * l'écran ne se referme).
     */
    lockOnce(): boolean {
      if (locked.current) return false;
      locked.current = true;
      return true;
    },
  };
}

export type BarcodeScanner = ReturnType<typeof useBarcodeScanner>;
