import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { PillBoxBackup } from '@/domain/backup/backup';

export async function sha256(contents: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    contents,
  );
}

export async function shareBackup(backup: PillBoxBackup): Promise<void> {
  if (!(await Sharing.isAvailableAsync()))
    throw new Error(
      'La feuille de partage n’est pas disponible sur cet appareil.',
    );
  const file = writeBackupFile(Paths.cache, backup, 'pillbox-sauvegarde');
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Exporter mes données PillBox',
      UTI: 'public.json',
    });
  } finally {
    deletePrivateFile(file);
  }
}

export async function chooseBackupFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const copiedFile = new File(result.assets[0].uri);
  try {
    return await copiedFile.text();
  } finally {
    deletePrivateFile(copiedFile);
  }
}

function deletePrivateFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Le cache privé reste inaccessible aux autres applications et Android
    // peut le purger. Une suppression impossible ne doit pas masquer le
    // résultat du partage ou de la sélection.
  }
}

export function writeSafetyBackup(backup: PillBoxBackup): string {
  const directory = new Directory(Paths.document, 'sauvegardes-securite');
  directory.create({ idempotent: true, intermediates: true });
  return writeBackupFile(directory, backup, 'pillbox-avant-restauration').uri;
}

function writeBackupFile(
  directory: Directory,
  backup: PillBoxBackup,
  prefix: string,
): File {
  const stamp = backup.metadata.createdAt.replace(/[:.]/g, '-');
  const file = new File(directory, `${prefix}-${stamp}.json`);
  file.create({ overwrite: true, intermediates: true });
  file.write(JSON.stringify(backup, null, 2));
  return file;
}
