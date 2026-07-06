# pivot-collaboratif-ui

<div align="center">

[![CI](https://github.com/PIVOT-PLATFORM/pivot-collaboratif-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/PIVOT-PLATFORM/pivot-collaboratif-ui/actions/workflows/ci.yml)
[![Angular](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white)](https://angular.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

</div>

Frontend Angular du domaine **Collaboratif** de la suite PIVOT — whiteboard, quiz, session live,
formulaire. Lazy-loadé dans le shell **pivot-ui** une fois intégré.

> **Statut : bootstrap.** Ce repo contient le squelette (build, CI/CD, sécurité) — aucune
> feature métier n'est encore implémentée. Voir [`CLAUDE.md`](CLAUDE.md) pour l'état exact des
> dépendances plateforme (`@pivot/ui-core` et `@pivot/design-system` pas encore publiés) et
> [`TODO-SETUP.md`](TODO-SETUP.md) pour ce qu'il reste à configurer manuellement.

Backend associé : [`pivot-collaboratif-core`](https://github.com/PIVOT-PLATFORM/pivot-collaboratif-core).
Shell frontend / auth : [`pivot-ui`](https://github.com/PIVOT-PLATFORM/pivot-ui).
Backlog : [`pivot-docs`](https://github.com/PIVOT-PLATFORM/pivot-docs) — EPIC E30 (Collaboration).

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Angular 22 · TypeScript strict |
| Styles | SCSS · reset minimal (en attente de `@pivot/design-system`) |
| Temps réel | `@stomp/rx-stomp` — dépendance ajoutée au bootstrap, aucun client STOMP implémenté |
| i18n | Transloco (FR par défaut, EN) |
| Tests unitaires | Vitest |
| Tests E2E | Playwright (Chromium) |
| CI/CD | GitHub Actions · SonarCloud · Semantic Release · Plumber |
| Déploiement | Docker (nginx) |

## Démarrage local

```bash
npm install
npm start   # ng serve — http://localhost:4200
```

## Pipeline CI/CD

```
push / PR
  ├── Code Quality - Angular       tsc --noEmit · ESLint
  ├── Tests (Vitest)               coverage
  ├── Build Angular (production)
  ├── SCA - Dependency Audit       Trivy (package-lock.json) · npm audit
  ├── Sécurité                    Gitleaks · CodeQL · Semgrep · Plumber
  └── PR uniquement               Docker preview

Sur main / schedule :
  ├── E2E - Playwright             non required (nécessite l'image GHCR pivot-collaboratif-core)
  ├── Mutation Testing (Stryker)   hebdomadaire, indicatif
  ├── Lighthouse — Accessibilité   audit "/" uniquement (pas de routes/auth encore)
  └── Release                     Semantic Release · Docker GHCR · SBOM
```

Détail des checks requis vs différés → [`TODO-SETUP.md`](TODO-SETUP.md).

## Documentation

| Sujet | Emplacement |
|-------|-------------|
| Instructions Claude Code + agents IA | [`CLAUDE.md`](CLAUDE.md) |
| Contribuer | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Sécurité & divulgation | [`SECURITY.md`](SECURITY.md) |
| Setup manuel restant | [`TODO-SETUP.md`](TODO-SETUP.md) |
| Backlog du domaine (EPIC E30) | `pivot-docs/docs/backlog/EPIC-collaboration/` |

## Licence

[GNU Affero General Public License v3.0](LICENSE) — les modifications déployées comme service réseau doivent être publiées.
