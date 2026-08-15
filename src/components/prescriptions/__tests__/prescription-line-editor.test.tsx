import { Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Treatment } from '@/domain/treatments/treatment';
import { detectControlledDispensingMention } from '@/infrastructure/medications/medication-reference';

import {
  attachTreatmentToLine,
  emptyPrescriptionLine,
  PrescriptionLineEditor,
  type PrescriptionLineDraft,
} from '../prescription-line-editor';

jest.mock('@/infrastructure/medications/medication-reference', () => ({
  detectControlledDispensingMention: jest.fn(),
}));

const mockedDetect = detectControlledDispensingMention as jest.Mock;

function scheduledTreatment(overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: 1,
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: null,
    dosageKind: 'SCHEDULED',
    includedInPillbox: true,
    archivedAt: null,
    phases: [],
    asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
    ...overrides,
  };
}

function asNeededTreatment(overrides: Partial<Treatment> = {}): Treatment {
  return scheduledTreatment({
    id: 2,
    specialtyCis: '60000002',
    specialtyName: 'Beta',
    dosageKind: 'AS_NEEDED',
    includedInPillbox: false,
    ...overrides,
  });
}

async function renderEditor(
  line: PrescriptionLineDraft,
  overrides: Partial<{
    treatments: readonly Treatment[];
    onChange: jest.Mock;
    onRemove: jest.Mock;
    onRequestNewTreatment: jest.Mock;
  }> = {},
): Promise<{
  renderer: ReactTestRenderer;
  onChange: jest.Mock;
  onRemove: jest.Mock;
  onRequestNewTreatment: jest.Mock;
}> {
  const onChange = overrides.onChange ?? jest.fn();
  const onRemove = overrides.onRemove ?? jest.fn();
  const onRequestNewTreatment = overrides.onRequestNewTreatment ?? jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <PrescriptionLineEditor
        line={line}
        treatments={overrides.treatments ?? [scheduledTreatment()]}
        referenceDatabase={{} as never}
        onChange={onChange}
        onRemove={onRemove}
        onRequestNewTreatment={onRequestNewTreatment}
      />,
    );
  });
  return { renderer, onChange, onRemove, onRequestNewTreatment };
}

beforeEach(() => {
  mockedDetect.mockReset();
  mockedDetect.mockResolvedValue(false);
});

describe('ligne sans traitement choisi', () => {
  it('propose les deux entrées : renouveler ou ajouter', async () => {
    const { renderer } = await renderEditor(emptyPrescriptionLine('l1'));
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Renouveler un traitement existant');
    expect(json).toContain('Ajouter un nouveau traitement');
  });

  it('déclenche la création d’un nouveau traitement au clic', async () => {
    const { renderer, onRequestNewTreatment } = await renderEditor(
      emptyPrescriptionLine('l1'),
    );
    const button = renderer.root.findByProps({
      accessibilityLabel: 'Ajouter un nouveau traitement',
    });
    await act(async () => button.props.onPress());
    expect(onRequestNewTreatment).toHaveBeenCalledTimes(1);
  });

  it('désactive le renouvellement quand aucun traitement n’existe', async () => {
    const { renderer } = await renderEditor(emptyPrescriptionLine('l1'), {
      treatments: [],
    });
    const button = renderer.root.findByProps({
      accessibilityLabel: 'Renouveler un traitement existant',
    });
    expect(button.props.accessibilityState.disabled).toBe(true);
  });

  it('sélectionne un traitement existant et l’attache avec DURATION par défaut', async () => {
    const treatment = scheduledTreatment();
    const { renderer, onChange } = await renderEditor(
      emptyPrescriptionLine('l1'),
      {
        treatments: [treatment],
      },
    );
    const renewButton = renderer.root.findByProps({
      accessibilityLabel: 'Renouveler un traitement existant',
    });
    await act(async () => renewButton.props.onPress());

    const opener = renderer.root.findByProps({
      accessibilityLabel: 'Traitement à renouveler, Choisir un traitement',
    });
    await act(async () => opener.props.onPress());

    const option = renderer.root.findByProps({ accessibilityRole: 'menuitem' });
    await act(async () => option.props.onPress());

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ treatment, quantityKind: 'DURATION' }),
    );
  });
});

describe('ligne avec traitement planifié (SCHEDULED)', () => {
  function line(
    overrides: Partial<PrescriptionLineDraft> = {},
  ): PrescriptionLineDraft {
    return {
      ...attachTreatmentToLine(
        emptyPrescriptionLine('l1'),
        scheduledTreatment(),
      ),
      ...overrides,
    };
  }

  it('propose DURATION par défaut, modifiable en BOX_COUNT', async () => {
    const { renderer, onChange } = await renderEditor(line());
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Durée couverte (jours)');

    const radios = renderer.root.findAllByProps({ accessibilityRole: 'radio' });
    const boxChoice = radios.find(
      (radio) => radio.props.accessibilityState.checked === false,
    );
    if (!boxChoice) throw new Error('Choix « Nombre de boîtes » introuvable.');
    await act(async () => boxChoice.props.onPress());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ quantityKind: 'BOX_COUNT' }),
    );
  });

  it('révèle la périodicité en mode fractionné', async () => {
    const { renderer, onChange } = await renderEditor(
      line({ dispensingMode: 'FULL' }),
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Périodicité');

    const toggle = renderer.root.findByType(Switch);
    await act(async () => toggle.props.onValueChange(true));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dispensingMode: 'FRACTIONAL' }),
    );
  });
});

describe('ligne avec traitement si besoin (AS_NEEDED)', () => {
  it('force BOX_COUNT sans proposer de choix', async () => {
    const attached = attachTreatmentToLine(
      emptyPrescriptionLine('l1'),
      asNeededTreatment(),
    );
    const { renderer } = await renderEditor(attached);
    const json = JSON.stringify(renderer.toJSON());
    expect(json).toContain('Nombre de boîtes délivrées');
    expect(json).not.toContain('Durée couverte');
    expect(json).not.toContain('accessibilityRole":"radio"');
  });
});

describe('tolérance de délivrance fractionnée', () => {
  it('suggère une tolérance pour une spécialité non détectée stupéfiant', async () => {
    mockedDetect.mockResolvedValue(false);
    const attached = {
      ...attachTreatmentToLine(
        emptyPrescriptionLine('l1'),
        scheduledTreatment(),
      ),
      dispensingMode: 'FRACTIONAL' as const,
    };
    const onChange = jest.fn();
    await renderEditor(attached, { onChange });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isControlledSubstance: false,
        toleranceDaysText: '3',
      }),
    );
  });

  it('ne suggère aucune tolérance pour une spécialité détectée stupéfiant', async () => {
    mockedDetect.mockResolvedValue(true);
    const attached = {
      ...attachTreatmentToLine(
        emptyPrescriptionLine('l1'),
        scheduledTreatment(),
      ),
      dispensingMode: 'FRACTIONAL' as const,
    };
    const onChange = jest.fn();
    await renderEditor(attached, { onChange });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ isControlledSubstance: true }),
    );
  });
});
