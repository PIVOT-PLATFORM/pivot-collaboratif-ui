/**
 * Specs d'acceptation RECETTE — module Collaboratif (whiteboard) dans le shell pivot-ui.
 *
 * Jouées contre https://recette.pivot-platform.fr APRÈS déploiement (e2e-recette.yml).
 * Session déjà authentifiée par recette.setup.ts (compte de recette dédié) — le module
 * `collaboratif` est consommé en lazy-loading par le shell sous la route `/whiteboard`
 * (cf. src/app/app.routes.ts en dev harness, whiteboardRoutes de la lib en prod).
 *
 * Règle de traçabilité (skill-ac-traceability) : chaque test porte l'identifiant de l'AC
 * qu'il valide, comme pour les specs éphémères de e2e/ (mockées via stack jetable) — mais ici
 * la preuve vaut sur l'infra réelle (vrai pivot-collaboratif-core, vraies données du tenant
 * de test). Un « vrai PO » vérifierait exactement ces parcours sur le site déployé.
 *
 * Portée : NON destructif (login + navigation + affichage). Le module collaboratif est
 * temps réel (WebSocket STOMP) : on reste sur des assertions d'affichage/chargement du
 * whiteboard, sans dépendre d'un 2e participant ni d'un aller-retour de contenu (les actions
 * structurées côté Socle backend ne sont pas encore matérialisées — cf. e2e/whiteboard-canvas).
 *
 * AC destructifs à venir (création de tableau/carte, partage, présence multi-utilisateur) :
 * MÊME PATRON, mais ils créent leurs données sur le tenant de test dédié
 * (RECETTE_E2E_TENANT, isolation garantie côté backend) et les nettoient en `afterEach`
 * (suppression du tableau créé). Ils ne sont pas ajoutés ici tant que le cleanup transactionnel
 * n'est pas outillé, pour ne pas polluer un environnement recette PARTAGÉ.
 */
import { test, expect } from '@playwright/test';

test.describe('Recette — accès au whiteboard collaboratif (compte authentifié)', () => {
  test('AC-COLLAB-01 : la liste « Mes tableaux » s’affiche après navigation vers le whiteboard', async ({
    page,
  }) => {
    await page.goto('/whiteboard');
    await expect(page).toHaveURL(/\/whiteboard$/);
    // Marqueur observable du module chargé dans le shell : le titre h1 de la liste de tableaux
    // (whiteboard.board.list.title = « Mes tableaux »). Assertion d'affichage pure, sans
    // dépendance à des données seedées ni à une session temps réel active.
    await expect(page.getByRole('heading', { level: 1, name: /mes tableaux/i })).toBeVisible({
      timeout: 15_000,
    });
    // Le point d'entrée de création est présent et opérable (on ne clique pas : non destructif).
    await expect(page.getByRole('button', { name: /nouveau tableau/i })).toBeVisible();
  });

  test('AC-COLLAB-02 : le garde d’accès échoue fermé sur un tableau inexistant (infra réelle)', async ({
    page,
  }) => {
    // boardAccessGuard échoue fermé sur 403/404/erreur réseau (board-access.guard.ts) : un id
    // bien formé mais inexistant renvoie 404 côté pivot-collaboratif-core réel → retour à la
    // liste. Valide le contrat backend d'accès sur l'environnement déployé, pas seulement en mock.
    await page.goto('/whiteboard/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/whiteboard$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: /mes tableaux/i })).toBeVisible();
  });
});
