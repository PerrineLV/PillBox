import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REQUIRED_VARIABLES = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

const mode = process.argv[2];

try {
  validateSigningEnvironment();

  if (mode === '--validate') {
    console.log('Les variables de signature Android sont présentes.');
  } else if (mode === '--write-keystore') {
    await writeKeystore();
  } else {
    throw new Error(
      'Mode attendu : --validate ou --write-keystore pour android-signing.mjs.',
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error title=Signature Android::${message}`);
  process.exitCode = 1;
}

function validateSigningEnvironment() {
  const missingVariables = REQUIRED_VARIABLES.filter(
    (variable) => !process.env[variable],
  );

  if (missingVariables.length > 0) {
    throw new Error(
      `Secrets GitHub manquants : ${missingVariables.join(', ')}.`,
    );
  }
}

async function writeKeystore() {
  const encodedKeystore = process.env.ANDROID_KEYSTORE_BASE64;
  if (encodedKeystore === undefined) {
    throw new Error('ANDROID_KEYSTORE_BASE64 est absent.');
  }

  const normalizedKeystore = encodedKeystore.replace(/\s/g, '');
  if (
    normalizedKeystore.length === 0 ||
    normalizedKeystore.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedKeystore)
  ) {
    throw new Error(
      'ANDROID_KEYSTORE_BASE64 ne contient pas un Base64 valide.',
    );
  }

  const keystore = Buffer.from(normalizedKeystore, 'base64');
  if (keystore.length === 0) {
    throw new Error('Le keystore Android décodé est vide.');
  }

  const keystorePath = resolve('android/app/release.keystore');
  await mkdir(resolve('android/app'), { recursive: true });
  await writeFile(keystorePath, keystore, { mode: 0o600 });
  console.log(`Keystore Android préparé dans ${keystorePath}.`);
}
