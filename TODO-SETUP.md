# TODO — Setup manuel restant (pivot-collaboratif-ui)

## ✅ BLOQUANT #1 — Branch protection / ruleset de base — résolu

Anciennement bloquant : la création de la branch protection classique et du ruleset `protect-main`
avait été refusée par l'API GitHub (403 "Upgrade to GitHub Pro or make this repository public to
enable this feature") lors du bootstrap initial. **Ce n'est plus le cas** — vérifié en direct :

```
$ gh api repos/PIVOT-PLATFORM/pivot-collaboratif-ui/branches/main/protection
```
confirme la branch protection active sur `main` : 1 review requise
(`required_pull_request_reviews.required_approving_review_count = 1`) et 3 checks requis
(`required_status_checks.contexts` : `Code Quality - Angular`, `Tests (Vitest)`,
`Build Angular (production)`).

Le ruleset `protect-main` (id `18556613`) existe également sur le repo (deletion / non-fast-forward
/ historique linéaire).

Reste ouvert : le ruleset **comprehensive** (tous les 13 checks, calqué sur `pivot-ui`) n'est
toujours pas appliqué — voir la section dédiée plus bas ("Une fois tout ce qui précède est vert").

---

## À faire avant d'activer le ruleset complet (tous les checks)

- [ ] **Créer le projet SonarCloud** pour `PIVOT-PLATFORM_pivot-collaboratif-ui` (organisation
      `pivot-platform`) — `sonar-project.properties` déjà présent avec cette clé.
- [ ] **Ajouter le secret `SONAR_TOKEN`** pour ce repo (Settings → Secrets and variables → Actions).
- [ ] **Vérifier les secrets partagés au niveau organisation** (`GITLEAKS_LICENCE_KEY`,
      `SEMGREP_APP_TOKEN`, `PLUMBER_METADATA_TOKEN`, `PLUMBER_TOKEN`, `SEMANTIC_RELEASE_TOKEN`,
      `PIVOT_PROD_URL`) — impossible de confirmer depuis cette session (token utilisé pour ce
      bootstrap sans droits `admin:org`) si ce nouveau repo est inclus dans leur périmètre de
      visibilité (`All repositories` vs `Selected repositories`). Constat fait pendant le
      bootstrap : `pivot-ui` lui-même a **0 secret au niveau repo** — donc ces secrets sont
      forcément organisation, jamais configurés par repo. Vérifier manuellement : Organization
      Settings → Secrets and variables → Actions → périmètre de chaque secret.
- [ ] **Publier une vraie release GHCR** de `pivot-collaboratif-core` — **régression** : une
      release `v1.0.0` (2026-07-06) avait brièvement publié
      `ghcr.io/pivot-platform/pivot-collaboratif-core/pivot-collaboratif-core:latest`, mais
      `pivot-collaboratif-core` a depuis **rétrogradé cette release prématurée** (commit
      `68dff93`, retour à `0.0.0`) — `gh api repos/PIVOT-PLATFORM/pivot-collaboratif-core/releases`
      retourne `[]`, seul le tag `v0.0.0` existe. L'image n'a jamais été republiée depuis. Ne pas
      recocher cette case tant qu'une vraie release n'a pas republié l'image.
- [x] **BLOQUANT #2 (partie accès) — package GHCR `pivot-collaboratif-core` privé, pas d'accès
      cross-repo pour les Actions de `pivot-collaboratif-ui`.** Résolu 2026-07-09 : mainteneur a
      accordé l'accès via Package settings → "Manage Actions access" → Add repository →
      `pivot-collaboratif-ui` → Role: Read (Option A — package reste privé). Confirmé : aucune
      API REST/GraphQL n'existe pour cette action (feature UI uniquement, cf. discussions
      GitHub community #188574/#61495) — ni lecture ni écriture possible via `gh api`, contexte
      pour toute tentative future sur un autre repo.
      Un second blocant lié au schéma est apparu une fois l'image (celle de l'époque `v1.0.0`)
      réellement pull-able : `V1__schema_init.sql` de `pivot-collaboratif-core` (EN08.3,
      migration UUID→BIGINT) ajoute des FK vers `public.tenants(id)`/`public.users(id)` —
      absentes de ce stack E2E (Postgres nu, aucun pivot-core en cours d'exécution ici). Fix :
      étape `psql` créant ces deux tables minimales avant de démarrer
      `pivot-collaboratif-core` (voir `e2e.yml`, "Seed minimal public schema") — ce fix reste
      valide et en place, il se redéclenchera dès qu'une image réelle sera de nouveau pull-able.
- [ ] **BLOQUANT #2 (partie image) — erreur CI actuelle : `manifest unknown`, pas `denied`.**
      Une version précédente de cette note décrivait l'échec `E2E - Playwright` comme
      `docker: Error response from daemon: denied` après un login GHCR réussi (problème
      d'autorisation). **Ce n'est plus l'erreur observée.** Logs CI en direct (2026-07-09,
      plusieurs runs récents) : `Login Succeeded!` suivi de
      `docker: Error response from daemon: manifest unknown` — classe d'erreur différente :
      l'image/tag n'existe simplement pas (404 registre), pas un refus d'accès. Root cause :
      voir la case ci-dessus — `pivot-collaboratif-core` a rétrogradé sa release `v1.0.0`
      prématurée vers `0.0.0`, donc l'image `:latest` que ce fichier supposait publiée par
      "v1.0.0" n'a jamais été republiée après cette rétrogradation.
      **Impact** : `E2E - Playwright` **n'est pas un check requis actuellement** (les 3 checks
      requis sont `Code Quality - Angular`, `Tests (Vitest)`, `Build Angular (production)` — voir
      "Checks déjà requis" plus bas), donc ceci **ne bloque aucun merge** — mais tant que
      `pivot-collaboratif-core` n'a pas publié une vraie release, ce job ne donne aucun signal
      E2E réel sur ce repo.
- [ ] **Question architecture à trancher avec le mainteneur** : `dast-baseline.yml` scanne
      `secrets.PIVOT_PROD_URL` — mais ce module est lazy-loadé DANS le shell `pivot-ui` (pas de
      domaine/URL public autonome en prod). Décider si ce scan doit être retiré, pointé sur la
      même URL que `pivot-ui`, ou sur une route spécifique une fois l'intégration réelle décidée.
- [ ] **Une fois tout ce qui précède est vert**, étendre le ruleset comprehensive (calqué sur
      `pivot-ui/rulesets` id `17930084`, nommé `protect-main` chez `pivot-ui` — contient déjà
      TOUTES les règles de base + les 13 checks, contrairement à `pivot-core` qui sépare
      `protect-main` [basique] et `main-protection` [comprehensive]) :
      ```bash
      gh api repos/PIVOT-PLATFORM/pivot-ui/rulesets/17930084 > /tmp/ui-ruleset-ref.json
      # Adapter et créer via:
      # gh api repos/PIVOT-PLATFORM/pivot-collaboratif-ui/rulesets -X POST --input <fichier-adapte.json>
      ```
      Contexts à inclure (ordre pivot-ui) : `Code Quality - Angular`, `Tests (Vitest)`,
      `Build Angular (production)`, `SCA - Dependency Audit`, `E2E - Playwright`,
      `SonarCloud Analysis`, `SonarCloud Code Analysis`, `Gitleaks - Secret Scan`,
      `CodeQL - SAST`, `Semgrep - SAST`, `Plumber - CI/CD Compliance`,
      `Lighthouse — Accessibilité`, `Docker preview image (PR)`.

## Checks déjà requis (fonctionnent sans configuration supplémentaire)

Ces 3 checks n'utilisent que `secrets.GITHUB_TOKEN` (fourni automatiquement, aucune
configuration requise) — validés localement avant push (tsc, ESLint, Vitest, build prod tous
verts) :

- `Code Quality - Angular` (`tsc --noEmit` + ESLint)
- `Tests (Vitest)` (coverage)
- `Build Angular (production)`

## Simplifications du bootstrap à connaître (pas des bugs)

- `lighthouse.yml` est significativement simplifié par rapport à celui de `pivot-ui` : pas de
  stack backend démarrée, une seule page auditée (`/`), pas de scénario authentifié — ce
  squelette n'a ni route, ni auth. À étendre au fil des features réelles.
- `dast-full.yml` est copié structurellement (mêmes noms de job) mais **non fonctionnel** : le
  flux d'auth simulé (`POST /api/auth/login`) n'existe pas dans ce module. Déjà `workflow_dispatch`
  uniquement (jamais auto-déclenché), comme chez `pivot-ui`.
- `.lighthouserc.local.json` / `.lighthouserc.noauth.json` / `lighthouse-auth.cjs` de `pivot-ui`
  n'ont **pas été repris** (routes `/auth/*`, `/legal/*` inexistantes ici) — un seul
  `.lighthouserc.json` testant `/` les remplace tous pour l'instant.

## Autre dépendance externe au module (pas un TODO CI/CD, mais bloquant pour le dev réel)

`@pivot/ui-core` et `@pivot/design-system` ne sont pas publiés — voir `CLAUDE.md`, section
"Dépendances plateforme — état réel", et le pré-requis explicite noté dans
`pivot-docs/docs/backlog/EPIC-collaboration/README.md` (EPIC E30 : *"Pré-requis EN17 :
pivot-core-starter + @pivot/ui-core publiés avant implémentation"*).
