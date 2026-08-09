import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REQUIRED_VARIABLES = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
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
  await validateKeystore(keystorePath);
  console.log(`Keystore Android préparé dans ${keystorePath}.`);
}

async function validateKeystore(keystorePath) {
  const keyAlias = process.env.ANDROID_KEY_ALIAS;
  if (keyAlias === undefined) {
    throw new Error('ANDROID_KEY_ALIAS est absent.');
  }

  const validation = spawnSync(
    'keytool',
    [
      '-J-Duser.language=en',
      '-J-Duser.country=US',
      '-list',
      '-keystore',
      keystorePath,
      '-storetype',
      'PKCS12',
      '-storepass:env',
      'ANDROID_KEYSTORE_PASSWORD',
      '-alias',
      keyAlias,
    ],
    { encoding: 'utf8' },
  );

  if (validation.error !== undefined) {
    throw new Error(
      `Impossible d’exécuter keytool : ${validation.error.message}`,
    );
  }

  if (validation.status !== 0) {
    const details = `${validation.stdout}\n${validation.stderr}`.toLowerCase();
    if (details.includes('does not exist')) {
      throw new Error(
        'ANDROID_KEY_ALIAS ne correspond à aucune entrée du keystore.',
      );
    }

    throw new Error(
      'Impossible d’ouvrir le keystore PKCS#12. Vérifiez ANDROID_KEYSTORE_BASE64 et ANDROID_KEYSTORE_PASSWORD.',
    );
  }

  if (!validation.stdout.includes('PrivateKeyEntry')) {
    throw new Error(
      'ANDROID_KEY_ALIAS ne désigne pas une clé privée dans le keystore.',
    );
  }

  const validationDirectory = await mkdtemp(
    join(tmpdir(), 'pillbox-keystore-validation-'),
  );
  const validationKeystorePath = join(validationDirectory, 'validation.p12');

  try {
    const privateKeyValidation = spawnSync(
      'keytool',
      [
        '-J-Duser.language=en',
        '-J-Duser.country=US',
        '-importkeystore',
        '-srckeystore',
        keystorePath,
        '-srcstoretype',
        'PKCS12',
        '-srcstorepass:env',
        'ANDROID_KEYSTORE_PASSWORD',
        '-srcalias',
        keyAlias,
        '-srckeypass:env',
        'ANDROID_KEYSTORE_PASSWORD',
        '-destkeystore',
        validationKeystorePath,
        '-deststoretype',
        'PKCS12',
        '-deststorepass:env',
        'ANDROID_KEYSTORE_PASSWORD',
        '-destkeypass:env',
        'ANDROID_KEYSTORE_PASSWORD',
        '-noprompt',
      ],
      { encoding: 'utf8' },
    );

    if (privateKeyValidation.error !== undefined) {
      throw new Error(
        `Impossible d’exécuter keytool : ${privateKeyValidation.error.message}`,
      );
    }

    if (privateKeyValidation.status !== 0) {
      throw new Error(
        'Impossible de déverrouiller la clé privée. Le keystore PKCS#12 doit utiliser ANDROID_KEYSTORE_PASSWORD pour le conteneur et la clé.',
      );
    }
  } finally {
    await rm(validationDirectory, { force: true, recursive: true });
  }

  console.log('Keystore PKCS#12, mot de passe, alias et clé privée vérifiés.');
}
