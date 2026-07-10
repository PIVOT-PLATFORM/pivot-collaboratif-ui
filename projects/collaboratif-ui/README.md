# @pivot-platform/collaboratif-ui

Bibliothèque Angular publiée du module Collaboratif (whiteboard, et features à venir : quiz,
session live, formulaire) — consommée en lazy-loading par le shell `pivot-ui`. Voir la racine du
repo (`CLAUDE.md`) pour l'architecture complète ; ce fichier ne documente que la politique de
version du package.

## Version figée à `0.1.0` — c'est voulu

`package.json` de ce package est resté à `0.1.0` depuis le commit qui l'a fixé (#36).
`publish-collaboratif-ui.yml` se déclenche sur **chaque** push sur `main` (et sur les tags
`v*.*.*`), indépendamment du trailer `Release-Trigger: true` qu'utilise `release.yml` pour
l'application — il n'y a donc aujourd'hui aucun mécanisme de bump automatique de version pour ce
package à chaque merge de sprint.

L'étape de publication est **idempotente** : elle vérifie si la version courante existe déjà sur
le registre (`npm view @pivot-platform/collaboratif-ui@<version>`) et, si oui, saute la
publication au lieu d'échouer (`npm publish` refuserait sinon d'écraser une version déjà
publiée). Republier la même version `0.1.0` à chaque merge est donc un no-op sûr — ce n'est pas un
bug, c'est le comportement attendu tant que la version n'est pas bumpée manuellement.

**Ne pas construire de mécanisme de bump automatique pour corriger ceci** — c'est une décision
d'architecture à trancher avec le mainteneur (alignement possible avec `release.yml` /
Semantic Release), hors scope d'un correctif rapide.

### Quand bumper manuellement

Bumper `version` dans ce `package.json` (et laisser `publish-collaboratif-ui.yml` publier la
nouvelle version normalement) quand la **surface d'API publique** du package change d'une façon
que les consommateurs doivent effectivement récupérer, par exemple :

- Ajout/suppression/changement de signature d'un export de `src/public-api.ts`
  (`provideCollaboratifUi`, `COLLABORATIF_API_URL`, `COLLABORATIF_ROUTES`, …)
- Changement de contrat de configuration (`CollaboratifUiConfig`) consommé par `pivot-ui`
- Changement breaking dans les routes exposées (`COLLABORATIF_ROUTES`)

Un ajout de feature interne (nouveau composant/service non exporté, correctif de bug interne au
module) n'exige pas de bump — ces changements sont invisibles pour les consommateurs du package
tant que `public-api.ts` ne change pas.
