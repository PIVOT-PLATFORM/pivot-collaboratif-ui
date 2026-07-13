/**
 * Setup d'authentification recette — s'exécute AVANT toutes les specs @recette.
 *
 * Se connecte une seule fois avec le compte de recette dédié (secrets CI) via le vrai
 * formulaire de login, puis sauvegarde l'état de session (cookie httpOnly `pivot_session`)
 * dans e2e-recette/.auth/recette.json. Les specs recette repartent de cet état — pas de
 * re-login par spec.
 *
 * Le token d'accès est en mémoire uniquement (jamais persisté) ; APP_INITIALIZER le restaure
 * depuis le cookie de session à chaque chargement de page — sauvegarder le cookie suffit.
 *
 * Contrairement aux specs de e2e/ (mockées via page.route), ici AUCUN mock : vrai backend,
 * vrai login, vraies données sur le tenant de test.
 */
import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'e2e-recette/.auth/recette.json';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} manquant — la validation recette exige les secrets du compte de test ` +
        `(RECETTE_E2E_EMAIL / RECETTE_E2E_PASSWORD / RECETTE_E2E_TENANT).`,
    );
  }
  return value;
}

setup('authentifie le compte de recette dédié', async ({ page }) => {
  const email = requireEnv('RECETTE_E2E_EMAIL');
  const password = requireEnv('RECETTE_E2E_PASSWORD');

  await page.goto('/auth/login');
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/mot de passe|password/i).fill(password);
  await page.getByRole('button', { name: /se connecter|log ?in|connexion/i }).click();

  // Succès = redirection hors de /auth/login vers l'app authentifiée.
  await expect(page).toHaveURL(/\/(dashboard|home|accueil)/, { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
