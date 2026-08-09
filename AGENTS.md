# Rôle de l'agent

Construire une application personnelle fiable conformément à PROJECT.md. La priorité est le fonctionnement réel, pas l'expérimentation technique ni l'ajout de fonctionnalités.

# Règles obligatoires

1. Lire `PROJECT.md` et ce fichier avant chaque ticket important.
2. Implémenter uniquement le ticket demandé. Ne pas anticiper les suivants.
3. TypeScript strict. Éviter `any` ; toute exception doit être justifiée.
4. Séparer logique métier, UI et infrastructure.
5. Toute règle métier critique doit avoir des tests.
6. Ne pas installer une dépendance lorsqu'une solution simple et maintenable suffit.
7. Ne jamais inférer une posologie.
8. Ne jamais inventer une règle pharmaceutique, une correspondance médicament ou une donnée absente.
9. Si une donnée pharmaceutique est incertaine : conserver la donnée brute, documenter l'incertitude et demander validation.
10. Aucun backend, authentification, analytics, publicité ou transmission de données personnelles sauf nouveau ticket explicite.
11. SQLite local est la source de vérité des données utilisateur.
12. Les opérations de validation de préparation et de stock doivent être transactionnelles et idempotentes lorsque nécessaire.
13. Préférer une architecture simple à une abstraction prématurée.
14. Ne pas introduire Redux sans besoin démontré.
15. Les changements doivent rester petits, cohérents et faciles à relire/revenir en arrière.

# Avant de terminer un ticket

Exécuter les commandes disponibles pour : lint, typecheck et tests. Corriger les erreurs liées au changement.

Fournir ensuite un compte rendu court : fichiers importants modifiés, comportement ajouté, tests effectués, hypothèses/incertitudes restantes et manipulations à tester sur téléphone.

# Sécurité produit

En cas de conflit entre automatisation et fiabilité, choisir la fiabilité. **Si l'application ne sait pas, elle ne devine pas.**

## Git

- Ne jamais créer de commit, pousser une branche ou ouvrir une pull request.
- Laisser toutes les modifications non commitées afin que je puisse les relire.
- Je réalise moi-même les commits et les pushs, même lorsque la tâche semble terminée.