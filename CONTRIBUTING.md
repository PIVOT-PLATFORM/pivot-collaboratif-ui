# Contributing to PIVOT-UI

**PIVOT-UI** est le frontend Angular de la suite collaborative PIVOT — interface reactive, accessible (WCAG 2.1 AA), organisée par modules activables.
Toute contribution est bienvenue : bug, composant, style, accessibilité, ou documentation.

> Pour contribuer au backend Java, voir [pivot-core](https://github.com/ApoSkunz/pivot-core).

---

## Table des matières

- [Code de conduite](#code-de-conduite)
- [Ce que nous construisons](#ce-que-nous-construisons)
- [Comment contribuer](#comment-contribuer)
- [Environnement de développement](#environnement-de-développement)
- [Workflow de développement](#workflow-de-développement)
- [Standards de code](#standards-de-code)
- [Soumettre une pull request](#soumettre-une-pull-request)
- [Vulnérabilités de sécurité](#vulnérabilités-de-sécurité)
- [Obtenir de l'aide](#obtenir-de-laide)

---

## Code de conduite

Contributions respectueuses et constructives uniquement.
Pas de harcèlement, discrimination ou engagement de mauvaise foi.
Signalement aux mainteneurs via GitHub private message.

---

## Ce que nous construisons

PIVOT-UI est l'interface Angular de la suite PIVOT : tableau blanc temps réel, sessions live (quiz, sondage, brainstorm), roadmap/Gantt, quiz gamifié.
L'UI est conçue pour être accessible à tous (WCAG 2.1 AA) et activable module par module sans rechargement.

---

## Comment contribuer

### Signaler un bug

Ouvrir une [issue bug](.github/ISSUE_TEMPLATE/bug_report.yml).
Inclure : version PIVOT, navigateur, étapes de reproduction, captures d'écran si possible.

### Proposer une fonctionnalité

Ouvrir une [issue feature request](.github/ISSUE_TEMPLATE/feature_request.yml).
Décrire le problème UX résolu — pas juste l'implémentation envisagée.

### Corriger un bug ou implémenter une feature

Voir [Workflow de développement](#workflow-de-développement) ci-dessous.

### Améliorer la documentation

Markdown dans `docs/` et fichiers racine. Aucun outillage spécifique requis.

### Ajouter un module

Les modules PIVOT suivent le contrat `PivotModule` (défini dans pivot-core). Ouvrir une issue de discussion avant de démarrer — l'impact sur le contrat de module doit être évalué en amont.

---

## Environnement de développement

**Prérequis**
- Node.js 24 LTS
- Angular CLI 22 (`npm install -g @angular/cli`)
- pivot-core en fonctionnement (API backend) — voir [pivot-core README](https://github.com/ApoSkunz/pivot-core)

**Démarrage local**

```bash
npm ci
cp .env.example .env
# Éditer .env : pointer PIVOT_API_URL vers pivot-core local ou staging
npm start
# → http://localhost:4200
```

**Tests**

```bash
npm run test:ci    # Vitest avec coverage
npm run lint       # ESLint + TypeScript strict
npx tsc --noEmit   # Type check
```

---

## Workflow de développement

PIVOT utilise **OneFlow** — branche `main` unique avec branches de feature éphémères.

### 1. Trouver ou créer une issue

Tout travail démarre depuis une GitHub Issue.
Si tu travailles sur une issue existante, commenter pour signaler l'intention.
Si tu proposes du nouveau travail, ouvrir une issue d'abord et attendre l'accord d'un mainteneur.

### 2. Créer une branche

```bash
git checkout main
git pull origin main
git checkout -b feat/us-{issue-id}-{description-courte}
# Exemples :
# feat/us-42-whiteboard-toolbar
# fix/67-auth-redirect-loop
# chore/eslint-config
```

| Préfixe | Usage |
|---------|-------|
| `feat/us-{id}-{slug}` | Nouvelle US |
| `fix/{id}-{slug}` | Correction de bug |
| `refactor/{id}-{slug}` | Refactoring |
| `chore/{slug}` | CI, deps, config |
| `docs/{slug}` | Documentation |

### 3. Implémenter avec couverture des AC

Chaque issue a des critères d'acceptation (AC). L'implémentation doit couvrir chaque AC.
Nommer les fonctions de test avec l'identifiant AC :

```typescript
it('AC-42-01: displays toolbar when whiteboard is active', () => {});
it('AC-42-02: error case: toolbar hidden when module disabled', () => {});
```

Tests écrits dans le même commit que le code — jamais différés.

### 4. Rebase avant d'ouvrir une PR

```bash
git fetch origin
git rebase -i origin/main
# Squash les commits WIP — chaque commit final doit être lisible
git push --force-with-lease origin feat/us-42-whiteboard-toolbar
```

Pas de merge commits. Pas de commits `wip`, `fix again` ou `test` dans la branche finale.

### 5. Ouvrir une pull request

Utiliser le [template PR](.github/PULL_REQUEST_TEMPLATE.md).
Remplir toutes les sections — notamment la table de traçabilité AC → tests.

---

## Standards de code

Standards complets dans `CLAUDE.md`. Règles clés :

**Angular (frontend)**
- TypeScript strict — pas de `any`
- OnPush change detection par défaut
- RxJS pour l'asynchrone — pas de Promise sauf interop
- SCSS BEM ou tokens centralisés — pas de styles inline
- WCAG 2.1 AA sur tous les éléments interactifs
- Pas de logique métier dans les composants — déléguer aux services

**Général**
- Conventional Commits : `type(scope): message`
- Pas de secrets dans le code — variables d'environnement
- `git add` fichier par fichier — jamais `git add .`

---

## Soumettre une pull request

### La CI doit être verte

Tous les checks CI doivent passer avant merge :

1. Qualité — ESLint · TypeScript strict
2. Tests — Vitest avec coverage
3. Build Angular (production)
4. SonarCloud — Quality Gate ≥ 80 % coverage code nouveau
5. Sécurité — Gitleaks · CodeQL · Semgrep · Plumber

### Processus de review

- PRs reviewées par les mainteneurs sous 48 h (best effort)
- Changements à impact sécurité → review additionnelle requise
- Changements du contrat de module → PRs coordonnées avec pivot-core
- Label `security` ou `breaking-change` → review humaine obligatoire avant merge

### Co-authorship IA

Si tu as utilisé un assistant IA pour une partie de ta contribution, ajouter :

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Développement IA-assisté transparent — encouragé.

---

## Vulnérabilités de sécurité

**Ne pas ouvrir d'issue publique pour une vulnérabilité de sécurité.**

Signaler via [GitHub Private Vulnerability Reporting](../../security/advisories/new)
ou consulter [SECURITY.md](SECURITY.md) pour la politique de divulgation complète.

---

## Obtenir de l'aide

- **GitHub Discussions** — questions d'architecture, idées de features, discussion générale
- **Issues** — rapports de bugs et demandes de features uniquement
- **GitHub Security Advisories** — vulnérabilités uniquement

Petite équipe — délais de réponse variables mais tout est lu.
