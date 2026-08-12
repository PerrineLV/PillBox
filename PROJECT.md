# Vision

Application mobile personnelle pour assister la préparation hebdomadaire d'un pilulier : traitements réels, scan DataMatrix, lots/péremptions, stock, alertes et rappels (préparation hebdomadaire et prises quotidiennes).

# Principes

- **Local-first** : données personnelles dans SQLite sur le téléphone.
- Pas de compte, backend, cloud, analytics ou publicité pour le MVP.
- La posologie est toujours saisie par l'utilisateur ; l'application ne la déduit jamais.
- En cas d'incertitude pharmaceutique ou d'identification : ne jamais deviner.
- Le scan sert à vérifier la boîte réellement utilisée pendant la préparation ; lorsqu'il n'est pas disponible, cette boîte est désignée explicitement dans le stock déjà enregistré.

# Stack

React Native + Expo + TypeScript strict + Expo Router + expo-sqlite + expo-camera. Notifications locales Expo pour le rappel hebdomadaire de préparation et pour les rappels de prise quotidiens (avec actions rapides pris/ignoré). Ajouter une dépendance seulement lorsqu'elle apporte une vraie valeur au produit.

# Données médicaments

Référentiel issu de la Base de données publique des médicaments. Distinguer spécialité (CIS) et présentation (CIP13). L'import est préparé hors de l'app puis consommé localement. Le référentiel inclut aussi le regroupement officiel des spécialités en groupes génériques (BDPM), utilisé uniquement à titre informatif.

# Modèle fonctionnel

**Traitement** : spécialité + phases successives de posologie structurée + inclusion dans le pilulier + archivage.

**Phase de posologie** : période datée, fréquence explicite (quotidienne, tous les N jours avec ancre, ou hebdomadaire avec jour choisi) + créneaux matin/midi/soir/coucher + quantités fractionnaires possibles.

**Boîte** : présentation + lot + péremption + quantité initiale/restante + origine (scan DataMatrix ou saisie manuelle). Le numéro de série unitaire n'a pas de valeur métier ici et n'intervient dans aucun écran ni aucune règle.

**Préparation** : période de 7 jours + snapshot des traitements + progression + boîtes/lots réellement utilisés + statut.

**Prise** : occurrence datée d'un créneau de posologie au sein d'une préparation, de statut en attente / prise / ignorée ; renseignée individuellement ou validée en groupe pour un même créneau, y compris depuis une action rapide de notification.

**Mouvement de stock** : entrée, ajustement, correction ou consommation lors d'une préparation.

# Parcours principal

1. Saisir les traitements à partir du référentiel réel.
2. Constituer le stock : scanner les boîtes, ou les ajouter manuellement depuis le référentiel lorsque le DataMatrix est absent ou illisible.
3. Recevoir chaque semaine une notification locale configurable pour lancer la préparation, et à chaque créneau de prise une notification locale rappelant les médicaments à prendre.
4. Lancer « Préparer mon pilulier » (une seule préparation active à la fois ; elle peut être annulée tant qu'aucun mouvement de stock n'a été enregistré).
5. L'app calcule les besoins pour 7 jours.
6. Pour chaque médicament : désigner la boîte utilisée, par scan ou en la choisissant dans le stock, vérifier identité/lot/péremption, afficher les cases et quantités, valider.
7. Faire un contrôle final.
8. Valider transactionnellement la préparation et décrémenter les bons lots.
9. Marquer chaque prise comme faite ou ignorée au fil de la semaine, individuellement ou en groupe pour un même créneau.
10. Conserver l'historique des préparations et des prises.

# Suivi et alertes

- Alertes de stock insuffisant (en dessous du besoin de la semaine ou d'une marge basse) et de péremption proche, calculées à partir des traitements actifs et du stock réel.
- Liste des médicaments à renouveler, classée par urgence (rupture avant la prochaine préparation, rupture proche, stock bas) à partir de la prévision de consommation.
- Sauvegarde et restauration locales de la base (export/import de fichier), avec conservation volontaire d'une copie de sécurité avant toute restauration.

# Règles critiques

- Une boîte périmée ne peut pas être utilisée pour une préparation.
- Un médicament différent ne doit jamais être accepté silencieusement.
- Lors de la vérification d'une boîte pendant une préparation, une boîte d'un autre membre du même groupe générique officiel (BDPM) que la spécialité attendue peut être acceptée pour un traitement, mais seulement après confirmation explicite de l'utilisatrice lors de la première rencontre de ce couple (traitement, CIS) précis ; aucune acceptation automatique ou silencieuse. Cette confirmation est ensuite mémorisée pour ce couple précis et n'est plus redemandée, mais reste consultable et révocable individuellement depuis la fiche du traitement ; elle ne s'étend jamais automatiquement à un autre membre du groupe non encore confirmé. Le traitement conserve la spécialité prescrite d'origine : seule la boîte, le mouvement de stock ou la préparation trace l'équivalence confirmée, distinctement d'une correspondance exacte. Hors groupe générique officiel, un CIS différent reste toujours refusé.
- Le groupe générique affiché est une information BDPM à titre indicatif ; il ne déclenche, ne suggère ni ne pré-remplit aucun remplacement de médicament, de boîte ou de ligne de stock.
- Si plusieurs lots conviennent, recommander FEFO mais permettre une autre boîte valide après avertissement.
- La validation finale est atomique et impossible deux fois.
- Une seule préparation peut être en cours à la fois ; son annulation ne modifie ni le stock ni l'historique et est refusée dès qu'un mouvement de stock existe pour elle.
- Une préparation conserve un snapshot : modifier ensuite un traitement ne modifie jamais l'historique.
- Les fractions doivent être calculées sans approximation métier silencieuse.
- Les données RAW du DataMatrix restent disponibles pour diagnostic lorsque nécessaire.
- Le scan est une voie de saisie et de vérification, jamais une obligation : une boîte ajoutée manuellement participe au stock et aux préparations avec les mêmes règles de quantité et de péremption.
- Une saisie manuelle n'est jamais présentée comme une vérification par scan. L'origine d'une boîte et le mode de vérification d'une préparation sont enregistrés et affichés distinctement.

# Hors scope MVP

Conseils médicaux, interactions, diagnostic, lecture automatique d'ordonnance, professionnels de santé, profils multiples, synchronisation cloud, IA médicale, Mon espace santé.

# Definition of Done MVP

Je peux saisir mes traitements, ajouter mes boîtes par scan ou manuellement, suivre lots/péremptions/stocks avec alertes et liste de renouvellement, recevoir mon rappel hebdomadaire et mes rappels de prise, préparer réellement un pilulier de 7 jours avec vérification des boîtes, valider la préparation, marquer mes prises, retrouver les lots utilisés dans l'historique, et sauvegarder/restaurer mes données localement, sans connexion à un serveur.

# Confidentialité locale et durcissement Android

- La base SQLite et les réglages locaux sont explicitement exclus de la sauvegarde automatique et du transfert d’appareil Android (`android.allowBackup: false`). Les caches sont privés et exclus par Android ; les fichiers intermédiaires d’export/import y sont supprimés après utilisation. Les copies de sécurité créées avant restauration sont, elles, conservées volontairement dans le dossier privé de documents de PillBox.
- Le verrou optionnel délègue l’authentification à Android via `expo-local-authentication`. PillBox ne stocke aucun PIN, mot de passe, secret ou gabarit biométrique. Ce verrou contrôle l’accès à l’interface mais ne chiffre pas SQLite ni les exports.
- Le comportement du verrou suit le cycle de vie Android et est décrit par une politique unique (`src/domain/privacy/app-lock-policy.ts`) : toute ouverture à froid exige une authentification ; un aller-retour bref vers une autre application n’en redemande pas ; au-delà de `APP_LOCK_GRACE_PERIOD_MS` (60 secondes d’absence, temporisation courante pour des données sensibles), PillBox se reverrouille. L’état n’est jamais persisté : si Android tue le processus, le lancement suivant est une ouverture à froid. Tant que le verrou est activé, le contenu est masqué dès que l’application quitte le premier plan, y compris pendant la boîte de dialogue d’authentification, laquelle ne doit jamais provoquer un second prompt.
- Les notifications ont une visibilité privée sur l’écran verrouillé et un contenu volontairement limité : elles indiquent qu’une action PillBox attend (remplir le pilulier, ou le nombre de médicaments à prendre) mais ne nomment jamais un médicament, une posologie, un lot ni une quantité de stock. Aucun réglage de contenu détaillé n’est proposé.
- La détection de nouvelle version est le seul appel réseau de PillBox. Elle interroge l’API publique `api.github.com` pour lire la dernière GitHub Release du dépôt, sans jeton, sans compte et sans envoyer la moindre donnée : ni identifiant d’appareil, ni donnée de santé, ni télémétrie. La requête est anonyme et sortante uniquement. Elle est limitée à une fois toutes les six heures grâce à un cache local, n’a lieu qu’au lancement et au retour au premier plan, et son échec est silencieux : hors ligne, PillBox fonctionne exactement comme avant. Le cache local ne contient que des informations publiques (version, URL de release) et la version reportée par l’utilisatrice ; il est volontairement exclu des sauvegardes afin qu’une restauration ne masque pas une mise à jour. Aucune mise à jour automatique ni silencieuse n’existe : le téléchargement puis l’installation restent des actions explicites soumises aux protections Android habituelles.
- Les captures d’écran ne sont pas bloquées. `expo-screen-capture` fournit une API Expo stable, mais un blocage sur les écrans de traitements, posologies, stock et historique empêcherait des usages légitimes (montrer ponctuellement une information à un professionnel ou demander de l’aide). Le verrou au passage en arrière-plan limite l’exposition dans le sélecteur d’applications lorsque l’option est activée. Cette décision est à réévaluer si PillBox ajoute un mode confidentialité distinct et explicite.
