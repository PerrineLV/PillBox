# Référentiel local Compl’Alim

Le fichier `assets/medications/compl-alim.db` provient des [déclarations officielles de compléments alimentaires](https://www.data.gouv.fr/datasets/declarations-de-complements-alimentaires), sous Licence Ouverte 2.0. Il a été généré le 26 septembre 2026 à partir du CSV `declarations.csv?v=20260917` publié par Compl’Alim. Le CSV source n'est pas embarqué dans l'application.

Seules les déclarations dont la décision est exactement `Commercialisation possible` sont incluses. Les déclarations retirées sont exclues. Les identifiants répétés avec les mêmes nom, marque et forme sont dédoublonnés ; des valeurs contradictoires font échouer l'import. Le résultat contient 130 797 identifiants. Seuls l'identifiant, le nom commercial, la marque et la forme sont conservés, avec un index de recherche FTS. La dose journalière et le mode d'emploi ne sont ni importés ni utilisés pour suggérer une posologie.

Pour régénérer la base après téléchargement du CSV officiel :

```sh
python3 scripts/medications/import-compl-alim.py declarations.csv assets/medications/compl-alim.db
```

Le fichier est un instantané hors ligne : une déclaration peut changer après sa génération. Compl’Alim identifie une déclaration, sans certifier le contenu d'une boîte détenue. Les boîtes de compléments sont donc ajoutées au stock manuellement, avec lot et péremption saisis par l'utilisatrice. Aucune correspondance pharmaceutique ou identité par scan n'est déduite.
