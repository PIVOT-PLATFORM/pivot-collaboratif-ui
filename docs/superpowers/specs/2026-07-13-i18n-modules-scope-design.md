# Spec — i18n des modules : scope Transloco embarqué par la lib

**Date :** 2026-07-13
**Statut :** Design validé — prêt pour plan d'implémentation
**Repos impactés :** `pivot-collaboratif-ui` (impl. de référence), `pivot-ui` (host shell), `pivot-docs` (ADR + enabler)
**Supersède :** [pivot-ui #188](https://github.com/PIVOT-PLATFORM/pivot-ui/pull/188) (correctif en dur — recopie de clés)

---

## 1. Contexte & problème

L'éditeur de tableau blanc, chargé dans le shell via la lib publiée
`@pivot-platform/collaboratif-ui`, affichait ses libellés en **clés i18n brutes**
(`whiteboard.board.untitled`, `whiteboard.toolbar.*`, `whiteboard.groups.*`, `whiteboard.timer.*`,
`whiteboard.voteResults.*`…).

**Cause racine.** La lib émet des clés Transloco **globales** (`'whiteboard.x' | transloco`) **sans
scope ni loader**, et le paquet npm **n'embarque aucun fichier i18n**. Transloco résout donc ces
clés contre l'**unique catalogue global** fourni par l'app hôte (`pivot-ui/public/assets/i18n/{lang}.json`).
Résultat : chaque host doit **recopier manuellement** l'arbre `whiteboard.*` complet. Lors du passage
de la lib en `0.2.0` (ajout des features groupes/timer/vote/cadres → 57 nouvelles clés), cette
recopie n'a pas suivi → clés brutes.

**Pourquoi #188 ne suffit pas.** #188 recomplète les 57 clés dans le shell : ça corrige l'instant T
mais **pérennise le couplage** (toute évolution de la lib impose une resynchronisation manuelle dans
chaque host). Le mainteneur demande une solution **pérenne et générique**, valable pour tous les
futurs modules (`pilotage`, `agilite`, …) qui n'ont pas encore d'i18n.

## 2. Objectifs / Non-objectifs

**Objectifs**

- Chaque lib UI de module est **l'unique source de vérité** de ses traductions.
- **Dérive de version structurellement impossible** : clés et valeurs voyagent avec la version de la lib.
- **Zéro configuration côté host** à l'ajout d'un nouveau module (le shell ne touche jamais l'i18n d'un module).
- Corrige le rendu de l'éditeur whiteboard (le bug signalé) **et** le harnais standalone.
- Établit une **convention formelle** (ADR + enabler + skill) reprise par tous les modules.

**Non-objectifs**

- Le bug transverse `translate()` **synchrone** du shell (`module.guard.ts` → `modules.guard.names.whiteboard`,
  `nav.theme_to_dark`, `nav.notifications`) : root cause différente (timing, pas ownership) → traité séparément.
- Les clés **propres au shell** qui parlent d'un module (ex. `modules.guard.names.whiteboard` = nom
  d'affichage dans le registre de modules) : elles restent dans le shell, c'est correct.
- Refonte du mécanisme i18n global du shell (auth, nav, home…) : inchangé.

## 3. Décision

**Approche A — traductions embarquées dans le bundle de la lib.** Chaque lib UI de module possède un
**scope Transloco** nommé d'après sa **clé de module** (`whiteboard`), embarque ses fichiers de
traduction dans son propre bundle, et **enregistre son scope** via sa fonction `provideXxxUi()` déjà
existante, au moyen d'un **`InlineLoader`** (import dynamique par langue). Les hosts ne contiennent
plus aucune traduction de module.

Alternatives écartées : **B** (assets publiés + copie/HTTP par le host — exige une config de build
par host/module, dérive encore possible) ; **C** (i18n servi par le backend module — couplage
runtime au backend pour du texte front, mauvaise séparation).

## 4. Conception détaillée

### 4.1 Nommage du scope

- Le nom du scope = la **clé de module du registre** (`whiteboard`). Une même lib peut enregistrer
  **plusieurs scopes** si elle héberge plusieurs modules (ex. si `collaboratif-ui` accueille plus tard
  `meetops`, elle enregistrera aussi le scope `meetops`).
- Convention de clés inchangée : `feature.composant.element` **sous la racine du scope**
  (ex. clé template `whiteboard.board.untitled` → fichier de scope contenant `board.untitled`).

### 4.2 Fichiers de traduction de la lib (forme = racine du scope)

- Emplacement : `projects/collaboratif-ui/src/lib/i18n/{en,fr}.json`.
- **Contenu = sous-arbre racine du scope, SANS le wrapper `whiteboard`** :

  ```json
  // src/lib/i18n/fr.json
  { "board": { "untitled": "Tableau sans titre", "reset": "…" },
    "toolbar": { "select": "…", "sticky": "…" },
    "groups": { "title": "…" }, "timer": { … }, "voteResults": { … }, … }
  ```

- Source des valeurs : le sous-arbre `whiteboard.*` du catalogue canonique actuel
  (`projects/collaboratif-ui/i18n/{fr,en}.json` @ `main`, déjà à jour pour la 0.2.0). Le wrapper
  `whiteboard` de premier niveau est **retiré** (le scope le réintroduit à la résolution).
- L'ancien `projects/collaboratif-ui/i18n/{fr,en}.json` (qui mélange `app` harnais + `whiteboard`) :
  le bloc `whiteboard` migre vers `src/lib/i18n/` ; le bloc `app` reste au service du **harnais**
  (§4.7).

### 4.3 Enregistrement du scope via `provideCollaboratifUi()`

`provide-collaboratif-ui.ts` ajoute le scope dans son `makeEnvironmentProviders` :

```ts
import { provideTranslocoScope } from '@jsverse/transloco';

export function provideCollaboratifUi(config: CollaboratifUiConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: COLLABORATIF_API_URL, useValue: config.apiUrl },
    ...(config.bearerToken ? [{ provide: COLLABORATIF_BEARER_TOKEN, useValue: config.bearerToken }] : []),
    provideTranslocoScope({
      scope: 'whiteboard',
      loader: {
        // provide-collaboratif-ui.ts est sous src/lib/core/whiteboard/config/ → 3 niveaux jusqu'à src/lib/
        en: () => import('../../../i18n/en.json'),
        fr: () => import('../../../i18n/fr.json'),
      },
    }),
  ]);
}
```

- `provideCollaboratifUi()` est **déjà** appelé au chargement de la route du module par le shell
  (`whiteboard-module-loader.ts`) **et** par le harnais standalone → le scope est disponible partout
  où la lib tourne, sans action du host.
- `provideTranslocoScope` est fourni au niveau de l'**injecteur d'environnement** de la route lazy :
  Transloco charge le fichier de scope `whiteboard` à l'entrée du module.

### 4.4 Empaquetage : import JSON dans le bundle

- Activer `resolveJsonModule` (et `esModuleInterop` si besoin) dans `tsconfig` de la lib pour permettre
  l'`import()` de `.json`.
- Les `import('../../../i18n/{lang}.json')` produisent des **chunks lazy par langue**, compilés **dans**
  le paquet npm par `ng-packagr` (FESM) — donc versionnés avec la lib. **Aucun asset externe, aucune
  config de host.**
- Vérifier que `ng-packagr` inclut bien les JSON importés dans les FESM (import statique de module
  JSON, pas un asset copié) ; à défaut, replier sur des modules `.ts` exportant l'objet de traduction
  (même contrat d'`InlineLoader`).

### 4.5 Référencement des clés dans les templates

- **Décision par défaut : conserver les clés pleines** `'whiteboard.x' | transloco`. En Transloco v8,
  un scope `whiteboard` fourni dans l'injecteur charge ses traductions sous le namespace `whiteboard`,
  et les clés `whiteboard.*` résolvent contre le fichier de scope de la lib.
- **Validation obligatoire à l'implémentation** (test de rendu) : si la résolution par clé pleine ne
  se déclenche pas de façon fiable (selon le mode de résolution du pipe global vs scope injecté),
  **basculer vers la forme scope-relative** via le structural directive :
  `*transloco="let t; scope: 'whiteboard'"` puis `t('board.untitled')`. Ce repli est mécanique et
  local aux templates de la lib. Le fichier de scope reste identique (racine du scope) dans les deux cas.

### 4.6 Retrait des clés côté shell (`pivot-ui`) — supersède #188

- Supprimer **tout le sous-arbre `whiteboard`** de `pivot-ui/public/assets/i18n/{fr,en}.json`
  (les clés que #188 ajoutait **et** celles pré-existantes) : elles proviennent désormais du scope de
  la lib. Le catalogue global du shell ne conserve que ses clés propres (`modules.*`, `nav.*`, `auth.*`…).
- **Fermer #188** (obsolète) au profit de cette PR.

### 4.7 Harnais standalone de la lib (`pivot-collaboratif-ui`, `:8090`)

- Le harnais (`src/app/app.config.ts`) fournit `provideCollaboratifUi(...)` (ou appelle directement
  `provideTranslocoScope('whiteboard', …)`) → il obtient le scope **gratuitement**.
- Le catalogue global du harnais (`public/assets/i18n/{lang}.json`) ne garde que les clés `app.*`
  (titre/notice du harnais). Le bloc `whiteboard` y est **retiré** (plus de doublon).

## 5. Garde-fous CI & tests

- **Test host anti-régression (`pivot-ui`)** : assertion qu'**aucune** clé de namespace module
  (`whiteboard`, `pilotage`, `agilite`, …) n'existe dans le catalogue global du shell — empêche la
  réintroduction du couplage.
- **Test lib** : parité `fr`/`en` du fichier de scope (mêmes clés) + résolution d'un échantillon
  représentatif de clés via le scope (0 clé brute) — dont `whiteboard.board.untitled`,
  `whiteboard.toolbar.select`, `whiteboard.voteResults.title`.
- **Test de rendu (lib)** : monter le composant éditeur avec le scope fourni ; asserter qu'aucun
  texte visible ni `aria-label` ne correspond au motif `^whiteboard\.` — verrouille le §4.5.
- **E2E (optionnel, shell)** : ouvrir un board, asserter l'absence de clé brute dans l'éditeur.

## 6. Livrables

1. **`pivot-collaboratif-ui`** (PR `feat/i18n-module-scope`) : fichiers `src/lib/i18n/{en,fr}.json`
   (racine de scope), `provideTranslocoScope` dans `provideCollaboratifUi`, `resolveJsonModule`,
   nettoyage du JSON harnais, tests lib + rendu, mise à jour `README`/skill i18n de la lib.
2. **`pivot-ui`** (PR dédiée) : retrait du sous-arbre `whiteboard` des catalogues globaux, test
   anti-régression, fermeture de #188.
3. **`pivot-docs`** (PR dédiée) : **ADR-029 « i18n des modules — scope Transloco embarqué par lib »**
   + **enabler backlog** (transverse, rattaché à E03 Système de modules) actant la convention pour
   tous les modules ; mise à jour de la skill `pivot-i18n-frontend` (les libs de module ownent leur
   scope ; les hosts ne recopient jamais).

> Isolation par repo respectée : **une branche + une PR par repo** (jamais de commit cross-repo).

## 7. Rollout multi-module & rapport à #188

- **collaboratif = implémentation de référence.** `pilotage` / `agilite` adopteront le même patron
  quand ils gagneront une UI — **aucune modification du shell requise** à ce moment-là (leurs
  `providePilotageUi` / `provideAgiliteUi` enregistreront leur propre scope).
- **#188 fermée** : on ne complète plus les clés côté shell, on les **retire** et on les déplace dans
  la lib.

## 8. Risques & mitigations

| Risque | Mitigation |
|--------|-----------|
| `ng-packagr` n'inline pas les `import('*.json')` dans les FESM | Repli sur modules `.ts` exportant l'objet de traduction (même `InlineLoader`) — validé par un test de résolution après build de la lib |
| Résolution par clé pleine `whiteboard.*` non déclenchée par le pipe global | Repli scope-relatif via `*transloco` (§4.5), verrouillé par le test de rendu |
| Double définition transitoire (shell **et** lib fournissent `whiteboard.*`) pendant le rollout | Ordre de merge : d'abord la lib publie une version avec scope, puis le shell retire ses clés et bump la lib ; le test anti-régression garde l'état final |
| Le paquet publié doit être **rebuild + republié** pour que le shell en profite | Passe par le `release.yml` de la lib (versioning sémantique) ; le shell bump la dépendance |

## 9. Definition of Done

- [ ] La lib `@pivot-platform/collaboratif-ui` enregistre le scope `whiteboard` et embarque ses
      traductions (fr/en) dans son bundle.
- [ ] `provideCollaboratifUi()` fournit le scope ; shell **et** harnais résolvent les clés sans recopie.
- [ ] `pivot-ui` ne contient **plus aucune** clé `whiteboard.*` ; test anti-régression vert.
- [ ] Éditeur whiteboard rendu **sans clé brute** (shell + standalone) — vérifié par test de rendu.
- [ ] ADR-029 + enabler + skill i18n mis à jour dans `pivot-docs`.
- [ ] #188 fermée.
- [ ] CI verte sur les 3 repos (tsc/lint/test/build selon chaque `CLAUDE.md`).
