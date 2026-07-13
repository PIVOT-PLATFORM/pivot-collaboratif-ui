# i18n des modules — scope Transloco embarqué par lib — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque lib UI de module possède et embarque ses traductions via un scope Transloco enregistré par sa fonction `provideXxxUi()`, de sorte que le shell ne recopie plus jamais l'i18n d'un module.

**Architecture:** La lib `@pivot-platform/collaboratif-ui` déclare un scope Transloco `whiteboard` avec un `InlineLoader` (import dynamique par langue) dans `provideCollaboratifUi()`. Les fichiers de traduction (racine de scope) sont compilés dans le bundle de la lib. Le shell `pivot-ui` retire alors ses clés `whiteboard.*` recopiées. Un ADR + un enabler formalisent la convention pour tous les futurs modules.

**Tech Stack:** Angular 20+, `@jsverse/transloco` 8.4.0, `ng-packagr`, Vitest (builder Angular), TypeScript.

## Global Constraints

- **Isolation par repo** : une branche + une PR **par repo**, jamais de commit cross-repo. Chaque repo applique les règles de **son** `CLAUDE.md` (gates, commits, CI).
- **Transloco** : version `8.4.0` (identique shell + lib). API scope : `provideTranslocoScope({ scope: string, loader: InlineLoader })` où `InlineLoader = { [lang]: () => Promise<Translation> }`.
- **Nom du scope = clé de module du registre** : `whiteboard` (pas `collaboratif`).
- **Forme des fichiers de scope** : racine du scope, **sans** wrapper `whiteboard` (ex. `{ "board": { "untitled": … } }`).
- **Commits** : Conventional Commits. Co-author `Co-Authored-By: Claude <noreply@anthropic.com>`. Terminer par `Claude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs`.
- **Node** : Angular CLI exige Node ≥ 22.22.3 pour `ng test`/`ng build` (l'environnement de rédaction est en 22.22.2 → exécuter les étapes de test sur un poste/CI conforme).
- **Ne jamais** `git add .` en bloc — `git add` fichier par fichier.

---

## PARTIE A — Lib `pivot-collaboratif-ui` (branche `feat/i18n-module-scope`, déjà créée depuis `origin/main`)

Repo : `pivot-collaboratif-ui`. Deux projets Angular : `frontend` (harnais standalone) et `collaboratif-ui` (la lib).

### Task A1 : Extraire les traductions en fichiers racine-de-scope

**Files:**
- Create: `projects/collaboratif-ui/src/lib/i18n/fr.json`
- Create: `projects/collaboratif-ui/src/lib/i18n/en.json`
- Source: `projects/collaboratif-ui/i18n/{fr,en}.json` (bloc `whiteboard`)

**Interfaces:**
- Produces: deux fichiers JSON dont la racine est le contenu du bloc `whiteboard` (ex. clés `board`, `toolbar`, `groups`, `timer`, `voteResults`, `frame`, `card`, `connection`, `share`, `guard`, `canvas`, `template`, `join`, `ws`, `presence`).

- [ ] **Step 1 : Créer le dossier et extraire le sous-arbre `whiteboard` (fr + en)**

```bash
cd pivot-collaboratif-ui
mkdir -p projects/collaboratif-ui/src/lib/i18n
node -e '
const fs=require("fs");
for (const lang of ["fr","en"]) {
  const src=JSON.parse(fs.readFileSync(`projects/collaboratif-ui/i18n/${lang}.json`,"utf8"));
  if(!src.whiteboard){throw new Error(`bloc whiteboard absent dans ${lang}.json`);}
  fs.writeFileSync(`projects/collaboratif-ui/src/lib/i18n/${lang}.json`, JSON.stringify(src.whiteboard,null,2)+"\n");
}
console.log("extrait OK");
'
```

- [ ] **Step 2 : Vérifier que la racine ne contient PAS de wrapper `whiteboard`**

Run:
```bash
node -e 'const d=require("./projects/collaboratif-ui/src/lib/i18n/fr.json"); console.log("top-level:",Object.keys(d).join(",")); if(d.whiteboard) throw new Error("wrapper whiteboard présent — KO");'
```
Expected : liste `board,toolbar,groups,…` **sans** `whiteboard`. Pas d'erreur.

- [ ] **Step 3 : Commit**

```bash
git add projects/collaboratif-ui/src/lib/i18n/fr.json projects/collaboratif-ui/src/lib/i18n/en.json
git commit -m "$(printf 'feat(i18n): fichiers de scope whiteboard racine-de-scope\n\nExtraction du bloc whiteboard vers src/lib/i18n (sans wrapper), base du scope\nTransloco embarqué par la lib.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A2 : Test de parité fr/en du scope

**Files:**
- Create: `projects/collaboratif-ui/src/lib/i18n/i18n-parity.spec.ts`

**Interfaces:**
- Consumes: `src/lib/i18n/{fr,en}.json` (Task A1).

- [ ] **Step 1 : Écrire le test de parité (doit échouer si un jour fr≠en)**

```ts
// projects/collaboratif-ui/src/lib/i18n/i18n-parity.spec.ts
import fr from './fr.json';
import en from './en.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key];
  });
}

describe('scope whiteboard i18n', () => {
  it('a exactement les mêmes clés en fr et en', () => {
    const frKeys = new Set(flatten(fr as Record<string, unknown>));
    const enKeys = new Set(flatten(en as Record<string, unknown>));
    const onlyFr = [...frKeys].filter(k => !enKeys.has(k));
    const onlyEn = [...enKeys].filter(k => !frKeys.has(k));
    expect(onlyFr, `clés seulement en fr: ${onlyFr.join(', ')}`).toEqual([]);
    expect(onlyEn, `clés seulement en en: ${onlyEn.join(', ')}`).toEqual([]);
  });

  it('contient la clé signalée whiteboard.board.untitled (via board.untitled)', () => {
    expect((fr as { board: { untitled?: string } }).board.untitled).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Activer `resolveJsonModule` pour l'import des `.json`**

Modifier `tsconfig.json` (racine) — ajouter dans `compilerOptions` :

```json
    "resolveJsonModule": true,
```

- [ ] **Step 3 : Lancer le test — doit passer**

Run: `npx ng test collaboratif-ui --watch=false --include='**/i18n-parity.spec.ts'`
Expected : PASS (2 tests). Si `--include` non supporté par le builder, lancer `npm run test:ci` et repérer les 2 tests `scope whiteboard i18n`.

- [ ] **Step 4 : Commit**

```bash
git add projects/collaboratif-ui/src/lib/i18n/i18n-parity.spec.ts tsconfig.json
git commit -m "$(printf 'test(i18n): parité fr/en du scope whiteboard + resolveJsonModule\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A3 : Enregistrer le scope dans `provideCollaboratifUi()`

**Files:**
- Modify: `projects/collaboratif-ui/src/lib/core/whiteboard/config/provide-collaboratif-ui.ts`

**Interfaces:**
- Consumes: `src/lib/i18n/{fr,en}.json` (Task A1). Chemin relatif depuis `config/` : `../../../i18n/{lang}.json`.
- Produces: `provideCollaboratifUi()` fournit désormais le scope Transloco `whiteboard`.

- [ ] **Step 1 : Ajouter `provideTranslocoScope` au tableau de providers**

Dans `provide-collaboratif-ui.ts`, ajouter l'import et l'entrée provider :

```ts
import { provideTranslocoScope } from '@jsverse/transloco';
```

Et dans le tableau passé à `makeEnvironmentProviders([...])`, ajouter en dernier :

```ts
    provideTranslocoScope({
      scope: 'whiteboard',
      loader: {
        // provide-collaboratif-ui.ts est sous src/lib/core/whiteboard/config/ → 3 niveaux jusqu'à src/lib/
        en: () => import('../../../i18n/en.json'),
        fr: () => import('../../../i18n/fr.json'),
      },
    }),
```

- [ ] **Step 2 : Compiler la lib pour vérifier que l'import JSON passe le build**

Run: `npm run build:collaboratif-ui`
Expected : build OK. Si erreur « Cannot find module './...json' or its type declarations » → confirmer `resolveJsonModule` (Task A2 Step 2) et relancer. Si `ng-packagr` refuse l'import JSON dans une lib, appliquer le repli Task A3b.

- [ ] **Step 3 : Commit**

```bash
git add projects/collaboratif-ui/src/lib/core/whiteboard/config/provide-collaboratif-ui.ts
git commit -m "$(printf 'feat(i18n): enregistre le scope Transloco whiteboard dans provideCollaboratifUi\n\nInlineLoader import() par langue — traductions embarquées dans le bundle de la\nlib, plus aucune recopie côté host.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A3b : (repli, seulement si Task A3 Step 2 échoue sur l'import JSON en lib)

**Files:**
- Create: `projects/collaboratif-ui/src/lib/i18n/fr.ts`
- Create: `projects/collaboratif-ui/src/lib/i18n/en.ts`
- Modify: `provide-collaboratif-ui.ts` (imports `.ts` au lieu de `.json`)

- [ ] **Step 1 : Générer des modules `.ts` exportant l'objet de traduction**

```bash
node -e '
const fs=require("fs");
for (const lang of ["fr","en"]) {
  const d=fs.readFileSync(`projects/collaboratif-ui/src/lib/i18n/${lang}.json`,"utf8");
  fs.writeFileSync(`projects/collaboratif-ui/src/lib/i18n/${lang}.ts`, `export default ${d} as const;\n`);
}
'
```

- [ ] **Step 2 : Pointer le loader vers les `.ts`**

Dans `provide-collaboratif-ui.ts`, remplacer `import('../../../i18n/en.json')` par `import('../../../i18n/en')` (idem `fr`).

- [ ] **Step 3 : Rebuild + commit**

Run: `npm run build:collaboratif-ui` → Expected PASS.
```bash
git add projects/collaboratif-ui/src/lib/i18n/fr.ts projects/collaboratif-ui/src/lib/i18n/en.ts projects/collaboratif-ui/src/lib/core/whiteboard/config/provide-collaboratif-ui.ts
git commit -m "$(printf 'fix(i18n): repli modules .ts pour l embarquement du scope (ng-packagr)\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A4 : Test de rendu — aucune clé brute `whiteboard.` dans l'éditeur

**Files:**
- Create: `projects/collaboratif-ui/src/lib/whiteboard/whiteboard-scope-resolution.spec.ts`

**Interfaces:**
- Consumes: `provideCollaboratifUi` (Task A3), scope `whiteboard`.

- [ ] **Step 1 : Écrire le test de résolution via un composant hôte minimal**

```ts
// projects/collaboratif-ui/src/lib/whiteboard/whiteboard-scope-resolution.spec.ts
import { Component, Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideTransloco, Translation, TranslocoLoader, TranslocoPipe } from '@jsverse/transloco';
import { provideCollaboratifUi } from '../core/whiteboard/config/provide-collaboratif-ui';

// Loader global stub : le test n'exerce que des clés du scope whiteboard (chargées par
// provideCollaboratifUi via son InlineLoader) — le catalogue global reste vide. La lib ne
// doit PAS dépendre du loader du harnais.
@Injectable({ providedIn: 'root' })
class EmptyGlobalLoader implements TranslocoLoader {
  getTranslation() {
    return of({} as Translation);
  }
}

@Component({
  standalone: true,
  imports: [TranslocoPipe],
  template: `<span data-test>{{ 'whiteboard.board.untitled' | transloco }}</span>`,
})
class HostComponent {}

describe('résolution du scope whiteboard', () => {
  it('résout whiteboard.board.untitled sans rendre la clé brute', async () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: { availableLangs: ['fr', 'en'], defaultLang: 'fr', reRenderOnLangChange: true },
          loader: EmptyGlobalLoader,
        }),
        provideCollaboratifUi({ apiUrl: '/api/collaboratif' }),
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.querySelector('[data-test]').textContent.trim();
    expect(text).not.toMatch(/^whiteboard\./);
    expect(text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2 : Lancer — observer PASS ou FAIL**

Run: `npx ng test collaboratif-ui --watch=false --include='**/whiteboard-scope-resolution.spec.ts'`
Expected : **PASS** si la clé pleine résout via le scope. **Si FAIL** (rend `whiteboard.board.untitled`), appliquer Task A4b (bascule scope-relative), puis relancer jusqu'à PASS.

- [ ] **Step 3 : Commit**

```bash
git add projects/collaboratif-ui/src/lib/whiteboard/whiteboard-scope-resolution.spec.ts
git commit -m "$(printf 'test(i18n): la clé whiteboard.board.untitled résout via le scope (non brute)\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A4b : (repli, seulement si Task A4 Step 2 rend la clé brute)

**Files:**
- Modify: templates de la lib utilisant `'whiteboard.… | transloco` (ex. `projects/collaboratif-ui/src/lib/whiteboard/canvas/whiteboard-canvas.component.html`, `board/whiteboard-board.component.html`, `board-list/board-list.component.html`, `share/*`)

- [ ] **Step 1 : Passer les templates de la lib en scope-relatif**

Envelopper le contenu de chaque template de la lib dans le structural directive de scope, puis retirer le préfixe `whiteboard.` des clés :

```html
<ng-container *transloco="let t; scope: 'whiteboard'">
  <!-- avant : {{ 'whiteboard.board.untitled' | transloco }} -->
  <!-- après :  {{ t('board.untitled') }} -->
</ng-container>
```

Ajouter `TranslocoDirective` aux `imports` du composant standalone concerné.

- [ ] **Step 2 : Adapter le test A4 au rendu scope-relatif** (le composant hôte du test devient `t('board.untitled')` sous `*transloco`), relancer → Expected PASS.

- [ ] **Step 3 : Commit**

```bash
git add projects/collaboratif-ui/src/lib/whiteboard
git commit -m "$(printf 'refactor(i18n): clés scope-relatives dans les templates whiteboard\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A5 : Nettoyer le catalogue global du harnais (retirer `whiteboard`)

**Files:**
- Modify: `projects/collaboratif-ui/i18n/fr.json`, `projects/collaboratif-ui/i18n/en.json` (retirer le bloc `whiteboard`, garder `app`)
- Modify (si présents) : copies servies par le harnais (`public/assets/i18n/{fr,en}.json` ou `src/assets/...`)

**Interfaces:**
- Consumes: scope fourni par `provideCollaboratifUi` (le harnais l'appelle déjà dans `src/app/app.config.ts`).

- [ ] **Step 1 : Retirer le bloc `whiteboard` des catalogues globaux du harnais**

```bash
node -e '
const fs=require("fs");
for (const f of ["projects/collaboratif-ui/i18n/fr.json","projects/collaboratif-ui/i18n/en.json"]) {
  const d=JSON.parse(fs.readFileSync(f,"utf8")); delete d.whiteboard;
  fs.writeFileSync(f, JSON.stringify(d,null,2)+"\n"); console.log("nettoyé",f,"-> top-level",Object.keys(d).join(","));
}
'
```

- [ ] **Step 2 : Répercuter sur les copies d'assets réellement servies (si le build les copie)**

Run: `git grep -l "\"whiteboard\"" -- '*i18n*fr.json' '*i18n*en.json'`
Pour chaque fichier listé **hors** `src/lib/i18n/`, retirer le bloc `whiteboard` (même commande node adaptée au chemin).

- [ ] **Step 3 : Lancer le harnais et vérifier visuellement**

Run: `npm start` puis ouvrir `http://localhost:4200/whiteboard` (ou le port configuré), créer/ouvrir un board.
Expected : titre, toolbar, groupes affichés **en clair** (aucune clé `whiteboard.*`). Note : le 502 API du standalone (proxy `backend:8083`) est un problème distinct — l'i18n se juge sur les libellés statiques rendus.

- [ ] **Step 4 : Commit**

```bash
git add projects/collaboratif-ui/i18n/fr.json projects/collaboratif-ui/i18n/en.json
git commit -m "$(printf 'refactor(i18n): le harnais ne porte plus les clés whiteboard (scope lib)\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task A6 : CI verte + doc lib + PR

**Files:**
- Modify: `README.md` (section i18n de la lib), `.project/skills/skill-i18n.yaml`

- [ ] **Step 1 : Documenter la convention dans le README de la lib**

Ajouter une section « i18n — scope embarqué » : la lib expose le scope `whiteboard` via `provideCollaboratifUi()`, les hosts n'ont **rien** à recopier. Mettre à jour `skill-i18n.yaml` : « les libs de module ownent leur scope ; les hosts ne recopient jamais ».

- [ ] **Step 2 : CI complète (Node ≥ 22.22.3)**

Run:
```bash
npx tsc --noEmit && npm run lint && npm run build:collaboratif-ui && npm run test:ci
```
Expected : 0 erreur, 0 warning, tests verts.

- [ ] **Step 3 : Commit doc + push + PR**

```bash
git add README.md .project/skills/skill-i18n.yaml
git commit -m "$(printf 'docs(i18n): convention scope embarqué par lib\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
git push -u origin feat/i18n-module-scope
gh pr create --draft --base main --head feat/i18n-module-scope \
  --title "feat(i18n): scope Transloco whiteboard embarqué par la lib" \
  --body "Implémente la spec docs/superpowers/specs/2026-07-13-i18n-modules-scope-design.md. La lib porte son scope whiteboard ; les hosts ne recopient plus. Supersède pivot-ui #188."
```

- [ ] **Step 4 : Après merge → laisser `release.yml` publier la nouvelle version** (nécessaire pour que le shell la consomme en Partie B).

---

## PARTIE B — Shell `pivot-ui` (branche `fix/whiteboard-i18n-scope`, depuis `main`)

Repo : `pivot-ui`. Applique **son** `CLAUDE.md` (CI : `npx tsc --noEmit` + `npm run lint` + `npm run test:ci` + build prod).

### Task B1 : Retirer le sous-arbre `whiteboard` des catalogues globaux du shell

**Files:**
- Modify: `public/assets/i18n/fr.json`, `public/assets/i18n/en.json`

- [ ] **Step 1 : Créer la branche depuis main à jour**

```bash
cd pivot-ui && git checkout main && git pull origin main && git checkout -b fix/whiteboard-i18n-scope
```

- [ ] **Step 2 : Retirer le bloc `whiteboard`**

```bash
node -e '
const fs=require("fs");
for (const f of ["public/assets/i18n/fr.json","public/assets/i18n/en.json"]) {
  const d=JSON.parse(fs.readFileSync(f,"utf8")); delete d.whiteboard;
  fs.writeFileSync(f, JSON.stringify(d,null,2)+"\n"); console.log("nettoyé",f);
}
'
```

- [ ] **Step 3 : Commit**

```bash
git add public/assets/i18n/fr.json public/assets/i18n/en.json
git commit -m "$(printf 'fix(i18n): retire les clés whiteboard du shell (fournies par le scope lib)\n\nSupersède #188 : au lieu de recopier les clés, le shell les retire — la lib\n@pivot-platform/collaboratif-ui les porte via son scope Transloco.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task B2 : Test anti-régression — aucune clé de namespace module dans le shell

**Files:**
- Create: `src/app/core/i18n/no-module-scope-leak.spec.ts`

- [ ] **Step 1 : Écrire le test**

```ts
// src/app/core/i18n/no-module-scope-leak.spec.ts
import fr from '../../../../public/assets/i18n/fr.json';
import en from '../../../../public/assets/i18n/en.json';

// Namespaces de modules : ownés par les libs de module via leur scope Transloco,
// jamais recopiés dans le catalogue global du shell.
const MODULE_SCOPES = ['whiteboard', 'pilotage', 'agilite', 'collaboratif'];

describe('catalogue i18n global du shell', () => {
  for (const catalog of [{ name: 'fr', data: fr }, { name: 'en', data: en }]) {
    for (const scope of MODULE_SCOPES) {
      it(`${catalog.name}.json ne contient pas le namespace de module "${scope}"`, () => {
        expect((catalog.data as Record<string, unknown>)[scope]).toBeUndefined();
      });
    }
  }
});
```

- [ ] **Step 2 : Vérifier l'import JSON (activer `resolveJsonModule` si absent)**

Run: `grep -q '"resolveJsonModule": true' tsconfig.json || echo "AJOUTER resolveJsonModule:true dans tsconfig.json compilerOptions"`
Si absent, l'ajouter dans `tsconfig.json` `compilerOptions`.

- [ ] **Step 3 : Lancer le test — doit passer**

Run: `npx ng test frontend --watch=false --include='**/no-module-scope-leak.spec.ts'`
Expected : PASS (8 tests). Ils échoueraient si quelqu'un recopiait des clés de module dans le shell.

- [ ] **Step 4 : Commit**

```bash
git add src/app/core/i18n/no-module-scope-leak.spec.ts tsconfig.json
git commit -m "$(printf 'test(i18n): garde-fou — aucun namespace de module dans le catalogue shell\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
```

### Task B3 : Bumper la dépendance vers la lib publiée (gated par la publication Partie A)

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: la version de `@pivot-platform/collaboratif-ui` publiée après merge de la PR Partie A (> 0.2.0).

- [ ] **Step 1 : Récupérer la dernière version publiée**

Run: `npm view @pivot-platform/collaboratif-ui version` (relever la nouvelle version, ex. `0.3.0`).

- [ ] **Step 2 : Bumper et installer**

```bash
npm install @pivot-platform/collaboratif-ui@^<nouvelle-version>
```

> **Vérification locale avant publication** (facultatif, si la Partie A n'est pas encore mergée) : dans `pivot-collaboratif-ui`, `npm run build:collaboratif-ui && (cd dist/collaboratif-ui && npm pack)` puis dans `pivot-ui`, `npm install ../pivot-collaboratif-ui/dist/collaboratif-ui/pivot-platform-collaboratif-ui-*.tgz` — **ne pas committer** ce lien local, il ne sert qu'à valider le rendu.

- [ ] **Step 3 : CI complète + build prod**

Run:
```bash
npx tsc --noEmit && npm run lint && npm run test:ci && npm run build -- --configuration production
```
Expected : 0 erreur, tests verts, build prod OK.

- [ ] **Step 4 : Commit + push + PR + fermer #188**

```bash
git add package.json package-lock.json
git commit -m "$(printf 'chore(deps): bump collaboratif-ui vers la version à scope i18n embarqué\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
git push -u origin fix/whiteboard-i18n-scope
gh pr create --draft --base main --head fix/whiteboard-i18n-scope \
  --title "fix(i18n): le shell ne porte plus l'i18n whiteboard (scope lib)" \
  --body "Retire les clés whiteboard.* du catalogue global (fournies par le scope de @pivot-platform/collaboratif-ui). Supersède et remplace #188. Garde-fou anti-régression ajouté."
gh pr close 188 --comment "Remplacée par la solution pérenne (scope Transloco embarqué par la lib) — voir cette PR."
```

---

## PARTIE C — Formalisation `pivot-docs` (branche `docs/adr-i18n-modules-scope`, depuis `main`)

Repo : `pivot-docs`. CI : `npm run lint` (markdownlint + cspell + naming + taxonomie) + `npm run build`.

### Task C1 : ADR-029 + enabler + skill

**Files:**
- Create: `docs/adr/ADR-029-i18n-modules-scope-transloco.md`
- Create: `docs/backlog/EPIC-module-system/ENABLERS/en-i18n-scope-modules.md`
- Modify: `docs/adr/README.md` (index ADR), `docs/backlog/EPIC-module-system/README.md` (référence l'enabler)

- [ ] **Step 1 : Créer la branche**

```bash
cd pivot-docs && git checkout main && git pull origin main && git checkout -b docs/adr-i18n-modules-scope
```

- [ ] **Step 2 : Rédiger l'ADR-029** (suivre le gabarit `docs/adr/0000-template.md` s'il existe, sinon les ADR voisins) : Contexte (couplage host↔lib, clés brutes, #188 stopgap), Décision (chaque lib module owne son scope Transloco via `provideXxxUi()`, traductions embarquées `InlineLoader`, hosts ne recopient jamais), Conséquences (dérive impossible, zéro config host, la lib doit être republiée pour propager), Alternatives écartées (assets copiés, i18n backend).

- [ ] **Step 3 : Créer l'enabler** `en-i18n-scope-modules.md` (gabarit Enabler du `docs/backlog/README.md`) rattaché à **E03 Système de modules** : Type architecture ; Objectif (convention i18n des modules) ; Critères de complétion (lib porte son scope ; test anti-fuite côté host ; ADR-029 publié) ; `Stage: ⬜` ; `Phase: Socle` (transverse au système de modules). Ajouter la ligne d'enabler dans `EPIC-module-system/README.md` et l'ADR dans `docs/adr/README.md`.

- [ ] **Step 4 : Lint + build**

Run: `npm run lint && npm run build`
Expected : 0 erreur. Ajouter à `cspell.json` les termes techniques légitimes (`Transloco`, `scope`, `InlineLoader`…) s'ils manquent. Vérifier que les noms de fichiers respectent `check-docs-naming.mjs` (ADR : `ADR-0XX-...`, enabler : `en-...`).

- [ ] **Step 5 : Commit + push + PR**

```bash
git add docs/adr/ADR-029-i18n-modules-scope-transloco.md docs/adr/README.md docs/backlog/EPIC-module-system/ENABLERS/en-i18n-scope-modules.md docs/backlog/EPIC-module-system/README.md
# + cspell.json si modifié
git commit -m "$(printf 'docs(adr): ADR-029 i18n des modules — scope Transloco embarqué par lib\n\n+ enabler E03. Formalise la convention : chaque lib module owne son scope, les\nhosts ne recopient jamais.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01NBmcMYhDRz66JB4pyhbYgs')"
git push -u origin docs/adr-i18n-modules-scope
gh pr create --draft --base main --head docs/adr-i18n-modules-scope \
  --title "docs(adr): ADR-029 i18n des modules — scope Transloco embarqué par lib" \
  --body "Formalise la convention i18n des modules (scope embarqué par lib) + enabler E03. Implémentée en référence par pivot-collaboratif-ui feat/i18n-module-scope."
```

---

## Ordre d'exécution & dépendances inter-repos

1. **Partie A** (lib) en premier — self-contained, testable via harnais + tests unitaires. Merge → publication de la lib.
2. **Partie C** (docs) — indépendante, peut être menée en parallèle de A.
3. **Partie B** (shell) — B1/B2 indépendants ; **B3 (bump version) gated** par la publication de A. Fermer #188 à l'ouverture de la PR B.

## Definition of Done (rappel spec §9)

- [ ] Lib enregistre le scope `whiteboard` + embarque fr/en (Tasks A1–A3).
- [ ] Éditeur rendu sans clé brute — harnais (A5) + test de résolution (A4).
- [ ] Shell sans clé `whiteboard.*` + garde-fou vert (B1/B2).
- [ ] Bump lib + build prod shell OK (B3).
- [ ] ADR-029 + enabler + skill (C1).
- [ ] #188 fermée (B3 Step 4).
- [ ] CI verte sur les 3 repos.
