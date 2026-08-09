# Identification locale d'une présentation depuis un DataMatrix

## Règle autorisée

L'identification part du GTIN brut de l'AI GS1 `01`. Une seule normalisation est autorisée :

1. la valeur contient exactement 14 chiffres ;
2. sa clé de contrôle GTIN est valide ;
3. le premier chiffre est `0` ;
4. les 13 chiffres restants forment le candidat CIP13 ;
5. ce candidat doit correspondre exactement à une présentation du snapshot BDPM local.

Si une condition échoue, l'application affiche « médicament non identifié ». Elle ne retire aucun autre préfixe, ne corrige aucun chiffre et ne fait aucune recherche approximative. Le GTIN et le RAW du scan restent affichés sans modification.

## Observations réelles validées pendant le spike

Trois boîtes scannées sur Android ont donné les correspondances imprimées suivantes :

| GTIN-14 de l'AI 01 | CIP13 imprimé et retrouvé exactement |
| --- | --- |
| `03400930227886` | `3400930227886` |
| `03400930219393` | `3400930219393` |
| `03400930252512` | `3400930252512` |

Ces exemples démontrent uniquement le cas de l'indicateur initial `0`. Ils ne justifient aucune règle pour un GTIN-14 commençant par un autre chiffre. Les chaînes RAW complètes, incluant leurs séparateurs GS et leurs AI dans des ordres différents, sont conservées dans les tests de non-régression du parseur et de la normalisation.

## Résolution

La transformation pure et testée se trouve dans `src/domain/medications/normalize-scanned-identifier.ts`. La résolution SQLite se fait ensuite par `WHERE p.cip13 = ?` dans le référentiel national embarqué. Il n'y a ni accès réseau, ni modification du référentiel, ni écriture dans la base personnelle.
