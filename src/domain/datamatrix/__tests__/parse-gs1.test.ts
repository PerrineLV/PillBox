import { parseGs1DataMatrix } from '../parse-gs1';

const GS = '\u001d';

describe('parseGs1DataMatrix', () => {
  it('parse les champs dans un ordre variable', () => {
    const result = parseGs1DataMatrix(
      `]d217271231010340123456789010LOT-42${GS}21SERIAL-9`,
    );

    expect(result).toEqual({
      fields: {
        expiration: '271231',
        gtin: '03401234567890',
        lot: 'LOT-42',
      },
      errors: [],
      isGs1: true,
    });
  });

  it('ignore le numéro de série sans le signaler comme une erreur', () => {
    const result = parseGs1DataMatrix(`21SERIAL-9${GS}21AUTRE-SERIE`);

    expect(result.fields).toEqual({});
    expect(result.errors).toEqual([]);
    expect(result.isGs1).toBe(true);
  });

  it('accepte les champs absents', () => {
    expect(parseGs1DataMatrix('0103401234567890')).toEqual({
      fields: { gtin: '03401234567890' },
      errors: [],
      isGs1: true,
    });
  });

  it('utilise GS pour terminer chaque champ variable', () => {
    const result = parseGs1DataMatrix(`10LOT${GS}21SERIAL${GS}17271231`);

    expect(result.fields).toEqual({
      lot: 'LOT',
      expiration: '271231',
    });
    expect(result.errors).toEqual([]);
  });

  it('signale une chaîne invalide sans inventer de donnée', () => {
    const result = parseGs1DataMatrix(']d2ZZnot-gs1');

    expect(result.fields).toEqual({});
    expect(result.errors).toEqual([
      'AI inconnu ou invalide à la position 3: "ZZ".',
    ]);
  });

  it('conserve un parsing partiel avant un champ fixe incomplet', () => {
    const result = parseGs1DataMatrix('0103401234567890172712');

    expect(result.fields).toEqual({ gtin: '03401234567890' });
    expect(result.errors).toEqual([
      'AI 17 incomplet: 6 caractères attendus, 4 reçus.',
    ]);
  });

  it('ne devine pas la frontière de champs variables sans séparateur', () => {
    const result = parseGs1DataMatrix('10LOT21SERIAL');

    expect(result.fields).toEqual({ lot: 'LOT21SERIAL' });
    expect(result.errors).toEqual([]);
  });
});
