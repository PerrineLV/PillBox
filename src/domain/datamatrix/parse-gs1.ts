const GROUP_SEPARATOR = '\u001d';

type SupportedApplicationIdentifier = '01' | '17' | '10' | '21';

export type Gs1Fields = {
  gtin?: string;
  expiration?: string;
  lot?: string;
  serialNumber?: string;
};

export type Gs1ParseResult = {
  fields: Gs1Fields;
  errors: string[];
  isGs1: boolean;
};

type AiDefinition = {
  field: keyof Gs1Fields;
  fixedLength?: number;
  maximumLength: number;
  numeric: boolean;
};

const AI_DEFINITIONS: Record<SupportedApplicationIdentifier, AiDefinition> = {
  '01': { field: 'gtin', fixedLength: 14, maximumLength: 14, numeric: true },
  '17': {
    field: 'expiration',
    fixedLength: 6,
    maximumLength: 6,
    numeric: true,
  },
  '10': { field: 'lot', maximumLength: 20, numeric: false },
  '21': { field: 'serialNumber', maximumLength: 20, numeric: false },
};

function isSupportedAi(value: string): value is SupportedApplicationIdentifier {
  return Object.prototype.hasOwnProperty.call(AI_DEFINITIONS, value);
}

/**
 * Lit uniquement les AI nécessaires au spike. La valeur brute n'est jamais modifiée.
 * Les champs déjà lus sont conservés si la fin de la chaîne est invalide.
 */
export function parseGs1DataMatrix(raw: string): Gs1ParseResult {
  const fields: Gs1Fields = {};
  const errors: string[] = [];
  let cursor = raw.startsWith(']d2') ? 3 : 0;
  const hasGs1SymbologyIdentifier = cursor === 3;

  if (raw.length === cursor) {
    return {
      fields,
      errors: ['La chaîne GS1 est vide.'],
      isGs1: hasGs1SymbologyIdentifier,
    };
  }

  if (raw[cursor] === GROUP_SEPARATOR) {
    cursor += 1;
  }

  let recognizedCount = 0;

  while (cursor < raw.length) {
    if (raw[cursor] === GROUP_SEPARATOR) {
      cursor += 1;
      continue;
    }

    const ai = raw.slice(cursor, cursor + 2);
    if (!isSupportedAi(ai)) {
      errors.push(
        `AI inconnu ou invalide à la position ${cursor}: ${JSON.stringify(ai)}.`,
      );
      break;
    }

    recognizedCount += 1;
    cursor += 2;
    const definition = AI_DEFINITIONS[ai];
    let value: string;

    if (definition.fixedLength !== undefined) {
      value = raw.slice(cursor, cursor + definition.fixedLength);
      if (value.length !== definition.fixedLength) {
        errors.push(
          `AI ${ai} incomplet: ${definition.fixedLength} caractères attendus, ${value.length} reçus.`,
        );
        break;
      }
      cursor += definition.fixedLength;
    } else {
      const separatorPosition = raw.indexOf(GROUP_SEPARATOR, cursor);
      const end = separatorPosition === -1 ? raw.length : separatorPosition;
      value = raw.slice(cursor, end);
      cursor = end;

      if (value.length === 0) {
        errors.push(`AI ${ai} vide.`);
        continue;
      }
      if (value.length > definition.maximumLength) {
        errors.push(
          `AI ${ai} trop long: ${definition.maximumLength} caractères maximum, ${value.length} reçus.`,
        );
        continue;
      }
    }

    if (definition.numeric && !/^\d+$/.test(value)) {
      errors.push(`AI ${ai} doit contenir uniquement des chiffres.`);
      continue;
    }

    if (fields[definition.field] !== undefined) {
      errors.push(`AI ${ai} présent plusieurs fois.`);
      continue;
    }

    fields[definition.field] = value;
  }

  return {
    fields,
    errors,
    isGs1: hasGs1SymbologyIdentifier || recognizedCount > 0,
  };
}
