import { File, Paths } from 'expo-file-system';

export type CrashLogEntry = Readonly<{
  timestamp: string;
  message: string;
  stack: string | null;
}>;

const MAX_ENTRIES = 4;

function logFile(): File {
  return new File(Paths.document, 'pillbox-crash-log.json');
}

function safeEntry(error: unknown): CrashLogEntry {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    timestamp: new Date().toISOString(),
    message: value.message,
    stack: value.stack ?? null,
  };
}

export async function logCrash(error: unknown): Promise<void> {
  try {
    const entries = await readCrashLogs();
    const next = [safeEntry(error), ...entries].slice(0, MAX_ENTRIES);
    const file = logFile();
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(next));
  } catch {
    // Le journal ne doit jamais masquer le crash d'origine.
  }
}

export async function readCrashLogs(): Promise<CrashLogEntry[]> {
  try {
    const file = logFile();
    if (!file.exists) return [];
    const parsed: unknown = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCrashLogEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function clearCrashLogs(): void {
  const file = logFile();
  if (file.exists) file.delete();
}

export function crashLogUri(): string | null {
  const file = logFile();
  return file.exists ? file.uri : null;
}

function isCrashLogEntry(value: unknown): value is CrashLogEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.timestamp === 'string' &&
    typeof entry.message === 'string' &&
    (typeof entry.stack === 'string' || entry.stack === null)
  );
}
