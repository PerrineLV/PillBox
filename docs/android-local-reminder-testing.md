# Test du rappel local sur un téléphone Android

Les rappels utilisent uniquement `expo-notifications` et une programmation locale. Aucun jeton push n'est demandé et aucune donnée n'est envoyée à un serveur. Les rappels de prise sont programmés sur un horizon glissant de **30 jours**, puis entièrement recalculés à chaque ouverture ou retour au premier plan de PillBox. Cela borne le nombre d'alarmes et réapplique l'heure civile du fuseau courant.

## Préparation

1. Installer une nouvelle build Android contenant le plugin natif `expo-notifications`. Une simple mise à jour JavaScript d'une ancienne build ne suffit pas après l'ajout du plugin.
   La build déclare aussi `SCHEDULE_EXACT_ALARM`, nécessaire à la programmation à heure exacte à partir d'Android 12.
2. Vérifier que la date, l'heure et le fuseau horaire automatiques du téléphone sont corrects.
3. Ouvrir **Réglages > Rappel de préparation** dans PillBox.

Configurer les heures communes **Matin**, **Midi**, **Soir** et **Coucher**, puis activer l’unique interrupteur **Rappels de prise** dans les réglages. Tous les traitements non archivés sont alors pris en compte automatiquement, y compris ceux qui sont hors pilulier ; un traitement archivé ne génère aucun rappel. Le contenu système reste toujours neutre ; le détail n'apparaît que dans PillBox, après le verrou local lorsqu'il est activé.

## Scénarios à vérifier

### Permission accordée et ouverture du parcours

1. Choisir un jour et une heure proches, puis activer le rappel.
2. Accepter la permission Android. L'écran doit confirmer le jour et l'heure programmés.
3. Mettre l'application en arrière-plan, verrouiller si souhaité, puis attendre l'heure choisie.
4. Toucher la notification **Préparer mon pilulier**. PillBox doit ouvrir directement l'écran **Préparer mon pilulier**.
5. Refaire le test après avoir complètement arrêté PillBox : toucher la notification doit ouvrir le même parcours à froid.

### Remplacement unique

1. Avec un rappel actif, changer le jour ou l'heure et toucher **Enregistrer le nouveau rappel**.
2. Vérifier que seule la nouvelle heure déclenche une notification. L'ancienne programmation ne doit plus se déclencher.
3. Redémarrer le téléphone et vérifier que le rappel reste programmé.

### Refus et retrait de permission

1. Réinitialiser la permission depuis **Informations sur l'application > Notifications**, ou réinstaller l'application.
2. Activer le rappel puis refuser la permission : l'interrupteur doit rester désactivé, aucune programmation ne doit être créée et un lien doit proposer les réglages Android.
3. Autoriser ensuite les notifications dans Android, revenir dans PillBox et activer le rappel.
4. Retirer à nouveau la permission dans Android puis rouvrir l'écran Réglages : PillBox doit désactiver et supprimer sa programmation locale.

### Désactivation

1. Désactiver l'interrupteur lorsqu'un rappel est actif.
2. Vérifier le message **Rappel désactivé** et l'absence de notification à l'heure auparavant choisie.

Les optimisations batterie propres à certains constructeurs peuvent retarder une alarme. Pour valider le comportement produit, tester également sans mode économie d'énergie et avec PillBox autorisée à fonctionner normalement en arrière-plan.

## Rappels de prise, redémarrage et changements d'heure

1. Activer deux traitements utilisant le même créneau : une seule notification neutre doit apparaître à l’heure globale de ce créneau.
2. Toucher la notification : l'écran **Prise prévue** doit afficher les deux traitements, uniquement après déverrouillage de PillBox si cette protection est active.
3. Modifier une posologie puis archiver un traitement : les anciennes alarmes ne doivent plus se déclencher et aucun doublon ne doit apparaître.
4. Redémarrer le téléphone avec une prise prévue dans l'horizon, sans rouvrir PillBox, puis vérifier son déclenchement. Android restaure normalement les alarmes planifiées par `expo-notifications`, mais certains constructeurs peuvent les supprimer ou les retarder ; cette garantie ne peut pas être absolue avec la pile Expo actuelle.
5. Changer manuellement de fuseau, ou traverser un changement d'heure légale, puis rouvrir PillBox. Les 30 prochains jours doivent être recalculés à l'heure civile configurée. Tant que PillBox n'a pas été rouverte, une alarme déjà remise en place par Android peut conserver l'instant calculé dans l'ancien fuseau : l'application ne dispose pas, dans la pile Expo actuelle, d'un callback JavaScript fiable lorsque l'app est fermée pour recalculer immédiatement toutes les alarmes.

Une notification est une aide de ponctualité. Elle ne prouve ni n'enregistre la prise du médicament.

## Confirmation, historique et report

1. Ouvrir une notification et vérifier que les médicaments sont séparés par créneau lorsque deux créneaux partagent la même heure globale.
2. Marquer deux médicaments avec des états différents, puis corriger chacun vers **Non renseigné**, **Pris** et **Ignoré** depuis l'historique.
3. Reporter un seul créneau à une heure proche. Vérifier que la notification reportée reste neutre et que l'autre créneau à la même heure n'est pas déplacé.
4. Remplacer le report : seule la nouvelle heure doit sonner. L'annuler : aucune notification reportée ne doit subsister.
5. Modifier ensuite la posologie et archiver le traitement. L'historique doit conserver le nom, la forme et la quantité qui avaient été matérialisés avant la modification.
6. Vérifier avant et après ces actions que le stock et l'historique de préparation n'ont pas changé.

Les statuts et reports restent locaux. **Non renseigné** signifie uniquement qu'aucune information n'a été saisie ; il ne permet pas de conclure que la prise a été faite ou omise.
