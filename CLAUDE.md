# CLAUDE.md — PIVOT-COLLABORATIF-UI

## Projet

**PIVOT-COLLABORATIF-UI** — frontend Angular du domaine **Collaboratif** de la suite PIVOT :
whiteboard collaboratif temps réel, quiz interactif, session live (facilitation d'atelier),
formulaire. Repo module dédié — voir backlog `pivot-docs/docs/backlog/EPIC-collaboration/README.md`
(EPIC **E30**, dont le noyau whiteboard F08.x/EN08.x garde sa propre `Phase: Socle`).

**Statut actuel : bootstrap.** Ce repo ne contient qu'un shell Angular minimal (build, CI/CD,
sécurité) — **aucune feature métier n'est implémentée**. Une fois développé, ce module sera
lazy-loadé depuis le shell **pivot-ui** (`loadChildren`), jamais servi comme application
autonome en production.

Backend associé : **pivot-collaboratif-core** (Java/Spring Boot, port 8083, schéma `collaboratif`).
Shell frontend (header/footer, OIDC, portail) : **pivot-ui**. Documentation générale et backlog :
**pivot-docs**.

### Dépendances plateforme — état réel (lire avant toute implémentation)

Ni `@pivot-platform/ui-core` ni `@pivot/design-system` ne sont aujourd'hui des artefacts npm
publiés et consommables :

- **`@pivot-platform/ui-core`** (scope réel confirmé — **pas** `@pivot-platform/ui-core`) : `pivot-ui`
  tente de publier ce package via `publish-ui-core.yml` sur GitHub Packages (registry
  `npm.pkg.github.com`). Deux tentatives ont échoué (EN17.3) : `npm ci` dans le workflow plante
  sur `git --no-replace-objects ls-remote ssh://git@github.com/dist/ui-core.git` (clé SSH
  absente du runner). **Le package `@pivot-platform/ui-core` n'existe pas encore** — `npm
  install @pivot-platform/ui-core@latest` retourne 404. Un `.npmrc` est déjà présent dans ce
  repo pour préparer l'authentification dès que le package sera publié. Statut : bloqué EN17.3.
- **`@pivot/design-system`** : repo `pivot-design-system` **pas encore créé** (stack actée par
  `ADR-007` : Angular CDK + SCSS BEM custom, aucune lib visuelle tierce — mais le repo lui-même
  est différé). `pivot-ui` gère ses styles en interne (`src/styles/`) en attendant.

Conséquences concrètes tant que ces gaps ne sont pas comblés :
- **Pas d'auth** dans ce repo — aucun `AuthService`, `AuthInterceptor`, `AuthGuard` (viendraient
  de `@pivot-platform/ui-core`). Aucune route protégée tant que ce contrat n'est pas consommable.
- **Pas de composants de design system** — ce squelette utilise un reset CSS minimal
  auto-contenu (`src/styles/reset.scss`), pas les tokens de `@pivot/design-system`.
- **Pas de `ModuleGuard`/`ModuleStatusService`** (contrat de `@pivot-platform/ui-core/modules`) —
  `whiteboardModuleGuard` est implémenté comme stub `of(true)` (EN08.2) en attendant la
  publication réelle. TODO : remplacer par `moduleGuard('whiteboard')` de
  `@pivot-platform/ui-core` dès que EN17.3 sera résolu.

**Ne jamais ajouter `@pivot-platform/ui-core` ou `@pivot/design-system` avec une version devinée
dans `package.json`.** Vérifier l'état de publication avant toute tentative (voir `.npmrc` pour
la config registry), et signaler au mainteneur si une US suppose ces dépendances disponibles
alors qu'elles ne le sont pas.

---

## Communication

Concise et directe. Techniquement précise. Pas de récapitulatifs inutiles.

**Exceptions (réponses complètes et structurées) :**
- Rédaction ou revue d'US / Epics
- Décisions d'architecture (routing, state management, intégration STOMP)
- Avis cybersécurité ou actions irréversibles — **confirmation obligatoire**
- Backlog et critères d'acceptation

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Angular 22 · TypeScript strict |
| Styles | SCSS · reset minimal — **pas** de tokens propres (attend `@pivot/design-system`) |
| HTTP | Angular HttpClient · RxJS |
| State | Signals Angular |
| Auth | **Différée** — dépend de `@pivot-platform/ui-core` (voir section dédiée ci-dessus). Aucun guard/intercepteur dans ce squelette. |
| Temps réel | WebSocket STOMP — `@stomp/rx-stomp` ajouté au `package.json` au bootstrap (dépendance présente), **aucun client STOMP implémenté** — à construire avec la première US qui l'exige (`EN08.1`) |
| Tests unitaires | Vitest |
| Tests E2E | Playwright (Chromium) |
| i18n | Transloco — FR par défaut, EN. Deux clés placeholder (`app.title`, `app.bootstrapNotice`) |
| Build | Angular CLI · esbuild |
| CI/CD | GitHub Actions · SonarCloud (à finaliser côté secrets, voir `TODO-SETUP.md`) · Semantic Release · Plumber |
| Déploiement | Docker (nginx) |
| Backend | → **pivot-collaboratif-core** (Java 25 · Spring Boot 4.x · port 8083) |

---

## Structure du dépôt

```
pivot-collaboratif-ui/
├── src/
│   ├── app/
│   │   ├── core/i18n/         # TranslocoHttpLoader (seule brique core existante)
│   │   ├── app.ts              # Composant racine — placeholder, aucune feature
│   │   ├── app.config.ts
│   │   └── app.routes.ts       # routes: [] — vide tant qu'aucune US n'est implémentée
│   ├── environments/
│   └── styles/                 # Reset minimal auto-contenu
├── public/assets/i18n/          # fr.json / en.json
├── e2e/                         # Playwright — un seul smoke test ("app loads")
├── .github/
│   └── workflows/
├── .plumber.yaml
├── TODO-SETUP.md                # Setup manuel restant (SonarCloud, secrets, ruleset stricte)
└── Dockerfile                   # nginx production
```

**Features métier (whiteboard, quiz, session live, formulaire) → à construire ici au fil des
US**, jamais dans `pivot-ui` (shell). WebSocket STOMP (`@stomp/rx-stomp`) → dans ce repo (module
qui en a besoin), pas dans `pivot-ui`.

Backend API → **pivot-collaboratif-core** (repo séparé, port 8083). Design system →
**pivot-design-system** (`@pivot/design-system`, repo pas encore créé).

---

## Équipe experte

Toute contribution mobilise les experts concernés — les mentionner explicitement dans la réponse.

| Expert | Domaine |
|--------|---------|
| **Architecte Angular** | Architecture Angular, modules lazy-loaded, RxJS, Signals, OnPush |
| **Architecte Temps Réel / WebSocket** | `@stomp/rx-stomp`, isolation par room/board, reconnection, présence |
| **Expert UX/UI** | Composants Angular, accessibilité WCAG 2.1 AA — en attendant `@pivot/design-system` |
| **Expert DevSecOps** | CI/CD GitHub Actions, SonarCloud, Semgrep, Gitleaks, Plumber, SBOM |
| **Expert Red Team** | XSS, injection via messages WebSocket, exposition de données |
| **Expert Blue Team** | CSP, SRI, headers sécurité nginx, réponse aux rapports Red Team |
| **Expert OIDC / IAM** | Consommation du contrat `@pivot-platform/ui-core` une fois publié |
| **Expert QA** | Stratégie Vitest/Playwright, coverage ≥ 85 %, A11y tests |
| **Expert RGPD** | Contenu utilisateur sur les boards/formulaires, stockage navigateur |
| **Product Owner** | Backlog markdown pivot-docs (EPIC E30), critères d'acceptation, priorisation |
| **Scrum Master** | Coordination, sprints, impediments, backlog consistency |
| **Architecte Modules** | Intégration `ModuleGuard`/lazy-loading une fois `@pivot-platform/ui-core` consommable |
| **Expert PR Review** | Relecture croisée neutre : cohérence architecture, lisibilité, dette technique |
| **Experts Java / Backend** | → **pivot-collaboratif-core** |

### Faire appel aux experts

| Type de tâche | Expert(s) |
|---------------|-----------|
| Composant Angular, SCSS, routing | **Architecte Angular** + **Expert UX/UI** |
| WebSocket STOMP, temps réel, présence | **Architecte Temps Réel / WebSocket** |
| Design system, tokens CSS, A11y | **Expert UX/UI** |
| Consommation `@pivot-platform/ui-core` (auth, guards) | **Expert OIDC / IAM** + **Expert Blue Team** |
| Tests Vitest, Playwright, coverage | **Expert QA** |
| CI/CD, GitHub Actions, Plumber | **Expert DevSecOps** |
| Vulnérabilité sécurité frontend | **Expert Red Team** → **Expert Blue Team** |
| RGPD, cookies, stockage navigateur | **Expert RGPD** |
| Backlog, US, acceptance criteria | **Product Owner** |
| Module activation, route guards | **Architecte Modules** |
| Bug inexpliqué | **Architecte Angular** en premier, puis **Expert Red Team** si suspicion sécurité |
| API REST, backend Java | → **pivot-collaboratif-core** |

**Règles :**
- Mentionner l'expert explicitement quand son domaine est engagé.
- Toute faille Red Team = correction Blue Team **avant** tout merge.
- Ajout d'une dépendance `@pivot-platform/ui-core` ou `@pivot/design-system` = coordination avec
  `pivot-ui` obligatoire (vérifier l'état de publication réel avant).

---

## Backlog — fichiers markdown

> **Sources de vérité :**
> - Hiérarchie backlog + conventions : `pivot-docs/docs/backlog/README.md`
> - Sprints, assignation US, état avancement : **`pivot-docs/docs/backlog/sprints/`**
> - Backlog opérationnel : `pivot-docs/docs/backlog/EPIC-collaboration/` — EPIC **E30**, noyau
>   whiteboard **F08.x/EN08.x** (`Phase: Socle`, non verrouillé)

### Hiérarchie
`EPIC → FEATURE (valeur) / ENABLER (technique) → US` · clé `E30 → F30.x / EN30.x → US30.x.y`
(noyau whiteboard : `F08.x / EN08.x → US08.x.y`).

### Champs du Project

| Champ | Valeurs |
|-------|---------|
| Item Type | Epic / Feature / Enabler / US |
| Parent | clé du parent (ex. `E30`, `F30.1`) |
| Stage | ⬜ (pas encore terminé) / ✅ (Done — recette mainteneur). États intermédiaires internes, non persistés → pivot-docs/docs/backlog/README.md §2/§5 |
| Priority | Critical / High / Medium / Low |
| Module | `collaboratif` |
| Phase | Socle / v1-enterprise / phase-3 |
| Sprint | Sprint 1…N |
| Size | XS / S / M / L / XL |

### Template US, Definition of Ready, vagues → `pivot-docs/docs/backlog/README.md`.

---

## Breaking Points

### Step 0 — Challenge PO avant implémentation

Avant tout code, le **PO Agent** challenge les ACs de l'US :

1. Vérifier DoR — story complète, ACs Given/When/Then, AC erreur + sécurité
2. Calculer Gate 1 : **= 100** → procéder · **< 100** → PO Agent réécrit ACs → recalculer
3. AC ambigus à l'implémentation → PO Agent clarifie, jamais d'interprétation unilatérale
4. **AC supposant `@pivot-platform/ui-core`/`@pivot/design-system` disponibles alors qu'ils ne le sont
   pas** → bloquant, signaler au mainteneur avant tout Gate 1

Pas de blocage humain — Claude autonome de A à Z sur la validation des ACs (hors point 4).

### Breaking Point 2 : Gate 4 MERGE < 60 ou hard block

Tout PR avec :
- Label `security` ou `breaking-change`
- Gitleaks secret détecté
- Modification du contrat de module sans coordination pivot-ui
- Ajout d'une dépendance `@pivot-platform/ui-core`/`@pivot/design-system` avec version fictive

→ Label `needs-human-review` + score breakdown + attendre le mainteneur.

---

## Workflow — Organisation par sprint

Travail organisé par sprint. Référence : **`pivot-docs/docs/backlog/sprints/`**.

**Principes :**
- **Une branche par US / Enabler** — `feat/{us-id}-{slug}`
- **Agents en parallèle** — un agent par item du sprint, branches séparées
- **Backlog pivot-docs** — mises à jour `sprints/sprint-{N}.md` (états internes) + `Stage` uniquement aux deux moments où il change réellement (création → `⬜`, recette mainteneur → `✅`), committés sur la branche de l'US
- **Issue GitHub liée** — avant de démarrer un item, vérifier qu'une issue existe dans **ce repo** pour cet US/Enabler (recherche par id/titre). Absente → la créer (titre `{id} — {titre US}`, corps = lien vers le fichier backlog pivot-docs + AC). **Déjà assignée** (humain ou agent en cours) → item déjà pris, ne pas démarrer, passer au suivant. Sinon → se l'auto-assigner immédiatement (`gh issue edit {N} --add-assignee @me`) avant le premier commit — verrouille l'item, empêche qu'un autre agent ou une autre personne ne le reprenne en parallèle. Référencer l'issue dans la PR (`Closes #N`) — fermeture automatique à la fusion, jamais de fermeture manuelle en double.

## Workflow — Merge séquentiel autonome (plusieurs PR)

Quand plusieurs PR sont ouvertes/en attente sur ce repo (ex. plusieurs items d'un même sprint),
Claude détermine seul l'ordre de fusion et l'exécute de bout en bout, sans confirmation par PR :

1. **Ordre** — dépendances fonctionnelles entre items d'abord, puis fichiers partagés
   (i18n `en.json`/`fr.json`, config CI commune) pour minimiser les rebases en cascade.
2. **Par PR, dans cet ordre :**
   - Rebase sur `main` à jour (jamais de merge commit)
   - Conflit → résolution manuelle réelle (jamais `--theirs`/`--ours` aveugle) : lire les deux
     côtés, comprendre l'intention de chacun, fusionner le contenu
   - Rebase sans conflit mais fichier partagé (ex. `en.json`) → vérifier quand même qu'aucune
     clé n'a été silencieusement écrasée par l'auto-merge git
   - `npx tsc --noEmit` + `npm run lint` + `npm run test:ci` + build prod locaux avant push
   - Push, attendre la CI réelle en boucle synchrone (jamais d'attente passive d'une notification)
   - Gate 4 selon les seuils déjà définis ci-dessous → squash-merge dès convergence
3. **Dernier item du sprint courant** (vérifier `pivot-docs/docs/backlog/sprints/sprint-{N}.md`)
   → le commit de squash-merge porte le marqueur de release (voir *Workflow — Release*
   ci-dessous), tous les autres non.
4. Incident CI rencontré en cours de route → diagnostiquer et corriger avant de continuer la
   séquence, pas de contournement silencieux.

## Workflow — Release

Le déclenchement d'une release (`release.yml` : version, publish npm/Docker, tag, changelog)
n'a lieu **qu'en fin de sprint**, jamais à chaque merge — un merge ordinaire ne doit ni bumper de
version ni publier quoi que ce soit.

- **Déclencheur** : le commit du squash-merge du **dernier item d'un sprint** porte le trailer
  `Release-Trigger: true` **sur sa propre ligne, seul, rien d'autre** (`grep -qxE` — match exact
  de ligne entière, jamais une simple sous-chaîne — cf. incident réel documenté sur
  `pivot-core/CLAUDE.md` et `pivot-ui/CLAUDE.md`, section Workflow — Release).
- **Pourquoi** : sans cette règle, chaque merge déclenche `release.yml` — plusieurs merges
  rapprochés calculeraient tous la même "prochaine version" (aucun tag encore créé entre eux) et
  le second à publier échouerait en conflit sur GitHub Packages.
- **Effet** : la release qui finit par se déclencher regroupe automatiquement, dans une seule
  entrée de changelog, tous les commits accumulés depuis le dernier tag — comportement natif de
  semantic-release, pas une fonctionnalité à coder.
- **Ajout du trailer** : `gh pr merge --squash --body "...

Release-Trigger: true"` — trailer sur sa propre ligne finale, précédée d'une ligne vide, jamais
  intégré dans une phrase. Uniquement sur le merge identifié comme dernier item du sprint courant.

## Workflow — Autoloop PR

Après toute modification sur une branche de travail — US/Enabler (`feat/{us-id}-{slug}`) ou
hors sprint (`fix/`, `refactor/`, `chore/`, `docs/`) — **sans exception** :

1. Ouvrir une PR (draft) vers `main`
2. **Autoloop** (20 itérations max) :
   - **En parallèle :**
     - **Review neutre** — Expert PR Review : architecture, AC, sécurité, dette, a11y, i18n
     - **CI** — `npx tsc --noEmit` + `npm run lint` + `npm run test:ci` + build prod = 0 erreur/warning
   - **Corrections** — tous les findings résolus, commit `fix({scope}): ...`
   - **Convergence** — Gate 4 ≥ 85 ET CI verte → sortir
3. Gate 4 ≥ 85 :
   - Sortir la PR du mode draft (`gh pr ready`)
   - État interne Review dans `sprints/sprint-{N}.md` (Stage frontmatter reste `⬜` — ne passe à `✅` qu'à la recette mainteneur)
   - **Gate 5** — générer/mettre à jour la spec fonctionnelle et technique figée `pivot-docs/docs/specs/E30/{us-id}-{slug}.md`
   - Signal mainteneur
4. Blocage 20 boucles → Breaking Point 2

## Workflow — Ordre d'exécution par US (dans un sprint)

| Étape | Contenu |
|-------|---------|
| **1. Code** | Composants Angular + TSDoc · Services |
| **2. Tests** | Vitest TU composants + services — **dans le même commit** |
| **3. Qualité** | ESLint · TypeScript strict verts |
| **4. UI / i18n / A11y** | Composants Angular, styles, ARIA |
| **5. Gate 2** | Coverage check : ≥ 85 % → continuer · 70–84 % → compléter · < 70 % → stop |
| **6. Backlog** | Mise à jour `sprints/sprint-{N}.md` + statut US **obligatoire avant commit** |
| **7. E2E** | Spec Playwright (happy path + 1 erreur critique) |
| **8. Commit** | `git add` fichier par fichier · commits atomiques sur branche `feat/{us-id}-{slug}` |

> **E2E différable** si environnement indisponible. Étapes 6 et 8 non différables.

### Approche tests

Écrire le code d'abord, puis les tests couvrant toutes les branches et conditions limites. TDD strict non utilisé.

**Exception :** quand le contrat d'un service STOMP est flou — écrire les tests en premier pour forcer la clarification.

---

## Workflow — Vérifications avant push autonome

**Condition absolue avant tout push autonome : 0 erreur, 0 warning.**

```bash
npx tsc --noEmit                              # TypeScript strict (0 erreur)
npm run lint                                  # ESLint (0 warning)
npm run test:ci                               # Vitest coverage
npm run build -- --configuration production   # Build prod (doit réussir)
```

Rapporter ✅ ou stderr complet. Toute erreur ou warning non justifié = **stop, corriger avant push**.

---

## Workflow — Branches

| Préfixe | Usage | Exemple |
|---------|-------|---------|
| `feat/{us-id}-{slug}` | Implémentation d'une US | `feat/us08-1-3-liste-tableaux-angular` |
| `feat/{en-id}-{slug}` | Implémentation d'un Enabler | `feat/en08-2-guard-angular-whiteboard` |
| `fix/{id}-{slug}` | Correction bug hors sprint | `fix/9-transloco-loader-404` |
| `refactor/{id}-{slug}` | Refactoring hors sprint | `refactor/14-signals-migration` |
| `chore/{slug}` | CI, deps, config | `chore/eslint-config` |
| `docs/{slug}` | Documentation hors sprint | `docs/adr-stomp-client` |

**Règles :**
- Jamais de travail direct sur `main`
- **Une branche = un item de sprint** (US ou Enabler)
- **Backlog pivot-docs committé sur la branche de l'US**
- Rebase avant merge → squash WIP
- `git push --force-with-lease` uniquement sur branches de travail

**Création de branche US — procédure obligatoire :**
```bash
git checkout main
git pull origin main
git checkout -b feat/{us-id}-{slug}
```
Branche existante → `git checkout feat/{us-id}-{slug}` directement.

---

## Workflow — Commits

Format **Conventional Commits** (`type(scope): message`) — alimente Semantic Release pour le versioning automatique.

| Commit | Contenu typique |
|--------|----------------|
| `feat(ui):` | composant Angular, service, route |
| `fix(ui):` | correction bug frontend |
| `feat(whiteboard):` | canvas, tableaux, partage/rôles (F08.x) |
| `feat(quiz):` | quiz interactif, sondages |
| `feat(session):` | session live, facilitation d'atelier |
| `feat(forms):` | moteur de formulaire |
| `feat(modules):` | lazy-loading, route guard, activation module (une fois `@pivot-platform/ui-core` consommable) |
| `feat(ws):` | WebSocket STOMP client Angular (`@stomp/rx-stomp`) |
| `fix(ws):` | correction bug WebSocket / STOMP |
| `test:` | ajout ou correction de tests (Vitest, Playwright) sans changement de code prod |
| `feat(a11y):` | accessibilité WCAG, attributs ARIA |
| `style(ui):` | SCSS, styles |
| `ci:` | GitHub Actions workflows, Plumber |
| `docs:` | README, CLAUDE.md, ADR |
| `security:` | correctif sécurité — **hard block Gate 4, review humaine** |

Co-author sur chaque commit : `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Gates ACDD — Confidence Gates

Score 0–100, jamais booléen. Scores/décisions consignés en **commentaire de PR**. Le statut vit
dans le champ **Stage** du frontmatter US (pivot-docs).

| Gate | Moment | Seuils |
|------|--------|--------|
| **1 — READINESS** | Avant implémentation | PO Agent self-challenge · = 100 → état interne Ready → procéder (Stage frontmatter reste ⬜) · < 100 → PO Agent réécrit ACs |
| **2 — COVERAGE** | Par commit | ≥ 85 → continuer · 70–84 → compléter tests · < 70 → stop |
| **3 — QUALITY** | Après CI verte | Hard blocks : secret Gitleaks, label `security`/`breaking-change`, modif contrat module/dépendance ui-core |
| **4 — MERGE CONFIDENCE** | Avant merge | ≥ 85 → merge autonome · 60–84 → merge documenté · < 60 → Breaking Point 2 |

**Checks Gate 1 :** AC testables (40) · dépendances résolues (20) · impact contrat module (15) · AC sécurité + A11y ≥ 1 chacun (15) · pas de cycle (10)

**Checks Gate 2 :** AC couverts (50) · pas de code non testé (30) · tests non triviaux (20)

**Checks Gate 3 :** SonarCloud ≥ 80 % (25) · zéro finding critique/high (25) · linters clean (20) · Gitleaks clean (20) · build Docker (10)

**Format du commentaire de PR (gate)** : `gate` (READINESS | COVERAGE | QUALITY | MERGE_CONFIDENCE), `score`, `decision`, `breakdown`, `notes`.

---

## Agents IA — Rôles et cycle ACDD

### Philosophie

**ACDD (Acceptance Criteria Driven Development)** — gates de confiance continues.

- Gates → score (0–100), jamais booléen pass/fail
- Chaque gate → consigné en **commentaire de PR** (pas de fichier committé)
- Breaking Points = seuls moments d'intervention humaine obligatoire

### Rôles

| Agent | Responsabilité |
|-------|---------------|
| **PO Agent** | Génère Epics et US, rédige AC, clarifie AC ambigus |
| **Architect Agent** | Valide AC techniques Angular, identifie impact contrat de module |
| **Security Agent** | Challenge AC (XSS, WebSocket), valide fixes CSP/SRI |
| **Dev Agent** | Implémente sur branche dédiée, s'auto-évalue via gates |
| **QA Agent** | Rédige specs Playwright, valide coverage Vitest, challenge A11y |
| **PR Review Agent** | Exécute Gate 3 + Gate 4, merge ou escalade selon score |

### Format des AC

```markdown
- [ ] Given [contexte], when [action], then [résultat observable]
- [ ] Error case: given [input invalide], system retourne [erreur / status code]
- [ ] Security: [propriété de sécurité qui doit tenir]
```

Chaque AC mappe à au moins un test. AC sans test = non implémenté, peu importe le code présent.
AC ambigu à l'implémentation → **stopper et demander au PO Agent** — jamais d'interprétation unilatérale.

### Labels PR

| Label | Signification |
|-------|--------------|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `security` | Impact sécurité — hard block Gate 4, review humaine |
| `breaking-change` | Changement de contrat — hard block Gate 4, review humaine |
| `module-contract` | Changement contrat de module — hard block Gate 4 |
| `needs-human-review` | Gate 4 < 60 ou hard block — décision humaine requise |
| `auto-approved` | Gate 4 ≥ 85 — mergé automatiquement |
| `chore` | Maintenance, CI, dépendances |
| `docs` | Documentation uniquement |

### Post-merge

```bash
# 1. Mainteneur : passe Stage: ⬜ → ✅ dans le frontmatter US (recette humaine — jamais Claude)
# 2. Débloquer les US dépendantes
# 3. Nettoyer la branche
git push origin --delete feat/{us-id}-{slug}
```

---

## Standards de code

### Angular (frontend)

- TypeScript strict — pas de `any`
- OnPush change detection par défaut (`ChangeDetectionStrategy.OnPush`)
- Signals Angular pour le state local — `signal()`, `computed()`, `effect()`
- RxJS pour l'asynchrone HTTP et WebSocket — pas de Promise sauf interop
- SCSS — pas de styles inline
- WCAG 2.1 AA sur tous les éléments interactifs (ARIA, focus, contraste)
- Pas de logique métier dans les composants — déléguer aux services
- `inject()` plutôt que constructeur pour les dépendances
- Routes lazy-loaded par feature — jamais de barrel d'import massif
- TSDoc sur tous les services, guards et pipes publics
- i18n : **Transloco** — tous les libellés externalisés, jamais de chaîne littérale dans les templates ou services
- Garde fonctionnels (`CanActivateFn`) — jamais de classe `CanActivate` (deprecated)

### Général

- Pas de secrets dans le code — variables d'environnement
- **`// NOSONAR` : zéro, jamais.** Tout faux positif Sonar se marque côté SonarCloud, aucune exception.
- **`// nosemgrep` : interdit par défaut**, autorisé **uniquement avec la validation explicite du mainteneur**.

---

## Système de modules (côté Angular) — différé

Ce repo consommera `ModuleGuard`/`ModuleStatusService` (contrat exposé par `@pivot-platform/ui-core`) une
fois ce dernier réellement publié et consommable (voir section "Dépendances plateforme" ci-dessus) :
- Module désactivé = route inaccessible + aucun bundle chargé
- Guard d'activation : appel API `/api/modules/{id}/status` → 403 si désactivé
- Changement de contrat de module = **hard block Gate 4 + coordination pivot-ui obligatoire**

---

## Auth (différée)

**Aucun mécanisme d'authentification n'est implémenté dans ce squelette.** Ce repo consommera
`AuthService`/`AuthInterceptor`/`AuthGuard` de `@pivot-platform/ui-core` une fois publié — **jamais de
réimplémentation locale** d'un mécanisme d'auth propre à ce module.

---

## Audits

Dans **pivot-docs** — un fichier par catégorie, mis à jour en place. **Jamais de fichiers datés.**

---

## Règles absolues

| Interdit | Raison |
|----------|--------|
| `--no-verify` | Contourne les hooks qualité |
| `git push origin main` (push direct) | Jamais — tout code passe par PR + review (sauf commit initial de bootstrap) |
| `git push --force` sur `main` | Jamais — le mainteneur uniquement si nécessaire |
| `git add .` en bloc | Risque d'inclure `.env`, clés, tokens |
| Merger avec label `security` sans revue humaine | Hard block Gate 4 |
| `any` TypeScript | Désactive la sécurité du typage |
| Logique métier dans les composants | Viole la séparation des couches |
| Implémenter sans US tracée dans les fichiers markdown backlog | Perte de traçabilité |
| Dépendance `@pivot-platform/ui-core`/`@pivot/design-system` avec version fictive | Coordonnée npm fictive — vérifier l'état de publication avant toute tentative |
| Réimplémentation locale d'un mécanisme d'auth | Doit venir exclusivement de `@pivot-platform/ui-core` — dérive d'architecture |
| Commiter `.env`, tokens, secrets, certificats | Exposition définitive |
| Logique de filtrage tenant côté Angular | Non-fiable — le backend est la seule autorité d'isolation |

---

## Règle transversale sécurité — Isolation tenant (à activer avec `@pivot-platform/ui-core`)

- Ne jamais passer de `tenantId` ou `userId` en query param, header custom ou body côté Angular
- L'isolation tenant est **exclusivement gérée côté backend** une fois l'auth branchée
- Contenu affiché : utiliser **Angular interpolation `{{ val }}`** — jamais `innerHTML` avec données utilisateur

---

## Boucles de problèmes — règle d'escalade

### Limite 10 commandes en échec successif

Si **10 commandes consécutives échouent** (toute combinaison : build, test, lint, push, CI) sur une tâche :
1. **Stopper la tâche courante** — ne pas impacter les agents parallèles sur d'autres US
2. **Poster un commentaire de gate** avec `decision: ESCALATED`, liste des 10 échecs, contexte
3. **Label `needs-human-review`** + signal mainteneur
4. **Proposer une alternative** (approche différente, découpage)

Le compteur se remet à zéro dès qu'une commande réussit.

### Limite 20 push — autoloop PR Review

Voir section **Workflow — Autoloop PR** — au-delà de 20 push correctifs → Breaking Point 2 automatique.

### Règle 2 tentatives (stratégie identique)

Après **2 tentatives** (même stratégie ou variantes proches) :
1. **Stopper** — ne pas continuer à boucler
2. **Poster un commentaire de gate sur la PR** avec `decision: ESCALATED`, contexte complet, tentatives effectuées — **jamais committer un fichier de gate**
3. **Signaler** au mainteneur : blocage, tentatives, raison de l'échec — label `needs-human-review`
4. **Proposer** une alternative : approche différente, outil différent, contournement

Ne jamais enchaîner plus de 2 tentatives sans informer le mainteneur.

---

## Skills — Knowledge Cards

Index : `.project/skills/_index.yaml`

| Skill | Fichier | Charger quand |
|-------|---------|---------------|
| `skill-angular-architecture` | `skill-angular-architecture.yaml` | Tout fichier .ts / .html / .scss |
| `skill-oidc-angular` | `skill-oidc-angular.yaml` | Une fois `@pivot-platform/ui-core` branché — fichier auth/, guard, AC sécurité |
| `skill-module-system-angular` | `skill-module-system-angular.yaml` | Feature module, lazy-loading, route guard |
| `skill-ac-traceability` | `skill-ac-traceability.yaml` | **Toujours** — toute implémentation d'US, Gate 2, Gate 4 |
| `skill-testing-strategy` | `skill-testing-strategy.yaml` | Nouveau test Vitest, coverage < 85 %, spec Playwright |
| `skill-devops-cicd` | `skill-devops-cicd.yaml` | Fichier .github/workflows/, Dockerfile, config CI |
| `skill-accessibility` | `skill-accessibility.yaml` | Tout composant interactif, AC A11y |
| `skill-rgpd` | `skill-rgpd.yaml` | US touchant contenu utilisateur (board, formulaire, session) |
| `skill-observability` | `skill-observability.yaml` | Nouveau log Angular, nouvelle métrique, monitoring erreurs |
| `skill-i18n` | `skill-i18n.yaml` | Fichier fr.json/en.json, pipe translate, langue UI |
| `skill-ux-design-system` | `skill-ux-design-system.yaml` | SCSS, tout composant UI — en attendant `@pivot/design-system` |
| `skill-security-redteam` | `skill-security-redteam.yaml` | US WebSocket/données user, `[innerHTML]`, AC sécurité |
| `skill-security-blueteam` | `skill-security-blueteam.yaml` | nginx.conf, rapport Red Team reçu |
| `skill-pr-reviewer` | `skill-pr-reviewer.yaml` | Gate 3 (qualité CI), Gate 4 (décision merge), review PR |

**Règle :** avant d'écrire du code, identifier les skills applicables via l'index et les lire.
Ces skills sont des cartes méthodologiques génériques héritées de `pivot-ui` (aucune ne
référence de composant/service spécifique à `pivot-ui` — vérifié au bootstrap).

---

## Parallélisation

Lancer un maximum d'actions en parallèle dans chaque message :

| Actions parallélisables | Exemples |
|------------------------|---------|
| Lectures indépendantes | Plusieurs `Read` / `Grep` / `Glob` |
| Linters | ESLint + TypeScript lancés simultanément |
| Créations de fichiers indépendants | Composant + service + spec Vitest |
| Recherches codebase | Plusieurs `Grep` sur cibles différentes |

Ne séquencer que ce qui dépend du résultat d'une étape précédente.
