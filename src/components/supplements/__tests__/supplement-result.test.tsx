import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { DenseRow, PillButton } from '@/ui';
import { SupplementResult } from '../supplement-result';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
it('permet d’examiner les métadonnées manquantes avant de choisir la bonne référence', () => {
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <SupplementResult
        first
        result={{
          externalId: '42',
          name: 'Magnésium',
          brand: null,
          operator: 'Société Test',
          productRange: null,
          form: 'Gélule',
        }}
        returnTo="/prescriptions/new"
      />,
    );
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    'Opérateur responsable : Société Test',
  );
  expect(renderer!.root.findAllByType(PillButton)).toHaveLength(0);
  act(() => renderer!.root.findByType(DenseRow).props.onPress());
  expect(JSON.stringify(renderer!.toJSON())).toContain('Marque non renseignée');
  expect(JSON.stringify(renderer!.toJSON())).toContain(
    'Dosage produit et conditionnement non disponibles',
  );
  act(() => renderer!.root.findByType(PillButton).props.onPress());
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/treatments/new',
    params: {
      source: 'COMPL_ALIM',
      externalId: '42',
      name: 'Magnésium',
      form: 'Gélule',
      returnTo: '/prescriptions/new',
    },
  });
  act(() => renderer!.unmount());
});
