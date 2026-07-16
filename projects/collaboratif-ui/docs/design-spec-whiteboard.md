# Charte de design — Tableau blanc collaboratif PIVOT

> **Objectif produit** : clone de qualité de **Klaxoon** / **PouetPouet** (whiteboard type Miro/FigJam).
> **Stack imposée (ADR-007)** : Angular 22 + Angular CDK (comportement/a11y) + **SCSS BEM custom**. Aucune lib visuelle tierce.
> **Statut de cette charte** : spec d'implémentation pilotant les agents frontend. Valeurs concrètes (px, hex, ms, poids) — implémentables sans redemander.
>
> **Périmètre technique**
> - Design tokens globaux : `pivot-design-system/src/scss/tokens.scss` (charte v3 violet/magenta).
> - Module whiteboard : `pivot-collaboratif-ui/projects/collaboratif-ui/src/lib/whiteboard/`.
> - Package DS : `@pivot-platform/design-system` — **pas encore consommé** par `collaboratif-ui` (reset minimal auto-contenu aujourd'hui). Cette charte définit une **couche de tokens whiteboard `--wb-*`** qui *dérive* des tokens DS (référence `var(--color-brand-*)`, etc.) et sera branchée quand le package sera publié. En attendant, les valeurs `--wb-*` sont écrites en dur avec le hex DS en commentaire, pour un basculement mécanique.

---

## 0. Constat — écart entre l'état actuel Pivot et la cible PouetPouet

### 0.1 Ce que fait déjà bien l'état avancé (captures v0.32.2)
- Toolbar flottante verticale à gauche, boutons icônes arrondis, outil actif en aplat indigo, poignée de déplacement (points) en haut, chevron de repli, bouton `+` indigo en bas + hint « Échap ».
- Pilule de zoom bas-droite : `fit | − | 100 % | +`.
- Barre d'en-tête board : retour, titre, avatar + `1/1`, import/export, partage, paramètres, undo/redo/reset, `Vote ▾`, `Timer`, `Session` (aplat indigo).
- Sélecteur de couleurs : popover blanc, **2 rangées × 7 pastels** + « Personnalisée » (pastille dégradé + chevron).
- Grille de points, surfaces claires.

### 0.2 Écarts bloquants à corriger (le « AI slop » et les incohérences actuelles)
| # | Problème observé dans le SCSS actuel | Cible |
|---|--------------------------------------|-------|
| G1 | **3 accents concurrents non tokenisés** : `#2196f3` (bleu, focus/sélection/resize), `#6366f1` (indigo, toolbar active/connecteur), brand violet `#6d28d9` (DS, jamais utilisé sur le board). | **Un seul accent** aligné marque : violet `--wb-accent` = `#6d28d9` (brand-600), hover/active dérivés. Sélection, outil actif, focus, poignées, curseurs par défaut → tous sur ce ramp. |
| G2 | Couleurs codées en dur partout (`#fafafa`, `#d4d4d8`, `#e0e0e0`, `#111827`…), aucun token. | Couche `--wb-*` centralisée, aucun hex nu dans les composants. |
| G3 | Note (sticky) trop plate dans l'ancien état (v0.6.0) : ombre à peine visible, pas de bande d'en-tête. | Ombre douce à 2 couches + coins 8px + micro-lift au hover + halo de sélection net. |
| G4 | Focus-ring `#2196f3` partout → jure avec la marque violette et n'a pas d'offset homogène. | Focus-ring unique `--wb-focus` = `#6d28d9`, `outline: 2px`, `outline-offset: 2px`. |
| G5 | Densité / rythme d'espacement non systématisés (mélange `px` et `rem`, valeurs 6/8/10/16 arbitraires). | Échelle 4-pt (voir §2.4). |
| G6 | Fonctions Klaxoon manquantes ou embryonnaires : **minimap absente**, guides d'alignement non stylés (snap existe à `ALIGN_SNAP_PX=6` mais pas de rendu spécifié), dot-voting/timer/frames présents mais visuellement hétérogènes (bleu `#3b82f6`, indigo `#6366f1`, vert `#16a34a`…). | Unifier sur le ramp marque + tokens sémantiques ; ajouter minimap + guides d'alignement stylés. |

### 0.3 Tension à arbitrer explicitement : radius
La **charte DS v3 est « net et carré »** (`--radius-sm/md = 2px`, `lg/xl = 3px`). Le look Klaxoon/PouetPouet repose au contraire sur des **cartes à coins franchement arrondis** (6–10px) et une **toolbar/pilule très arrondies** (10–14px). 

**Arbitrage retenu** : le canvas est un **contexte visuel distinct** du reste de l'app (comme l'est un éditeur graphique). On **n'applique pas** les radii DS aux objets du board. On définit des radii whiteboard dédiés (`--wb-radius-*`, §2.5) qui assument l'arrondi. Les **chrome-panels** (modales, barres, popovers) qui côtoient le reste de l'app peuvent rester plus proches du DS (6–8px) sans casser la cohérence. Cette exception est **documentée ici** et ne doit pas être « corrigée » vers 2px par un agent qui appliquerait la charte DS aveuglément.

---

## 1. Direction esthétique

Cinq principes. Le board doit se lire comme un **atelier clair et calme** où la couleur vient du contenu (les pastels des cartes), pas du châssis.

1. **Canvas clair, châssis discret, couleur au contenu.** Le fond est un blanc légèrement froid, la grille de points est présente mais quasi subliminale. Toolbar, pilule, en-tête sont en blanc/neutre. La seule couleur « vive » du châssis est l'accent violet marque, dosé (outil actif, sélection, CTA). Les aplats colorés appartiennent aux cartes.

2. **Accent unique, dérivé de la marque.** Un seul violet (`#6d28d9`) porte l'ensemble des états système : outil actif, halo de sélection, poignées de resize, focus clavier, ghost de connexion, curseur local. Zéro bleu `#2196f3`, zéro indigo `#6366f1` résiduel. C'est ce qui sépare un clone « générique » d'un produit qui a une identité.

3. **Cartes tactiles : ombre douce + coin arrondi + réaction physique.** Chaque objet manipulable a une élévation faible au repos (ombre 2 couches très diffuses), se soulève au drag (élévation + légère montée), et se pose avec un halo net à la sélection. Le mouvement doit être **court et amorti** (150–200ms), jamais rebondissant sur les objets (le rebond `cubic-bezier(.34,1.4,.64,1)` est réservé aux moments d'atelier : overlay timer).

4. **Motion subtile et fonctionnelle.** L'animation *informe* : apparition d'une carte, snap-to-grid, guides d'alignement qui clignent, curseurs distants qui glissent. Pas d'animation décorative ambiante. `prefers-reduced-motion` coupe tout sauf les transitions d'état instantanées.

5. **Densité maîtrisée, rythme 4-pt.** Espacements sur une grille de 4px. La toolbar respire (gap 8–10px), les popovers ont des marges généreuses (16px), rien n'est collé. La typo est Fira Sans (héritée DS), tailles ≤ 16px sur le châssis pour laisser la vedette au contenu.

**Ce qu'on évite (anti « AI slop ») :**
- ❌ Le trio de fonds génériques (crème + serif + terracotta / near-black + acid-green / broadsheet hairlines). Ici c'est un **outil**, pas une landing.
- ❌ Dégradés violets sur les grandes surfaces du board (le dégradé marque `--auth-gradient` reste réservé au logo/navbar/auth, **jamais** en fond de canvas ou de panneau — règle charte DS).
- ❌ Ombres portées lourdes/dures, glow néon, glassmorphism partout (le blur est réservé à l'overlay timer plein écran).
- ❌ Multiplication des accents. Un seul violet système + les tokens sémantiques (succès/alerte/info) pour le statut uniquement.
- ❌ Icônes emoji dans la toolbar (état v0.6.0) → icônes SVG monochromes 20px, trait 1.75px.

---

## 2. Design tokens

> Format : variables CSS custom. **Placement** : un fichier `whiteboard/_wb-tokens.scss` importé une fois par le composant hôte (`board-page`), scope `.wb-page` (ou `:root` si le module est seul). Chaque `--wb-*` référence un token DS quand il existe ; sinon valeur littérale + commentaire de provenance.

### 2.1 Accent système (marque) — remplace tout `#2196f3` / `#6366f1`
```scss
--wb-accent:            #6d28d9; // = --color-brand-600 (accent système du board)
--wb-accent-hover:      #5b1fb4; // = --color-brand-700
--wb-accent-active:     #4e1a98; // = --color-brand-800
--wb-accent-weak:       #ede4fd; // = --color-brand-100 (fond outil actif, chip)
--wb-accent-weak-2:     #dcc9fb; // = --color-brand-200 (bordure outil actif)
--wb-accent-ghost:      rgba(109, 40, 217, .55); // ghost de connexion / lasso stroke
--wb-accent-ghost-fill: rgba(109, 40, 217, .08); // remplissage lasso / marquee
--wb-focus:             #6d28d9; // focus-ring clavier (= accent)
```

### 2.2 Canvas & grille
```scss
--wb-canvas-bg:      #fbfaff; // blanc froid légèrement violacé (proche --surface-bg #f6f3fd mais + clair)
--wb-grid-dot:       #d8d4e4; // point de grille au repos (teinté violet, ~ --color-gray-300 désaturé)
--wb-grid-dot-strong:#c4bed8; // point renforcé sur les niveaux de zoom élevés
--wb-guide:          #db2777; // = --color-accent (magenta) — guides d'alignement (contraste max vs violet système)
--wb-frame-band:     #f3eefc; // = --color-gray-100 — bande d'en-tête de frame
```
> Choix : la **grille reste neutre-violet froid**, distincte de l'accent. Les **guides d'alignement sont magenta** (`--color-accent`) pour ne jamais se confondre avec la sélection violette ni avec les bords de cartes.

### 2.3 Surfaces châssis (toolbar, panneaux, pilule, en-tête)
```scss
--wb-surface:          #ffffff; // = --surface-card
--wb-surface-hover:    #f6f3fd; // = --color-gray-50 (hover bouton châssis)
--wb-surface-sunken:   #f3eefc; // = --color-gray-100 (fonds de champ, stats)
--wb-border:           #e9e1f7; // = --color-gray-200 (bordures 1px châssis)
--wb-border-strong:    #d0bff0; // = --color-gray-300
--wb-ink:              #1a1230; // = --color-gray-900 (texte fort)
--wb-ink-muted:        #756693; // = --color-gray-500 (labels, méta ; AA sur blanc 5.15:1)
--wb-ink-faint:        #a99bc7; // = --color-gray-400 (placeholder, hints)
```

### 2.4 Échelle d'espacement (4-pt)
```scss
--wb-space-1: 4px;
--wb-space-2: 8px;
--wb-space-3: 12px;
--wb-space-4: 16px;
--wb-space-5: 20px;
--wb-space-6: 24px;
--wb-space-8: 32px;
```

### 2.5 Rayons (whiteboard — assument l'arrondi, cf. §0.3)
```scss
--wb-radius-card:    8px;  // sticky / texte / image / lien / tableau
--wb-radius-shape:   6px;  // formes rectangulaires
--wb-radius-control: 10px; // boutons toolbar, boutons en-tête
--wb-radius-panel:   14px; // toolbar conteneur, popovers, pilule zoom, cartes de panneau
--wb-radius-pill:    9999px; // avatars, badges, dots de vote, pilule ronde
--wb-radius-chip:    6px;  // chips / tags
```

### 2.6 Ombres (elevation)
```scss
--wb-elev-0: none;
--wb-elev-1: 0 1px 3px rgba(26, 18, 48, .10), 0 1px 2px rgba(26, 18, 48, .06); // carte au repos
--wb-elev-2: 0 4px 10px rgba(26, 18, 48, .12), 0 2px 4px rgba(26, 18, 48, .06); // toolbar, pilule, hover carte
--wb-elev-3: 0 10px 24px rgba(26, 18, 48, .16), 0 4px 8px rgba(26, 18, 48, .08); // popovers, carte en drag
--wb-elev-4: 0 20px 48px rgba(26, 18, 48, .22); // modales, overlays
--wb-halo-select: 0 0 0 2px var(--wb-accent); // halo de sélection (remplace box-shadow #2196f3)
--wb-halo-select-soft: 0 0 0 2px var(--wb-accent), 0 4px 12px rgba(109, 40, 217, .20); // sélection + lift
```
> Teinte des ombres : **encre violette** `rgba(26,18,48,·)` (= `--color-navy-900`) plutôt que noir pur — cohérent avec la marque, plus doux que `rgba(0,0,0,·)` actuellement en dur.

### 2.7 Typographie
```scss
--wb-font:       'Fira Sans', 'Segoe UI', Arial, sans-serif;       // = --font-sans
--wb-font-mono:  'Fira Mono', 'SFMono-Regular', Consolas, monospace; // = --font-mono (zoom %, timer, données)

// Tailles (châssis ≤ 16px ; contenu carte = libre, défaut 14px)
--wb-text-hint:   10px; // hints (« Échap »), sitename lien
--wb-text-xs:     11px; // méta, description lien, chips
--wb-text-sm:     12px; // labels toolbar/panneaux, cellules tableau
--wb-text-13:     13px; // boutons en-tête, titre lien
--wb-text-base:   14px; // texte de carte par défaut, corps panneaux
--wb-text-md:     16px; // titre board
--wb-text-lg:     18px; // titres de panneaux (vote, connecteur)
--wb-text-card:   16px; // texte sticky par défaut (lisible au zoom 100 %)

// Poids
--wb-fw-regular: 400;
--wb-fw-medium:  500;
--wb-fw-semibold:600;
--wb-fw-bold:    700;

// Interlignage
--wb-lh-tight: 1.25; // titres
--wb-lh-body:  1.4;  // corps carte / panneaux
```

### 2.8 Z-index (échelle explicite, remplace les 5/10/100/150 épars actuels)
```scss
--wb-z-grid:        0;
--wb-z-connections: 1;
--wb-z-frames:      2;   // frames sous les cartes
--wb-z-cards:       3;
--wb-z-card-drag:   4;   // carte soulevée
--wb-z-guides:      5;   // guides d'alignement
--wb-z-presence:    6;   // curseurs distants (décoratif, pointer-events:none)
--wb-z-marquee:     7;   // lasso de sélection
--wb-z-chrome:      10;  // toolbar, pilule zoom, en-tête, minimap
--wb-z-popover:     20;  // color picker, connector-style, vote panel flottant
--wb-z-drawer:      30;  // drawer activités
--wb-z-overlay:     150; // overlay timer plein écran
--wb-z-modal:       200; // modales (settings, template gallery)
```

### 2.9 Motion (durées & easings)
```scss
--wb-dur-instant: 80ms;   // suivi curseur distant, retour pressed
--wb-dur-fast:    120ms;  // hover, opacity poignées
--wb-dur-base:    160ms;  // apparition carte, lift au drag, snap
--wb-dur-slow:    240ms;  // panneaux entrants, barres de vote
--wb-dur-overlay: 400ms;  // fade overlay timer

--wb-ease-standard: cubic-bezier(.2, 0, 0, 1);      // entrées/sorties d'état (Material-like, calme)
--wb-ease-out:      cubic-bezier(0, 0, .2, 1);       // apparitions
--wb-ease-in:       cubic-bezier(.4, 0, 1, 1);       // disparitions
--wb-ease-spring:   cubic-bezier(.34, 1.4, .64, 1);  // RÉSERVÉ moments d'atelier (carte timer). Jamais sur objets du board.
```

### 2.10 Palette 14 pastels des cartes (source de vérité)
> Déjà définie dans `whiteboard/model/colors.ts` (`BASE_COLORS`). **Ne pas dupliquer** : ces hex sont la source. Reprise ici pour le rendu du sélecteur (2 rangées × 7).

| Rang 1 | Hex | Rang 2 | Hex |
|-------|-----|--------|-----|
| Rouge | `#FCA5A5` | Bleu ciel | `#7DD3FC` |
| Orange | `#FDBA74` | Bleu | `#93C5FD` |
| Ambre | `#FCD34D` | Indigo | `#A5B4FC` |
| Jaune | `#FEF08A` ← **défaut sticky** | Violet | `#C4B5FD` |
| Vert | `#86EFAC` | Rose | `#F9A8D4` |
| Turquoise | `#5EEAD4` | Gris doux | `#CBD5E1` |
| Ciel | `#7DD3FC` | Noir | `#111827` |
| | | Blanc | `#FFFFFF` |

Ordre exact d'affichage (14, lu de gauche à droite, 2 rangées de 7) :
```
Rang 1 : #FCA5A5  #FDBA74  #FCD34D  #FEF08A  #86EFAC  #5EEAD4  #7DD3FC
Rang 2 : #93C5FD  #A5B4FC  #C4B5FD  #F9A8D4  #CBD5E1  #111827  #FFFFFF
```
- **Encre auto** : la couleur de texte (noir `#111827` / blanc `#FFFFFF`) est choisie par `accessibleInkColor()` (WCAG AA ≥ 4.5:1) — déjà implémenté, ne pas hardcoder.
- **Bande d'en-tête** : `headerTint()` assombrit/éclaircit de 5% — déjà implémenté.
- **Swatch blanc** : bordure `1px solid --wb-border` obligatoire (sinon invisible sur popover blanc).
- **Défaut sticky** : `#FEF08A` (jaune). **Défaut forme** : `#A5B4FC` (indigo pastel). **Défaut label** : `#111827`.

### 2.11 Couleurs sémantiques (statut uniquement — jamais décoratif)
```scss
--wb-success:  #0e9f6e; // = --color-success (compteur vote positif, timer terminé)
--wb-success-bg: #e3f6ee; // = --color-success-light
--wb-warning:  #f59e0b; // = --color-warning
--wb-danger:   #dc2626; // = --color-error (reset, stop vote, suppression)
--wb-danger-bg:#fde4e6; // = --color-error-light
--wb-danger-border:#f5b8be; // = --color-error-border
--wb-info:     #0284c7; // = --color-info (bleu distinct du violet système — infobulles neutres)
```

### 2.12 Curseurs distants — palette participants (déterministe)
8 teintes vives, contraste ≥ 3:1 sur canvas clair, distinctes entre elles. Assignées par hash d'`userId` (comme `groupColor()`).
```scss
--wb-user-1: #6d28d9; // violet marque
--wb-user-2: #db2777; // magenta
--wb-user-3: #0e9f6e; // vert
--wb-user-4: #0284c7; // bleu
--wb-user-5: #f59e0b; // ambre
--wb-user-6: #dc2626; // rouge
--wb-user-7: #7c3aed; // violet clair
--wb-user-8: #0891b2; // cyan
```

---

## 3. Specs composant par composant

Convention : dimensions en px ; états = `default / hover / active / focus-visible / selected / disabled`. Tout élément interactif = cible ≥ 32×32px, focus-ring `outline: 2px solid var(--wb-focus); outline-offset: 2px`, `aria-label` requis quand l'icône est seule.

### 3.1 Toolbar flottante verticale — `floating-toolbar`
**Layout** : colonne, ancrée `top:16px; left:16px`, `z: --wb-z-chrome`.
- Conteneur : `padding: --wb-space-2 (8px)`, `gap: --wb-space-2`, `background: --wb-surface`, `border: 1px solid --wb-border`, `border-radius: --wb-radius-panel (14px)`, `box-shadow: --wb-elev-2`, `user-select: none`.
- Largeur intrinsèque : ~52px (bouton 36 + padding 8×2).

**Structure (haut → bas)** :
1. **Poignée de déplacement** : grille 2×2 de points `--wb-ink-faint`, hauteur 16px, `cursor: grab` (→ `grabbing` en drag). Permet de repositionner la toolbar.
2. **Chevron de repli** : bouton 36×36, chevron `^`. Replié → n'affiche que poignée + chevron + `+`. Transition largeur/opacité `--wb-dur-base --wb-ease-standard`.
3. **Groupe outils** : Sélection, Main (pan), Texte, Sticky, Frame, Tableau, Image, Forme, Crayon, Lien, Connecteur. Séparateurs = `border-top: 1px solid --wb-border` + `padding-top: --wb-space-2` entre groupes logiques.
4. **Groupe couleurs** (contextuel, quand un outil coloré est actif) : rangée `flex-wrap`, largeur 84px, swatches 18×18 (§3.11).
5. **Bouton `+` primaire** : 36×36, `background: --wb-accent`, icône blanche, `border-radius: --wb-radius-control`. Ouvre le menu d'insertion rapide.
6. **Hint « Échap »** : `--wb-text-hint (10px)`, `--wb-ink-faint`, centré sous le `+`. Visible seulement quand un popover/outil modal est ouvert (indique la sortie).

**Bouton outil `.wb-toolbar__btn`** (36×36) :
| État | Style |
|------|-------|
| default | `background: transparent; border: 1px solid transparent; border-radius: --wb-radius-control (10px)`; icône SVG 20px trait 1.75px couleur `--wb-ink-muted` |
| hover | `background: --wb-surface-hover` ; icône `--wb-ink` |
| active (outil sélectionné) | `background: --wb-accent-weak; border-color: --wb-accent-weak-2`; icône `--wb-accent` |
| active **fort** (variante pleine, style capture) | `background: --wb-accent`; icône blanche — *option retenue pour l'outil sélection par défaut, cf. capture* |
| focus-visible | `outline: 2px solid --wb-focus; outline-offset: 2px` |
| disabled | `opacity: .4; cursor: not-allowed` |

**A11y** : `role="toolbar"`, navigation flèches (CDK `FocusKeyManager` vertical), chaque bouton `aria-pressed` pour l'outil actif, `aria-label` explicite (« Note autocollante », « Connecteur »…). `input[type=file]` visuellement masqué mais présent/labellé (déjà fait).

**Migration depuis l'existant** : remplacer `#6366f1`→`--wb-accent`, `#e0e7ff`→`--wb-accent-weak`, `#e0e0e0`→`--wb-border`, `#2196f3`(focus)→`--wb-focus`, radius `12px`→`--wb-radius-panel`, `8px`(btn)→`--wb-radius-control`.

### 3.2 Carte / sticky — `board-card`
**Dimensions** : min `150×110` (`MIN_W/MIN_H`), défaut nouveau sticky `180×140` (`DEFAULT_CARD_*`). Position absolue, `touch-action:none; user-select:none`.

**Corps `.wb-card__body`** :
- `border-radius: --wb-radius-card (8px)` ; `overflow: hidden` ; `box-shadow: --wb-elev-1`.
- Fond = couleur pastel choisie ; texte = encre auto (`accessibleInkColor`).
- **Bande d'en-tête** (optionnelle, style PouetPouet) : bande de 22px en haut, couleur `headerTint(fond)`, sert de zone de préhension (drag) — évite de déplacer en cliquant dans le texte.

| État | Style |
|------|-------|
| repos | `box-shadow: --wb-elev-1` |
| hover | `box-shadow: --wb-elev-2` ; poignées de connexion (`__connect`) passent `opacity: 0→1` en `--wb-dur-fast` |
| en drag | `box-shadow: --wb-elev-3` ; `transform: translateY(-1px) scale(1.01)` ; `z: --wb-z-card-drag` |
| selected | `box-shadow: --wb-halo-select` (`0 0 0 2px --wb-accent`) ; poignées de resize visibles |
| edit (inline) | textarea plein cadre, `background: transparent`, `font: inherit`, caret `--wb-accent` |
| locked | `cursor: default` ; cadenas `__lock` visible ; resize/edit désactivés |
| focus-visible (hôte) | `outline: 2px solid --wb-focus; outline-offset: 2px` |

**Placeholder d'édition** : `--wb-ink-faint`, texte « Écrivez… » (i18n `whiteboard.card.placeholder`).

**Poignées de resize `.wb-card__resize`** (8 poignées) : 10×10, `background: --wb-surface`, `border: 1.5px solid --wb-accent` (remplace `#2196f3`), `border-radius: 2px`, positionnées à `-5px`. Curseurs directionnels (`nwse/ns/nesw/ew`). Visibles seulement si `selected` et `!locked`. `:focus-visible` ring accent offset 1px. Chaque poignée `aria-label` (« Redimensionner coin haut-gauche »).

**Poignées de connexion `.wb-card__connect`** (4 : N/E/S/W) : 12×12 rond, `background: --wb-accent`, `border: 2px solid --wb-surface`, `cursor: crosshair`, `opacity:0` → `1` au hover carte, transition `--wb-dur-fast`.

**Cadenas `.wb-card__lock`** : coin haut-droit `top:-8px; right:-8px`, icône 12px `--wb-ink-muted`.

**Éditeur distant `.wb-card__remote-editor`** : badge `top:-18px`, `background: couleur du participant` (pas `#111827` en dur), texte blanc, `--wb-text-hint`, `border-radius: --wb-radius-chip`. Affiche le nom de qui édite.

**Chips `.wb-card__chip`** (tags) : `--wb-text-hint`, `padding: 1px 5px`, `background: --wb-accent-weak`, `color: --wb-accent-active`, `border: 1px solid --wb-accent-weak-2`, `border-radius: --wb-radius-chip`.

### 3.3 Carte texte / label — `board-card` (types `text`, `label`)
- **Texte** : pas de fond ni d'ombre par défaut (`--shape` variante : `box-shadow:none; background:transparent`), padding `--wb-space-2`, `white-space: pre-wrap; word-break: break-word`.
- **Label** : `background: transparent`, largeur min `MIN_LABEL_W=60`. En édition : `background: rgba(255,255,255,.85)` pour lisibilité sur fond chargé. Couleur texte = `DEFAULT_LABEL_COLOR #111827` (ou custom), passée par `accessibleTextColorFor()`.

### 3.4 Forme — `board-card` (type `shape`) + picker de remplissage
- Min `80×80` (`SHAPE_MIN`), `border-radius: --wb-radius-shape (6px)` pour rectangles.
- SVG plein cadre (`object-fit: contain`). Remplissage = pastel ; contour = variante plus foncée (dériver via `headerTint` ou `--wb-accent` pour contour neutre).
- **Swatch « sans remplissage »** `.wb-toolbar__swatch--none` : fond blanc + slash diagonal. Remplacer le rouge `#d0362b` en dur par `--wb-danger` pour cohérence (slash = « aucun »).

### 3.5 Image — `board-card` (type `image`)
- Cadre `--wb-radius-card`, `overflow:hidden`, image `object-fit: contain` (défaut) ou `cover` (option « remplir »).
- **État chargement** : fond `--wb-surface-sunken` + spinner accent 20px. **Erreur** : icône image cassée + texte `--wb-ink-muted` « Image indisponible » (voix interface, pas d'excuse).
- Insertion via `input[type=file]` masqué de la toolbar (déjà câblé).

### 3.6 Lien (aperçu OpenGraph) — `board-card` (type `link`)
**Dimensions** : défaut `280×170` (`LINK_CARD_*`, plus large qu'un sticky pour l'aperçu).
- Conteneur `.wb-card__link` : colonne, `background: --wb-surface`, `--wb-radius-card`, `overflow:hidden`, `text-decoration:none`, `color: inherit`.
- **Image OG `.wb-card__link-image`** : `height: 55%`, `object-fit: cover`.
- **Corps** : titre 2 lignes (`--wb-text-13`, `--wb-fw-semibold`, `--wb-ink`, `-webkit-line-clamp:2`), description 2 lignes (`--wb-text-xs`, `--wb-ink-muted`), sitename (`--wb-text-hint`, `--wb-ink-faint`, `text-transform:uppercase; letter-spacing:.02em`).
- **Variante `--no-preview`** (pas d'OG) : centré, padding `--wb-space-2`, affiche l'URL + favicon.
- **États** : hover → `box-shadow: --wb-elev-2` ; focus-visible → `outline:2px solid --wb-focus; outline-offset:-2px`.
- **Chargement OG** : squelette (barres `--wb-surface-sunken` animées shimmer `--wb-dur-slow` alterné, coupé si reduced-motion).

### 3.7 Tableau — `board-card` (type `table`)
- `border-collapse: collapse`, `background: --wb-surface`, `font-size: --wb-text-sm (12px)`.
- Cellules `th/td` : `border: 1px solid --wb-border-strong`, `padding: 2px 6px`, `text-align:left`.
- En-têtes `th` : `background: --wb-surface-sunken`, `--wb-fw-semibold`.
- Cellule éditable focus : `outline: 2px solid --wb-accent; outline-offset:-2px` (remplace `#2196f3`).
- Input cellule `.wb-card__table-cell-input` : plein largeur, `outline:2px solid --wb-accent; outline-offset:-2px`, `background: --wb-surface`.
- Navigation clavier entre cellules : flèches + Tab (CDK), `role="grid"`.

### 3.8 Connecteur — `connection-line`
SVG projeté dans le layer parent. Styles configurables via `connector-style-panel` (§3.15).
- **Ligne `.wb-connection__line`** : `stroke: --wb-ink-muted` par défaut (ou couleur choisie), `stroke-width: 2`, `pointer-events:none`.
- **Styles de trait** : `solid` (défaut) ; `dashed` → `stroke-dasharray: 6 5` ; `dotted` → `stroke-dasharray: 1 6; stroke-linecap: round`.
- **Terminaisons** : `none` / `arrow-end` / `arrow-both`. Flèche = `marker` triangle 8px même couleur que le trait.
- **Halo (sélection/hover) `.wb-connection__halo`** : `stroke: --wb-accent; stroke-opacity: .25; stroke-linecap: round` ; largeur = `stroke-width + 6`. Remplace `#6366f1`.
- **Zone de hit `.wb-connection__hit`** : `stroke transparent`, `stroke-width: 12`, `pointer-events: stroke`, `cursor:pointer`. Focus-visible → halo accent `stroke-opacity:.35`.
- **Ghost de création `.wb-connect-ghost`** : `stroke: --wb-accent; stroke-width:2; stroke-dasharray: 4 4` (remplace `#6366f1`).
- **Label `.wb-connection__label`** : boîte `fill: --wb-surface` + `stroke: --wb-border`, texte `--wb-text-sm`, `fill: --wb-ink`. Double-clic pour éditer. Centré sur le trait.
- **A11y** : `role="button"` + `aria-label` (« Connexion de X vers Y »), focusable, Suppr pour retirer.

### 3.9 Frame / cadre — `frame-item`
Conteneur de regroupement, **sous** les cartes (`z: --wb-z-frames`), `pointer-events:none` sauf ses propres contrôles.
- **Bord** : `border: 2px dashed --wb-border-strong` (repos) ; `border-radius: --wb-radius-card` ; fond `rgba(26,18,48,.015)` (teinte encre très légère).
- **États** : `selected` → `border-color: --wb-accent` ; `active` (cadre « épinglé » qui capture les cartes déposées) → `border-style: solid`.
- **Header `.wb-frame__header`** : ancré `top:-26px`, hauteur 24px, `background: --wb-frame-band`, `border-radius: 6px 6px 0 0`, `padding: 0 8px`, titre `--wb-text-sm --wb-fw-semibold --wb-ink`, `cursor: grab` (déplace le frame + son contenu).
- **Titre éditable** : double-clic → input `background: rgba(255,255,255,.9)`, `--wb-radius-chip`.
- **Toggle « actif » `.wb-frame__active-toggle`** : icône épingle, `opacity:.5` → `1` quand `--on`. `aria-pressed`.
- **Poignées de resize** : identiques à la carte (§3.2), `border-color: --wb-accent`.
- **Numérotation** : si les frames représentent des étapes d'atelier, afficher un badge d'ordre `1,2,3…` dans le header (pastille accent) — **seulement** si l'ordre porte du sens (sinon pas de numéro décoratif).

### 3.10 Pilule de zoom + fit — `board-page` (bas-droite)
**Layout** : ancrée `bottom:16px; right:16px`, `z: --wb-z-chrome`.
- Conteneur pilule : `display:flex; align-items:center`, `height: 36px`, `background: --wb-surface`, `border:1px solid --wb-border`, `border-radius: --wb-radius-panel`, `box-shadow: --wb-elev-2`, `padding: 0 4px`, `gap: 2px`.
- **Bouton fit** (icône « ajuster ») 28×28, `--wb-radius-control` → recadre pour tout voir (`zoomToFit`).
- **Bouton `−`** 28×28.
- **Valeur %** : `--wb-font-mono`, `--wb-text-sm`, `--wb-ink`, largeur fixe 44px centrée, cliquable → reset 100 %. Bornes `MIN_ZOOM 0.1` → `MAX_ZOOM 3` (affiche 10 %→300 %).
- **Bouton `+`** 28×28.
- États boutons : hover `--wb-surface-hover` ; disabled (borne atteinte) `opacity:.4` ; focus-visible ring accent.
- **A11y** : chaque bouton `aria-label` (« Zoom avant », « Ajuster à l'écran »), valeur `aria-live="polite"`.

### 3.11 Sélecteur de couleurs (popover)
Ouvert depuis la toolbar (outil coloré actif) ou le menu contextuel d'une carte.
- Popover : `background: --wb-surface`, `--wb-radius-panel`, `box-shadow: --wb-elev-3`, `padding: --wb-space-3`, `z: --wb-z-popover`.
- **Grille pastels** : 2 rangées × 7, `gap: 6px`. Ordre exact §2.10.
- **Swatch** `.wb-toolbar__swatch` : 18×18 (dans la toolbar) / 24×24 (dans le popover contextuel, plus confortable), `border-radius: --wb-radius-pill`, `border: 2px solid --wb-surface`, `box-shadow: 0 0 0 1px --wb-border-strong`.
  - active → `box-shadow: 0 0 0 2px --wb-accent` (remplace `#2196f3`) + ring interne.
  - focus-visible → `outline: 2px solid --wb-focus; outline-offset: 1px`.
  - swatch blanc `#FFFFFF` → bordure `--wb-border` visible.
  - swatch noir `#111827` → ring de sélection reste visible (accent violet contraste OK).
- **« Personnalisée »** : ligne sous la grille, pastille dégradé arc-en-ciel 16px + label `--wb-text-sm` + chevron. Ouvre `input[type=color]` natif ; les récents sont mémorisés (`getRecentColors`, max 8) et affichés en 3ᵉ rangée quand présents.
- **A11y** : `role="listbox"`, chaque swatch `role="option"` + `aria-label` couleur (« Jaune ») + `aria-selected`. Navigation flèches (CDK).

### 3.12 Barre d'en-tête board — `board-page` (`.wb-page__topbar`)
**Layout** : `display:flex; align-items:center; gap: --wb-space-4`, `padding: --wb-space-2 --wb-space-4`, `background: --wb-surface`, `border-bottom: 1px solid --wb-border`, `flex: 0 0 auto`, hauteur ~48px.

**Zones (gauche → droite)** :
1. **Retour** : chevron `‹`, bouton 34×32.
2. **Titre** `.wb-page__title` : `--wb-text-md (16px) --wb-fw-semibold`, ellipsis. Double-clic → édition inline (input `--wb-radius-chip`, `border:1px solid --wb-accent`).
3. *(spacer `margin-left:auto`)*
4. **Présence** (§3.16) : avatars empilés + compteur `N/M` pages ou participants.
5. **Import / Export** : 2 boutons icône (télécharger / importer).
6. **Partage** : icône partage → ouvre `share-panel`.
7. **Paramètres** : icône engrenage → `board-settings-modal`.
8. **Séparateur** : `1px` vertical `--wb-border`, hauteur 20px.
9. **Undo / Redo / Reset** : 3 boutons icône. Undo/Redo `disabled` si historique vide (`HISTORY_LIMIT=30`). Reset → confirmation inline `.wb-page__reset-confirm` texte `--wb-danger` « Confirmer la réinitialisation ».
10. **Vote ▾** : bouton avec chevron → ouvre le panneau de vote (§3.13).
11. **Timer** : bouton icône horloge → lance le widget timer (§3.14).
12. **Session / Activités** : bouton **primaire plein** `background: --wb-accent`, texte blanc, icône lecture → ouvre le drawer d'activités (§ drawer `--activities` déjà présent : `width:320px`, `border-left`, `--wb-elev-4`).

**Bouton en-tête générique `.wb-page__btn`** :
| État | Style |
|------|-------|
| default | `min-width:34px; height:32px; padding:0 --wb-space-2(10px)`; `border:1px solid --wb-border-strong`; `border-radius: --wb-radius-control`; `background: --wb-surface`; `--wb-text-13` |
| hover | `background: --wb-surface-hover` |
| on/actif | `background: --wb-accent-weak; border-color: --wb-accent` (remplace `#e0e7ff/#6366f1`) |
| primaire (Session) | `background: --wb-accent; color:#fff; border-color: --wb-accent` ; hover `--wb-accent-hover` |
| disabled | `opacity:.4; cursor:not-allowed` |
| focus-visible | `outline:2px solid --wb-focus; outline-offset:1px` |

### 3.13 Panneau de vote (dot-voting) — `vote-results-panel` / lancement
**Lancement (config)** : depuis « Vote ▾ », mini-popover : nombre de gommettes par personne (défaut 3), vote anonyme on/off, cible (cartes / cartes d'un frame). CTA « Démarrer le vote » (`--wb-accent`).

**Pendant le vote** : chaque carte votable reçoit un compteur de gommettes en coin (pastille `--wb-radius-pill`, `background: --wb-accent`, texte blanc, `--wb-text-xs`). L'utilisateur clique une carte pour déposer/retirer une gommette ; budget restant affiché dans une barre flottante bas-centre.

**Panneau résultats `.wb-vote-results`** (drawer/popover) — **réaligner sur l'accent violet** (actuellement tout en `#3b82f6`) :
- Header : titre `--wb-text-lg --wb-fw-semibold --wb-ink`, résumé `--wb-text-13 --wb-ink-muted`, bouton fermer.
- **Stats** : 3 tuiles (`--wb-surface-sunken`, `--wb-radius-card`) — total votes, participants, cartes votées. Valeur `--wb-fw-bold`.
- **Liste classée** : items avec barre de progression (`background: --wb-border` → gagnant `--wb-accent-weak`), rang (pastille ; gagnant `background: --wb-accent; color:#fff`), pastille couleur de la carte, texte, badge « 1er » (`--wb-accent`), compteur `--wb-fw-bold`.
  - item `--winner` : `border-color: --wb-accent-weak-2; background: --wb-accent-weak` (remplace bleus `#bfdbfe/#eff6ff`).
- **Footer** : « Arrêter le vote » (danger : `border --wb-danger-border; color --wb-danger; hover bg --wb-danger-bg`) + « Fermer » (primaire `--wb-accent`).
- **Vide** : `.wb-vote-results__empty` « Aucun vote pour l'instant » (invitation à agir).
- **A11y** : `role="dialog"` (ou region), barres `aria-hidden`, chaque item annonce nom + nombre de votes.

### 3.14 Widget timer partagé — `timer-overlay` + mini-widget
Deux surfaces :
1. **Mini-widget flottant** (pendant le décompte) : pilule bas-centre, `background: --wb-surface`, `--wb-radius-panel`, `--wb-elev-2`, affiche `MM:SS` en `--wb-font-mono --wb-fw-bold`, anneau de progression circulaire `--wb-accent`, boutons pause/stop/+1min. Synchronisé temps réel (STOMP).
2. **Overlay de fin `timer-overlay`** (plein écran) — **conserver** l'animation d'atelier (c'est le moment fort autorisé) mais **tokeniser** :
   - Fond `rgba(248,248,255,.75)` + `backdrop-filter: blur(12px)` → garder ; c'est le seul blur du produit.
   - Carte : remplacer `linear-gradient(#6366f1,#7c3aed)` par `linear-gradient(135deg, --wb-accent, #7c3aed)` (violet marque → violet clair). 9rem×12rem, `border-radius: 1rem`, `--wb-elev-4`.
   - Animations `--wb-ease-spring` **autorisées ici** (card-in avec léger overshoot), fade `--wb-dur-overlay`.
   - Titre `--wb-ink`, sous-titre `--wb-ink-muted`.
   - Action « Terminé » : garder la sémantique succès mais via tokens (`--wb-success-bg` / `--wb-success`) au lieu de `#dcfce7/#22c55e`.
   - Respecte `prefers-reduced-motion` : pas d'overshoot, simple fade.
   - Cliquable pour fermer, `aria-label` « Fermer le minuteur ».

### 3.15 Panneau de style de connecteur — `connector-style-panel`
Popover `width: 14rem (224px)`, `background: --wb-surface`, `border:1px solid --wb-border`, `--wb-radius-panel`, `box-shadow: --wb-elev-3`, `padding: --wb-space-3 --wb-space-4 --wb-space-4`.
- Titre `--wb-text-13 --wb-fw-semibold --wb-ink`, séparateur `border-bottom:1px solid --wb-border`.
- **Champs** : style de trait (select : Trait / Pointillé / Tiret), terminaison (select : Aucune / Flèche / Double flèche), épaisseur (1–4px), couleur (`input[type=color]` 40×28, `--wb-radius-chip`), label (texte), case « afficher le label ».
- Contrôles : `border:1px solid --wb-border-strong`, `--wb-radius-chip`, focus `outline:2px solid --wb-accent` (remplace `#6366f1`).

### 3.16 Présence — avatars empilés + curseurs distants + overlay
**Avatars empilés (en-tête)** :
- Chaque avatar 28×28 rond (`--wb-radius-pill`), `border: 2px solid --wb-surface`, chevauchement `margin-left:-8px`. Initiales sur fond = couleur participant (`--wb-user-*`), texte blanc `--wb-text-xs --wb-fw-semibold`. Ou photo `object-fit:cover`.
- Au-delà de 5 : bulle `+N` (`background: --wb-surface-sunken; color: --wb-ink-muted`).
- Hover avatar → tooltip nom (`--tooltip-bg` DS, texte blanc, `--wb-text-sm`).
- `aria-label` liste « 3 participants : … ».

**Curseurs distants `whiteboard-presence`** (overlay SVG, `pointer-events:none`, `z: --wb-z-presence`) :
- Pointeur : flèche SVG remplie couleur participant, `stroke:#fff; stroke-width:1`.
- Label nom : `--wb-text-sm --wb-fw-semibold`, `paint-order:stroke; stroke:#fff; stroke-width:3px; stroke-linejoin:round` (halo blanc lisible sur tout fond), fond pilule couleur participant sous le texte.
- Mouvement : `transition: transform --wb-dur-instant linear` (glissé fluide, throttle `CURSOR_THROTTLE_MS=50`).
- `aria-hidden="true"` (décoratif).

**Overlay de présence / panneau participants `presence-panel`** : liste déroulable, ligne = avatar + nom + rôle (facilitateur/participant) + statut (actif/inactif point vert/gris). Fond `--wb-surface`, items hover `--wb-surface-hover`.

---

## 4. Micro-interactions & motion

| Interaction | Spécification |
|-------------|---------------|
| **Création de carte** | Apparition `--wb-dur-base --wb-ease-out` : `opacity 0→1` + `scale .96→1` depuis le point de dépôt. Focus auto sur le textarea. |
| **Drag d'objet** | `box-shadow` → `--wb-elev-3`, `transform: translateY(-1px) scale(1.01)`, `z: --wb-z-card-drag`. Retour à la pose en `--wb-dur-base --wb-ease-standard`. Pas d'`--wb-ease-spring` (réservé timer). |
| **Snap-to-grid** | À la pose, aimantation sur multiples de `DOT_SPACING=24`. Transition de calage `--wb-dur-fast --wb-ease-standard`. |
| **Guides d'alignement** | Quand un bord/centre s'aligne (seuil `ALIGN_SNAP_PX=6`), tracer une ligne `--wb-guide` (magenta), `1px`, `stroke-dasharray: 4 4` (ou plein), s'étendant sur toute la zone alignée. Apparition/disparition `--wb-dur-fast`. Afficher aussi les distances égales (badges optionnels). |
| **Zoom vers le curseur** | La molette zoome en gardant le point sous le curseur fixe (recalcul de l'origine du transform). Pas d'animation par cran (suivi direct) ; le zoom par bouton anime `--wb-dur-base`. |
| **Sélection lasso (marquee)** | `.wb-marquee` : `border: 1px solid --wb-accent; background: --wb-accent-ghost-fill` (remplace `rgba(33,150,243,.1)`). Suit le pointeur en direct, sélectionne à la relâche. |
| **Édition concurrente** | Badge éditeur distant (§3.2) à la couleur du participant ; le contour de la carte pulse brièvement (`box-shadow` couleur participant, 1 cycle `--wb-dur-slow`) quand un distant commence à éditer. |
| **Curseurs temps réel** | Glissé `--wb-dur-instant linear` (§3.16). |
| **Hover poignées de connexion** | `opacity 0→1` `--wb-dur-fast`. |
| **Ouverture popover / drawer** | Popover : `opacity 0→1 + translateY(4px→0)` `--wb-dur-base --wb-ease-out`. Drawer activités : `translateX(100%→0)` `--wb-dur-slow --wb-ease-standard`. |
| **Reduced-motion** | `@media (prefers-reduced-motion: reduce)` : supprimer transforms/scale/overshoot, conserver uniquement les changements d'`opacity` ≤ 100ms. Overlay timer → simple fade. |

---

## 5. Grille & canvas — `structured-canvas`

- **Fond** `.wb-surface` : `background: --wb-canvas-bg (#fbfaff)` (remplace `#fafafa`).
- **Grille de points** `.wb-layer` : `background-image: radial-gradient(circle, --wb-grid-dot 1px, transparent 1px)`, `background-size: 24px 24px` (= `DOT_SPACING`). Le point fait **1px** au zoom 100 %.
  - Comportement au zoom : la grille est portée par le `transform` du layer (elle scale avec le zoom — déjà le cas). **Amélioration** : sous ~40 % de zoom, masquer la grille (`opacity:0` `--wb-dur-fast`) pour éviter le moiré ; au-dessus de ~180 %, passer à `--wb-grid-dot-strong` pour garder la lisibilité. Implémentable via une classe `--dense`/`--sparse` posée selon le niveau de zoom.
- **Pan** : `.wb-surface--pan` → `cursor: grab` (`grabbing` pendant). Déclenché par outil Main, espace maintenu, ou clic molette.
- **Zoom** : molette (vers curseur, §4), boutons pilule, pincement tactile. Bornes `MIN_ZOOM 0.1` → `MAX_ZOOM 3`.
- **Bornes de canvas** : canvas quasi-infini ; garde-fou de recentrage via le bouton « fit » (`zoomToFit` recadre sur le bounding-box du contenu, marge 64px). Empêcher de se perdre dans le vide : si aucun contenu visible après un pan, afficher un bouton flottant discret « Revenir au contenu ».
- **Virtualisation** : au-delà de `VIRTUALIZE_THRESHOLD=100` cartes, ne rendre que les objets dans le viewport (déjà prévu).
- **Connexions `.wb-connections`** : layer SVG `pointer-events:none` sauf les traits.

**Minimap (grands boards) — à ajouter** :
- Ancrée `bottom:16px; left:16px` (opposée à la pilule zoom), `z: --wb-z-chrome`.
- Cadre ~180×120, `background: rgba(251,250,255,.9)`, `border:1px solid --wb-border`, `--wb-radius-panel`, `--wb-elev-2`, `padding:4px`.
- Rendu réduit : rectangles pastel = cartes (couleur réelle), rectangles pointillés = frames.
- **Viewport indicator** : rectangle `border:1.5px solid --wb-accent; background: --wb-accent-ghost-fill`, déplaçable pour naviguer.
- Repli : bouton « minimap » toggle ; masquée par défaut sous un seuil de cartes (ex. < 20).
- `aria-label` « Vue d'ensemble du tableau », navigable au clavier (flèches déplacent le viewport).

---

## 6. Roadmap de mise en œuvre priorisée

### Phase A — Quick wins visuels « ressembler à PouetPouet vite » (0 nouvelle feature, refactor SCSS)
> Objectif : cohérence de marque + finition. Faible risque, fort impact perçu.
1. **Créer `whiteboard/_wb-tokens.scss`** (§2) et l'importer dans `board-page`. 
2. **Éradiquer les hex nus** : remplacer `#2196f3`, `#6366f1`, `#fafafa`, `#d4d4d8`, `#e0e0e0`, `rgba(0,0,0,·)`, `#3b82f6`, `#e0e7ff`… par les `--wb-*`. Cibles prioritaires : `floating-toolbar`, `board-card`, `structured-canvas`, `board-page`, `frame-item`, `connection-line`, `connector-style-panel`, `vote-results-panel`, `presence`. **Un seul accent violet.**
3. **Ombres cartes** : passer `--wb-elev-1` au repos, `--wb-elev-2` au hover, `--wb-elev-3` au drag ; teinte encre violette. Halo sélection `--wb-halo-select`.
4. **Radii** : cartes 8px, toolbar/popovers/pilule 14px, boutons 10px (§2.5).
5. **Icônes toolbar** : SVG monochromes 20px trait 1.75px (retirer tout emoji résiduel).
6. **Focus-ring unifié** violet, offset homogène partout.
7. **Grille** : fond `--wb-canvas-bg`, points `--wb-grid-dot`.
8. **Micro-motion cartes** : apparition + lift au drag + marquee accent (§4).

**Definition of done Phase A** : capture du board indistinguable en « feel » de la cible v0.32.2 ; zéro hex nu hors `_wb-tokens.scss` et `colors.ts` ; audit contraste AA OK (déjà couvert par `accessibleInkColor`).

### Phase B — Complétude de l'atelier (parité fonctionnelle Klaxoon de base)
9. **Guides d'alignement stylés** (magenta, §4) + snap visuel.
10. **Pilule de zoom** complète avec `fit` + valeur mono cliquable (si pas déjà au niveau capture).
11. **Bande d'en-tête de carte** (préhension) + placeholders soignés.
12. **Aperçu OG lien** : squelette de chargement + variante no-preview propres.
13. **Réalignement vote/timer** sur l'accent (finir §3.13/3.14).

### Phase C — Facilitation avancée (le « plus » Klaxoon)
14. **Dot-voting complet** : dépôt de gommettes sur cartes + budget + panneau résultats classé (§3.13).
15. **Timer partagé** : mini-widget + overlay (§3.14), sync STOMP.
16. **Frames comme conteneurs d'activité** : capture des cartes déposées, numérotation d'étapes, navigation frame-à-frame.
17. **Minimap** (§5) pour grands boards.
18. **Présence riche** : avatars empilés + tooltips + panneau participants + rôle facilitateur (§3.16).
19. **Drawer Activités / Session** : templates d'atelier (brainstorm, rétro, matrice…).

### Ordre de dépendances
`A (tokens)` bloque tout le reste (tout le monde consomme `--wb-*`). `B.9` (guides) et `B.11` (bande) sont indépendants → parallélisables. `C.14` (vote) dépend de la sélection de cible (frames `C.16` aident mais pas requis). `C.17` (minimap) dépend de la virtualisation existante.

---

## Annexe — Table de correspondance « hex actuel → token » (pour le refactor Phase A)

| Hex en dur (actuel) | Fichier(s) | Remplacer par |
|---------------------|-----------|---------------|
| `#2196f3` (focus/sélection/resize/table) | board-card, structured-canvas, floating-toolbar, board-page, frame-item, vote-results | `--wb-focus` / `--wb-accent` / `--wb-halo-select` selon usage |
| `#6366f1` (toolbar active, connecteur, ghost) | floating-toolbar, connection-line, structured-canvas, connector-style-panel | `--wb-accent` |
| `#e0e7ff` (fond actif) | floating-toolbar, board-page | `--wb-accent-weak` |
| `#3b82f6` / `#2563eb` / `#bfdbfe` / `#eff6ff` / `#dbeafe` (vote) | vote-results-panel | `--wb-accent` / `--wb-accent-hover` / `--wb-accent-weak-2` / `--wb-accent-weak` |
| `#fafafa` (fond canvas) | structured-canvas | `--wb-canvas-bg` |
| `#d4d4d8` (points grille) | structured-canvas | `--wb-grid-dot` |
| `#e0e0e0` / `#eee` / `#e5e7eb` / `#e2e8f0` / `#f1f5f9` (bordures) | toolbar, board-page, panels | `--wb-border` |
| `#d0d0d0` / `#d1d5db` (bordures fortes) | board-card table, connector | `--wb-border-strong` |
| `rgba(0,0,0,.14)` etc. (ombres) | board-card, toolbar | `--wb-elev-*` |
| `#111827` (texte fort, badge distant) | board-card | `--wb-ink` / couleur participant pour le badge |
| `#374151` / `#4b5563` / `#64748b` (méta) | connection-line, board-card, panels | `--wb-ink-muted` |
| `#9ca3af` / `#94a3b8` (faint) | board-card, panels | `--wb-ink-faint` |
| `#dcfce7` / `#22c55e` / `#16a34a` (succès timer) | timer-overlay | `--wb-success-bg` / `--wb-success` |
| `#d0362b` (slash « sans remplissage ») | floating-toolbar | `--wb-danger` |
| `linear-gradient(#6366f1,#7c3aed)` | timer-overlay | `linear-gradient(135deg, --wb-accent, #7c3aed)` |
```
