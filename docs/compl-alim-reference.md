# Référentiel local Compl’Alim

Le fichier `assets/medications/compl-alim.db` provient des [déclarations officielles de compléments alimentaires](https://www.data.gouv.fr/datasets/declarations-de-complements-alimentaires), sous Licence Ouverte 2.0. Il a été généré le 26 septembre 2026 à partir du CSV `declarations.csv?v=20260917` publié par Compl’Alim. Le CSV source n'est pas embarqué dans l'application.

Seules les déclarations dont la décision est exactement `Commercialisation possible` sont incluses. Les déclarations retirées sont exclues. Les identifiants répétés avec les mêmes nom, marque, forme, opérateur et gamme sont dédoublonnés ; des valeurs contradictoires font échouer l'import. Le résultat contient 130 797 identifiants. L’identifiant, le nom commercial, la marque, la forme, l’opérateur responsable de mise sur le marché et la gamme sont conservés, avec des champs de recherche normalisés et un index FTS. La dose journalière et le mode d'emploi ne sont ni importés ni utilisés pour suggérer une posologie.

Pour régénérer la base après téléchargement du CSV officiel :

```sh
python3 scripts/medications/import-compl-alim.py declarations.csv assets/medications/compl-alim.db
```

Le fichier est un instantané hors ligne : une déclaration peut changer après sa génération. Compl’Alim identifie une déclaration, sans certifier le contenu d'une boîte détenue. Les boîtes de compléments sont donc ajoutées au stock manuellement, avec lot et péremption saisis par l'utilisatrice. Aucune correspondance pharmaceutique ou identité par scan n'est déduite.

## Identification et recherche (ticket 114)

Le snapshot a été enrichi depuis le même CSV officiel `declarations.csv?v=20260917`. Les 130 797 identifiants et leurs nom, marque et forme ont été comparés à la version précédente : tous sont identiques. Le champ `responsable_mise_sur_marche` est affiché comme opérateur, jamais comme une marque de remplacement ; `gamme` est consultable dans les détails. Aucun champ de dosage produit ni de conditionnement n’existe dans ce CSV : ces informations sont signalées comme indisponibles. La dose journalière n’est pas un dosage produit et reste exclue.

La recherche normalise casse, accents et espaces, recherche tous les mots (nom, marque, forme, opérateur, gamme) et place les noms exacts avant les correspondances plus larges. Le filtre par forme s’applique à tous les résultats correspondants avant la limite de 30 ; il ne filtre pas les médicaments BDPM. Le nom seul, même associé à la forme, ne fusionne jamais des références. La requête retourne une seule ligne canonique par identifiant, même si l’index répète une référence. Les détails précèdent la sélection et la création transmet toujours l’identifiant externe exact et la provenance COMPL_ALIM. Le référentiel reste entièrement local ; les données utilisateur SQLite ne sont pas migrées.
