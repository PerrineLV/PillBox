# Test du rappel local sur un téléphone Android

Les rappels utilisent uniquement `expo-notifications` et une programmation locale. Aucun jeton push n'est demandé et aucune donnée n'est envoyée à un serveur. Les rappels de prise sont programmés sur un horizon glissant de **30 jours**, puis entièrement recalculés à chaque ouverture ou retour au premier plan de PillBox. Cela borne le nombre d'alarmes et réapplique l'heure civile du fuseau courant.

## Préparation

1. Installer une nouvelle build Android contenant le plugin natif `expo-notifications`. Une simple mise à jour JavaScript d'une ancienne build ne suffit pas après l'ajout du plugin.
   La build déclare aussi `SCHEDULE_EXACT_ALARM`, nécessaire à la programmation à heure exacte à partir d'Android 12.
2. Vérifier que la date, l'heure et le fuseau horaire automatiques du téléphone sont corrects.
3. Ouvrir **Plus > Rappels** dans PillBox, section **Rappel de préparation**.

Configurer les heures communes **Matin**, **Midi**, **Soir** et **Coucher** dans la section **Heures des rappels de prise**, puis activer l’unique interrupteur **Rappels de prise**. Tous les traitements non archivés sont alors pris en compte automatiquement, y compris ceux qui sont hors pilulier ; un traitement archivé ne génère aucun rappel. Le contenu système reste toujours neutre ; le détail n'apparaît que dans PillBox, après le verrou local lorsqu'il est activé.

## Scénarios à vérifier

### Permission accordée et ouverture du parcours

1. Choisir un jour et une heure proches, puis activer le rappel.
2. Accepter la permission Android. Un toast doit confirmer le jour et l'heure programmés, et l'interrupteur **Me rappeler de préparer** doit les rappeler sous son libellé.
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
4. Retirer à nouveau la permission dans Android puis rouvrir **Plus > Rappels** : PillBox doit désactiver et supprimer sa programmation locale, en l'annonçant.
5. Retirer la permission, revenir dans PillBox **sans ouvrir l'écran Rappels**, puis la rendre : les rappels doivent reprendre sans avoir à réactiver l'interrupteur. Une permission manquante ne supprime jamais silencieusement la programmation ; seule une désactivation explicite le fait.

### Désactivation

1. Désactiver l'interrupteur lorsqu'un rappel est actif.
2. Vérifier le toast **Rappel de préparation désactivé** et l'absence de notification à l'heure auparavant choisie.

Les optimisations batterie propres à certains constructeurs peuvent retarder une alarme. Pour valider le comportement produit, tester également sans mode économie d'énergie et avec PillBox autorisée à fonctionner normalement en arrière-plan.

## Rappels de prise, redémarrage et changements d'heure

1. Activer deux traitements utilisant le même créneau : une seule notification neutre doit apparaître à l’heure globale de ce créneau.
2. Toucher la notification : l'écran **Prise prévue** doit afficher les deux traitements, uniquement après déverrouillage de PillBox si cette protection est active.
3. Modifier une posologie puis archiver un traitement : les anciennes alarmes ne doivent plus se déclencher et aucun doublon ne doit apparaître.
4. Redémarrer le téléphone avec une prise prévue dans l'horizon, sans rouvrir PillBox, puis vérifier son déclenchement. Android restaure normalement les alarmes planifiées par `expo-notifications`, mais certains constructeurs peuvent les supprimer ou les retarder ; cette garantie ne peut pas être absolue avec la pile Expo actuelle.
5. Changer manuellement de fuseau, ou traverser un changement d'heure légale, puis rouvrir PillBox. Les 30 prochains jours doivent être recalculés à l'heure civile configurée. Tant que PillBox n'a pas été rouverte, une alarme déjà remise en place par Android peut conserver l'instant calculé dans l'ancien fuseau : l'application ne dispose pas, dans la pile Expo actuelle, d'un callback JavaScript fiable lorsque l'app est fermée pour recalculer immédiatement toutes les alarmes.

Une notification est une aide de ponctualité. Elle ne prouve ni n'enregistre la prise du médicament.

## Ouverture de l'application depuis une notification

Ces trois états doivent être vérifiés séparément sur un APK réel : le comportement diffère selon que le processus Android est vivant ou non, et une notification de prise se déclenche justement le plus souvent après que le système a arrêté PillBox.

1. **Application au premier plan** : toucher la notification doit afficher immédiatement **Prise prévue** pour le créneau concerné.
2. **Application en arrière-plan** : revenir à l'écran d'accueil Android, attendre la notification, la toucher. PillBox doit revenir au premier plan sur **Prise prévue**.
3. **Application complètement arrêtée** : la fermer depuis le sélecteur d'applications récentes, attendre la notification, la toucher. PillBox doit démarrer et arriver sur **Prise prévue** sans écran blanc ni fermeture immédiate.
4. Refaire le scénario 3 **avec le verrou local activé** : l'authentification Android doit s'afficher d'abord, puis **Prise prévue** doit apparaître une fois déverrouillé, pas l'accueil.
5. Refaire le scénario 3 avec une notification **reportée**, puis avec le rappel hebdomadaire de préparation : celui-ci doit ouvrir **Préparer mon pilulier**.
6. Vérifier enfin qu'un lancement manuel ordinaire, juste après ces essais, ouvre bien l'accueil et ne rejoue pas la dernière notification.

Le contenu visible de la notification reste neutre : l'identification du créneau voyage dans les données techniques de la notification, jamais dans le texte affiché par Android.

## Actions rapides depuis la notification

La notification de prise porte un bouton unique, dont le libellé dépend du nombre de médicaments encore en attente **au moment où le rappel a été programmé** : **Valider** pour un seul, **Tout valider** à partir de deux. Aucun bouton n'apparaît lorsque plus rien n'est en attente. Le comportement, lui, est toujours le même : valider les prises encore en attente du ou des créneaux concernés, sans jamais toucher une prise déjà renseignée. Un libellé devenu inexact entre la programmation et le déclenchement n'a donc aucune conséquence sur les données ; il se corrige à la prochaine ouverture de PillBox, qui reprogramme tout l'horizon.

1. **Un seul médicament en attente** : le bouton doit s'appeler **Valider**. L'actionner, puis ouvrir PillBox : la prise doit être **Pris**.
2. **Plusieurs médicaments en attente** : le bouton doit s'appeler **Tout valider**. L'actionner, puis vérifier dans l'historique que **chaque médicament** possède son propre enregistrement, tous à la **même heure de validation**, et qu'un médicament déjà marqué **Pris** ou **Ignoré** avant l'action est resté inchangé.
3. **Application au premier plan** : l'action doit enregistrer la validation sans changer d'écran.
4. **Application en arrière-plan** : mettre PillBox en arrière-plan, actionner le bouton. PillBox **ne doit pas** passer au premier plan ; la validation doit néanmoins être enregistrée, visible à la réouverture.
5. **Application complètement arrêtée** : fermer PillBox depuis les applications récentes, attendre la notification, actionner le bouton, puis rouvrir PillBox. Voir la limite ci-dessous.
6. **Idempotence** : actionner le bouton deux fois de suite, ou l'actionner puis valider à nouveau le créneau depuis l'écran **Prise prévue**. Aucun doublon ne doit apparaître dans l'historique et l'heure de validation initiale ne doit pas être réécrite.
7. **Appui standard** : toucher le corps de la notification, et non le bouton, doit toujours ouvrir PillBox sur **Prise prévue** sans rien valider.
8. **Verrou local activé** : l'action rapide fonctionne sans authentification, car elle n'affiche aucune donnée. Vérifier qu'elle n'ouvre ni ne déverrouille l'application.

### Limite connue lorsque l'application est complètement arrêtée

Avec `expo-notifications`, un bouton déclaré `opensAppToForeground: false` fait parvenir la réponse au code JavaScript de PillBox. Lorsque le processus est vivant — application au premier plan ou en arrière-plan — la validation est enregistrée immédiatement. Lorsque le processus a été arrêté, Android le réveille pour le seul récepteur natif : la réponse est mise de côté en mémoire et rejouée au prochain démarrage de PillBox, mais elle est perdue si Android recycle le processus avant. Le seul chemin garanti serait une tâche d'arrière-plan `expo-task-manager` ; elle n'a délibérément pas été ajoutée pour ce ticket.

La conséquence d'une perte est bornée et sans danger : la prise reste **Non renseigné**, statut qui ne conclut jamais qu'un médicament n'a pas été pris, et qui reste corrigeable depuis l'écran **Prise prévue**. Aucune donnée fausse n'est écrite.

Sur l'écran verrouillé, les notifications de PillBox sont en visibilité privée : Android masque leur contenu et leurs boutons tant que le téléphone n'est pas déverrouillé. Les libellés **Valider** et **Tout valider** ne nomment ni médicament, ni dose, ni créneau.

## Confirmation, historique et report

1. Ouvrir une notification et vérifier que les médicaments sont séparés par créneau lorsque deux créneaux partagent la même heure globale.
2. Marquer deux médicaments avec des états différents, puis corriger chacun vers **Non renseigné**, **Pris** et **Ignoré** depuis **Plus > Prises**.
3. Reporter un seul créneau à une heure proche. Vérifier que la notification reportée reste neutre et que l'autre créneau à la même heure n'est pas déplacé.
4. Remplacer le report : seule la nouvelle heure doit sonner. L'annuler : aucune notification reportée ne doit subsister.
5. Modifier ensuite la posologie et archiver le traitement. L'historique doit conserver le nom, la forme et la quantité qui avaient été matérialisés avant la modification.
6. Vérifier avant et après ces actions que le stock et l'historique de préparation n'ont pas changé.

Les statuts et reports restent locaux. **Non renseigné** signifie uniquement qu'aucune information n'a été saisie ; il ne permet pas de conclure que la prise a été faite ou omise.
