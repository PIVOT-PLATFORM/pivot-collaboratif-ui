# TODO — Setup manuel restant (pivot-collaboratif-ui)

Ce repo a été bootstrappé avec :
- Branch protection classique sur `main` (1 review requise, 3 status checks **self-contained**
  requis — voir liste ci-dessous)
- Ruleset `protect-main` (deletion / non-fast-forward / historique linéaire) — identique à
  `pivot-ui`/`pivot-core`

**Volontairement PAS activé** : le ruleset complet (13 checks incluant SonarCloud, Lighthouse,
E2E, Docker preview, style `protect-main` comprehensive sur `pivot-ui`) — il rendrait `main`
définitivement non mergeable tant que les items ci-dessous ne sont pas faits.

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
- [ ] **Publier une première image GHCR** de `pivot-collaboratif-core` (première release du
      backend sibling) — `e2e.yml` et `lighthouse.yml`/`dast-full.yml` de ce repo démarrent
      `ghcr.io/pivot-platform/pivot-collaboratif-core/pivot-collaboratif-core:latest`, qui
      n'existe pas encore. `E2E - Playwright` échouera (docker pull 404) jusque-là — attendu,
      pas un required check.
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
