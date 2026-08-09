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

**Traitement** : spécialité + phases successives de posologie structurée + actif/inactif + inclusion dans le pilulier.

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

Rappels de prise, conseils médicaux, interactions, diagnostic, lecture automatique d'ordonnance, professionnels de santé, profils multiples, synchronisation cloud, IA médicale, Mon espace santé.

# Definition of Done MVP

Je peux saisir mes traitements, scanner mes boîtes, suivre lots/péremptions/stocks, recevoir mon rappel hebdomadaire, préparer réellement un pilulier de 7 jours avec vérification des boîtes, valider la préparation et retrouver les lots utilisés dans l'historique, sans connexion à un serveur.
