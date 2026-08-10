# Vision

Application mobile personnelle pour assister la préparation hebdomadaire d'un pilulier : traitements réels, scan DataMatrix, lots/péremptions, stock et rappel hebdomadaire.

# Principes

- **Local-first** : données personnelles dans SQLite sur le téléphone.
- Pas de compte, backend, cloud, analytics ou publicité pour le MVP.
- La posologie est toujours saisie par l'utilisateur ; l'application ne la déduit jamais.
- En cas d'incertitude pharmaceutique ou d'identification : ne jamais deviner.
- Le scan doit vérifier la boîte réellement utilisée pendant la préparation.

# Stack

React Native + Expo + TypeScript strict + Expo Router + expo-sqlite + expo-camera. Notifications locales Expo pour le rappel hebdomadaire. Ajouter une dépendance seulement lorsqu'elle apporte une vraie valeur au produit.

# Données médicaments

Référentiel issu de la Base de données publique des médicaments. Distinguer spécialité (CIS) et présentation (CIP13). L'import est préparé hors de l'app puis consommé localement.

# Modèle fonctionnel

**Traitement** : spécialité + phases successives de posologie structurée + inclusion dans le pilulier + archivage.

**Phase de posologie** : période datée, fréquence explicite (quotidienne, tous les N jours avec ancre, ou hebdomadaire avec jour choisi) + créneaux matin/midi/soir/coucher + quantités fractionnaires possibles.

**Boîte** : présentation + lot + numéro de série éventuel + péremption + quantité initiale/restante.

**Préparation** : période de 7 jours + snapshot des traitements + progression + boîtes/lots réellement utilisés + statut.

**Mouvement de stock** : entrée, ajustement, correction ou consommation lors d'une préparation.

# Parcours principal

1. Saisir les traitements à partir du référentiel réel.
2. Scanner les boîtes pour constituer le stock.
3. Recevoir chaque semaine une notification locale configurable.
4. Lancer « Préparer mon pilulier ».
5. L'app calcule les besoins pour 7 jours.
6. Pour chaque médicament : scanner la boîte, vérifier identité/lot/péremption, afficher les cases et quantités, valider.
7. Faire un contrôle final.
8. Valider transactionnellement la préparation et décrémenter les bons lots.
9. Conserver l'historique.

# Règles critiques

- Une boîte périmée ne peut pas être utilisée pour une préparation.
- Un médicament différent ne doit jamais être accepté silencieusement.
- Ne pas automatiser la substitution générique sans règle explicitement validée.
- Si plusieurs lots conviennent, recommander FEFO mais permettre une autre boîte valide après avertissement.
- La validation finale est atomique et impossible deux fois.
- Une préparation conserve un snapshot : modifier ensuite un traitement ne modifie jamais l'historique.
- Les fractions doivent être calculées sans approximation métier silencieuse.
- Les données RAW du DataMatrix restent disponibles pour diagnostic lorsque nécessaire.

# Hors scope MVP

Conseils médicaux, interactions, diagnostic, lecture automatique d'ordonnance, professionnels de santé, profils multiples, synchronisation cloud, IA médicale, Mon espace santé.

# Definition of Done MVP

Je peux saisir mes traitements, scanner mes boîtes, suivre lots/péremptions/stocks, recevoir mon rappel hebdomadaire, préparer réellement un pilulier de 7 jours avec vérification des boîtes, valider la préparation et retrouver les lots utilisés dans l'historique, sans connexion à un serveur.

# Confidentialité locale et durcissement Android

- La base SQLite et les réglages locaux sont explicitement exclus de la sauvegarde automatique et du transfert d’appareil Android (`android.allowBackup: false`). Les caches sont privés et exclus par Android ; les fichiers intermédiaires d’export/import y sont supprimés après utilisation. Les copies de sécurité créées avant restauration sont, elles, conservées volontairement dans le dossier privé de documents de PillBox.
- Le verrou optionnel délègue l’authentification à Android via `expo-local-authentication`. PillBox ne stocke aucun PIN, mot de passe, secret ou gabarit biométrique. Ce verrou contrôle l’accès à l’interface mais ne chiffre pas SQLite ni les exports.
- Le comportement du verrou suit le cycle de vie Android et est décrit par une politique unique (`src/domain/privacy/app-lock-policy.ts`) : toute ouverture à froid exige une authentification ; un aller-retour bref vers une autre application n’en redemande pas ; au-delà de `APP_LOCK_GRACE_PERIOD_MS` (60 secondes d’absence, temporisation courante pour des données sensibles), PillBox se reverrouille. L’état n’est jamais persisté : si Android tue le processus, le lancement suivant est une ouverture à froid. Tant que le verrou est activé, le contenu est masqué dès que l’application quitte le premier plan, y compris pendant la boîte de dialogue d’authentification, laquelle ne doit jamais provoquer un second prompt.
- Les notifications ont un contenu neutre et une visibilité privée sur l’écran verrouillé. Aucun réglage de contenu détaillé n’est proposé.
- Les captures d’écran ne sont pas bloquées. `expo-screen-capture` fournit une API Expo stable, mais un blocage sur les écrans de traitements, posologies, stock et historique empêcherait des usages légitimes (montrer ponctuellement une information à un professionnel ou demander de l’aide). Le verrou au passage en arrière-plan limite l’exposition dans le sélecteur d’applications lorsque l’option est activée. Cette décision est à réévaluer si PillBox ajoute un mode confidentialité distinct et explicite.
