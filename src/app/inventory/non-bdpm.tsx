import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { ExpirationField } from '@/components/inventory/expiration-field';
import type { Treatment } from '@/domain/treatments/treatment';
import {
  addMedicationBox,
  listMedicationBoxes,
} from '@/infrastructure/inventory/inventory-repository';
import { listTreatments } from '@/infrastructure/treatments/treatment-repository';
import {
  AppCard,
  AppField,
  AppScreen,
  Message,
  PillButton,
  StackHeader,
  typography,
} from '@/ui';

export default function AddNonBdpmBoxScreen() {
  const database = useSQLiteContext();
  const router = useRouter();
  const { treatmentId } = useLocalSearchParams<{ treatmentId?: string }>();
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [selected, setSelected] = useState<Treatment | null>(null);
  const [lot, setLot] = useState('');
  const [expiration, setExpiration] = useState('');
  const [quantity, setQuantity] = useState('');
  const [duplicateFound, setDuplicateFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listTreatments(database)
      .then((items) => {
        if (!active) return;
        const eligible = items.filter(
          (item) => item.archivedAt === null && item.productSource !== 'BDPM',
        );
        setTreatments(eligible);
        if (treatmentId) {
          setSelected(
            eligible.find((item) => item.id === Number(treatmentId)) ?? null,
          );
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : 'Chargement impossible.',
          );
      });
    return () => {
      active = false;
    };
  }, [database, treatmentId]);

  async function save(duplicateConfirmed = false) {
    if (selected === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!duplicateConfirmed) {
        const boxes = await listMedicationBoxes(database);
        const duplicate = boxes.some(
          (box) =>
            box.specialtyCis === selected.specialtyCis &&
            box.lot?.trim() === lot.trim() &&
            box.remainingQuantity > 0,
        );
        if (duplicate) {
          setDuplicateFound(true);
          return;
        }
      }
      await addMedicationBox(database, {
        specialtyCis: selected.specialtyCis,
        specialtyName: selected.specialtyName,
        pharmaceuticalForm: selected.pharmaceuticalForm,
        productSource: selected.productSource,
        presentationCip13: '',
        presentationLabel:
          selected.pharmaceuticalForm ?? selected.specialtyName,
        lot,
        expirationDate: expiration,
        initialQuantity: Number(quantity),
        origin: 'MANUAL',
        scanRaw: null,
      });
      router.dismissTo('/inventory');
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppScreen header={<StackHeader title="Ajouter un produit au stock" />}>
      {error ? <Message tone="error">{error}</Message> : null}
      {selected === null ? (
        treatments.length === 0 ? (
          <Message tone="info">Créez d’abord un traitement hors BDPM.</Message>
        ) : (
          treatments.map((item) => (
            <AppCard key={item.id}>
              <Text style={typography.itemTitle}>{item.specialtyName}</Text>
              <Text style={typography.micro}>
                {item.productSource === 'COMPL_ALIM'
                  ? 'Complément · Compl’Alim'
                  : 'Saisie manuelle'}
              </Text>
              <PillButton label="Choisir" onPress={() => setSelected(item)} />
            </AppCard>
          ))
        )
      ) : (
        <>
          <AppCard>
            <Text style={typography.itemTitle}>{selected.specialtyName}</Text>
            <Text style={typography.micro}>
              Ajout sans scan · lot et péremption saisis par vous
            </Text>
            <PillButton
              label="Changer de traitement"
              tone="outline"
              onPress={() => setSelected(null)}
            />
          </AppCard>
          <AppField
            label="Lot"
            value={lot}
            onChangeText={(value) => {
              setLot(value);
              setDuplicateFound(false);
            }}
          />
          <ExpirationField
            label="Péremption"
            value={expiration}
            onChange={setExpiration}
          />
          <AppField
            label="Quantité initiale"
            keyboardType="number-pad"
            value={quantity}
            onChangeText={setQuantity}
          />
          {duplicateFound ? (
            <Message tone="warning">
              Une boîte de ce produit avec le même lot est déjà en stock.
              Vérifiez avant de continuer.
            </Message>
          ) : null}
          <PillButton
            disabled={saving || !lot.trim() || !expiration || !quantity.trim()}
            label={duplicateFound ? 'Ajouter quand même' : 'Ajouter au stock'}
            onPress={() => void save(duplicateFound)}
          />
        </>
      )}
    </AppScreen>
  );
}
