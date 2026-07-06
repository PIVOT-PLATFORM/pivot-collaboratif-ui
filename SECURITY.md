# Security Policy

## Versions supportées

| Version | Support |
|---------|---------|
| dernière release | ✅ Support complet |
| dernière - 1 | ✅ Correctifs sécurité uniquement |
| antérieures | ❌ Aucun support |

---

## Signaler une vulnérabilité

**Ne pas ouvrir d'issue publique GitHub pour une vulnérabilité de sécurité.**

Une divulgation publique avant qu'un correctif soit disponible expose tous les utilisateurs PIVOT.

### Comment signaler

Utiliser **GitHub Private Vulnerability Reporting** :

```
https://github.com/PIVOT-PLATFORM/pivot-collaboratif-ui/security/advisories/new
```

### Informations à inclure

- Composant affecté (module Angular concerné, fonctionnalité)
- Version PIVOT et navigateur
- Description de la vulnérabilité et impact potentiel
- Étapes de reproduction — aussi détaillées que possible
- Preuve de concept si disponible (optionnel mais apprécié)

---

## Délais de réponse

| Étape | Objectif |
|-------|----------|
| Accusé de réception | 48 heures |
| Évaluation initiale | 5 jours ouvrés |
| Correctif — Critique (CVSS ≥ 9.0) | 7 jours |
| Correctif — Élevé (CVSS 7.0–8.9) | 30 jours |
| Correctif — Moyen / Faible | Prochaine release planifiée |

---

## Politique de divulgation

Divulgation coordonnée :

1. Le rapporteur soumet via advisory privé
2. Les mainteneurs accusent réception et évaluent la sévérité
3. Le correctif est développé sur une branche privée
4. Le correctif est releasé et taggé
5. L'advisory de sécurité est publié avec assignation CVE (si applicable)
6. Le rapporteur est crédité dans l'advisory (sauf anonymat demandé)

Pas de programme bug bounty actuellement.

---

## Périmètre

### Dans le périmètre

- **XSS** — injection de scripts via inputs, templates Angular, interpolation
- **WebSocket / STOMP** — une fois implémenté (whiteboard, session live) : injection via messages,
  isolation par room/board
- **Exposition de données** — données sensibles exposées dans le DOM, logs console, Local Storage
- **CSP** — Content Security Policy insuffisante sur les assets servis

### Hors périmètre

- **Auth** — ce repo n'implémente aucune authentification (déférée à `@pivot/ui-core` une fois
  publié) ; signaler les vulnérabilités OIDC/tokens dans
  [pivot-ui](https://github.com/PIVOT-PLATFORM/pivot-ui/security/advisories/new)
- Vulnérabilités dans l'API backend → signaler dans
  [pivot-collaboratif-core](https://github.com/PIVOT-PLATFORM/pivot-collaboratif-core/security/advisories/new)
- Vulnérabilités dans les dépendances tierces (signaler au projet upstream)
- Problèmes nécessitant un accès physique à la machine hôte
- Attaques d'ingénierie sociale
- Déni de service par épuisement des ressources

---

## Principes de sécurité

- **TypeScript strict** — pas de `any`, réduction des erreurs runtime
- **CSP** — headers configurés par nginx en production
- **SBOM généré à chaque release** — disponible dans GitHub Releases
- **Aucune réimplémentation locale d'auth** — viendra exclusivement de `@pivot/ui-core` une fois
  publié (voir CLAUDE.md)

---

## Scanning actif en CI

| Outil | Couverture |
|-------|-----------|
| Gitleaks | Secrets dans le code et l'historique git |
| CodeQL | SAST JavaScript/TypeScript |
| Semgrep | OWASP Top 10, XSS, injection, secrets |
| Trivy | SCA — dépendances npm |
| npm audit | Audit production dépendances |
| Plumber | Conformité et hardening des workflows CI/CD |
| OpenSSF Scorecard | Score de sécurité open-source global |
