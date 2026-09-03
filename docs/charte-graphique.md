# Charte graphique PillBox

Ce document mémorise les choix de marque et d'interface validés. Tout élément qui n'y figure pas reste à définir et ne doit pas être déduit automatiquement.

## Couleurs de marque

Ces trois couleurs appartiennent aux **assets de marque** — logo, icône d'application, icône adaptative Android. Elles sont distinctes de la palette d'interface décrite plus bas, qui ne les reprend pas.

| Couleur | Valeur | Usage validé |
| --- | --- | --- |
| Turquoise profond | `#0F6F70` | Symbole principal |
| Corail | `#FF6B57` | Partie supérieure de la gélule |
| Menthe très pâle | `#F4FAF7` | Fond de l'icône et de l'adaptive icon |

Ne pas introduire d'autre couleur dans les assets de marque sans validation explicite.

## Logo et icônes d'application

- La source éditable de référence est [`assets/branding/pillbox-logo.svg`](../assets/branding/pillbox-logo.svg).
- Le symbole doit conserver ses proportions : ne pas l'étirer ni le recadrer.
- `assets/branding/pillbox-icon.png` est l'icône principale Expo en 1024 × 1024.
- `assets/branding/pillbox-adaptive-icon.png` est le premier plan transparent de l'adaptive icon Android en 1024 × 1024. Sa marge centrale doit être conservée pour résister aux différents masques des launchers.
- Le fond de l'adaptive icon Android est `#F4FAF7`, configuré séparément dans `app.json`.

## Interface

L'interface suit un système de jetons unique. **`src/ui/theme.ts` en est la seule source** : aucun écran ne déclare une couleur, une taille de texte ou un rayon en dur. Un besoin non couvert par un jeton se règle en ajoutant le jeton, jamais en écrivant la valeur sur place.

### Palette d'interface

Trois rampes, exposées par `palette`, et une couche de rôles exposée par `colors`. Les écrans passent par les rôles ; la rampe brute ne sert qu'aux surfaces sans rôle stable, comme les cases du pilulier.

| Rampe | Rôle |
| --- | --- |
| Vert | Couleur d'action et d'état positif. `#376B5B` porte les actions, `#17332B` les en-têtes sombres. |
| Corail | Accent et actions destructives. Jamais utilisé pour signaler une urgence médicale. |
| Neutre chaud | Fonds crème, surfaces, bordures et texte. |

Deux échelles dérivées complètent l'ensemble : `severity`, commune aux alertes, au stock et aux renouvellements, et `onDarkSurfaces`, jeu de voiles translucides posés sur les en-têtes sombres.

L'interface est **claire uniquement**. Aucun thème sombre n'existe, et le thème natif Android est explicitement fixé en clair par `plugins/withAndroidLightTheme.js` pour que les boîtes de dialogue système — sélecteurs de date et d'heure en particulier — ne basculent pas en sombre au milieu d'une application crème.

### Typographie

Une seule famille : la police système. Aucune police d'affichage n'est embarquée, faute d'en avoir trouvé une qui couvre correctement les caractères pharmaceutiques (`µ`, `½`). L'échelle est fixée par `typography` : `hero`, `screenTitle`, `stackTitle`, `cardTitle`, `itemTitle`, `sectionLabel`, `detail`, `micro`, `numeric`, `buttonLabel`.

### Structure d'un écran

`AppScreen` du kit (`src/ui/kit.tsx`) porte la structure commune : marge de sécurité haute colorée par l'en-tête de l'écran, corps défilant, pied fixe ou action flottante. Un écran ne pose jamais sa propre marge de sécurité.

Au niveau du corps, il ne doit rester que des `<Section>`, des cartes autonomes et des bandeaux. Une étiquette de section vit toujours dans la même `<Section>` que le contenu qu'elle annonce.

Deux types d'en-tête : `TabHeader` pour les quatre onglets, `StackHeader` pour les écrans empilés. L'accueil, la préparation et le scan portent en plus un en-tête vert profond, qui signale l'action du moment.

### Icônes

`src/ui/icons.tsx` dessine les icônes en vues natives. PillBox n'embarque **aucune bibliothèque d'icônes ni SVG** : ces formes simples suffisent, restent lisibles entre 16 et 22 px et ne coûtent aucune dépendance. Toutes les icônes sont décoratives ; l'élément qui les porte fournit toujours son propre libellé accessible.

### Retours après une action

Une écriture sans écran de confirmation produit un toast, assorti d'un bouton **Annuler** lorsque le geste est réversible. Le toast est une bande sombre en bas de l'écran : sa tonalité se lit à son icône, jamais à son fond.

Une erreur de chargement reste un `Message` posé dans l'écran, jamais un toast : une information qu'on ne peut plus retrouver ne doit pas s'effacer toute seule.

### Contraste

`src/ui/__tests__/theme.test.ts` vérifie le contraste AA de chaque paire texte/fond de la palette, de l'échelle de gravité, des en-têtes sombres et des tonalités de toast. Toute nouvelle couleur de texte ou d'icône doit y être ajoutée.

## Éléments non définis

Les variantes du logo, le splash screen, les usages de la marque sur d'autres fonds et un éventuel thème sombre ne font pas partie de la charte validée.
