# Test du rappel local sur un téléphone Android

Le rappel utilise uniquement `expo-notifications` et une programmation locale hebdomadaire. Aucun jeton push n'est demandé et aucune donnée n'est envoyée à un serveur.

## Préparation

1. Installer une nouvelle build Android contenant le plugin natif `expo-notifications`. Une simple mise à jour JavaScript d'une ancienne build ne suffit pas après l'ajout du plugin.
   La build déclare aussi `SCHEDULE_EXACT_ALARM`, nécessaire à la programmation à heure exacte à partir d'Android 12.
2. Vérifier que la date, l'heure et le fuseau horaire automatiques du téléphone sont corrects.
3. Ouvrir **Réglages > Rappel de préparation** dans PillBox.

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
