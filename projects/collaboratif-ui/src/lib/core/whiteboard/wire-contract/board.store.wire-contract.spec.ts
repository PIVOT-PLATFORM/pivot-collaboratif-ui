import { describe, expect, it } from 'vitest';
import vocabulary from './vocabulary.json';

/**
 * EN08.5 — Couche 1 (vocabulaire) — Test de contrat wire, côté FRONTEND consommateur.
 *
 * Prévient la classe de bug S1–S4 (front et back divergent silencieusement sur le
 * vocabulaire wire STOMP) en comparant le vocabulaire RÉELLEMENT utilisé par `BoardStore`
 * (tous les `this.transport.emit('<type>', …)` / `this.on('<type>', …)` de `board.store.ts`)
 * au vocabulaire canonique `vocabulary.json` — une copie committée, non modifiée, générée côté
 * `pivot-collaboratif-core` depuis les vrais DTO/enum Java (voir `wire-contract/README.md`).
 *
 * ## Méthode : liste explicite, validée contre `vocabulary.json` (pas de duplication à l'aveugle)
 * L'environnement de test de ce projet (`@angular/build:unit-test`, esbuild) n'expose pas les
 * built-ins Node (`fs`) aux fichiers de test de la librairie (pas de `"node"` dans
 * `tsconfig.spec.json`'s `types`, et l'ajout de `@types/node` uniquement pour ce besoin
 * aurait nécessité une dépendance + régénération de lockfile hors scope de cet enabler) — une
 * relecture dynamique du texte source de `board.store.ts` n'est donc pas possible proprement
 * ici. `EMITTED_TYPES`/`LISTENED_TYPES` ci-dessous sont donc une liste EXPLICITE, mais chaque
 * entrée est individuellement validée contre `vocabulary.json` (le fichier canonique, chargé
 * comme un vrai import JSON) — la valeur du test est cette comparaison, pas la simple liste.
 *
 * Pour régénérer cette liste après une modification de `board.store.ts` : extraire, avec un
 * script (regex tolérante aux génériques multi-lignes), tous les littéraux passés à
 * `this.transport.emit('<type>', …)` et `this.on('<type>', …)` (`this.on<...>(` inclus, y
 * compris quand le type générique s'étend sur plusieurs lignes) — voir le corps de la PR EN08.5
 * pour la commande Python exacte utilisée.
 *
 * ## Vocabulaire "WIP full-protocol" — pourquoi une allowlist existe
 * `board.store.ts`/`board-transport.ts` portent volontairement tout le vocabulaire événementiel
 * PouetPouet (frames, timer, vote, custom fields, verrouillage, présence d'édition, groupes…),
 * alors que `pivot-collaboratif-core` n'implémente aujourd'hui que le sous-ensemble Socle
 * documenté par `vocabulary.json` (16 entrées) + les deux extras `board:state`/`board:resetted`
 * (voir la TSDoc `⚠️ WIP` en tête de `BoardTransport`). Ces domaines fonctionnels n'ont
 * SIMPLEMENT AUCUNE entrée correspondante dans le contrat aujourd'hui — il n'y a donc rien à
 * comparer, et les lister en dur ici (avec justification) est le choix correct plutôt que de
 * les rejeter comme une "divergence" : le jour où le backend les implémente, chaque entrée
 * migrée doit être retirée d'ici et validée contre `vocabulary.json` comme les autres.
 *
 * Une string qui N'EST NI dans `vocabulary.json` NI dans une des deux allowlists WIP ci-dessous
 * fait échouer ce test — c'est le signal recherché : soit c'est un vrai type WIP oublié de la
 * liste (à documenter), soit c'est un vrai bug de contrat (nom/casse qui ne correspond à rien
 * côté backend), à corriger dans `board.store.ts`.
 */

interface VocabularyEntry {
  name: string;
  wireIn: string;
  wireOut: string;
}

/**
 * Every literal type argument passed to `this.transport.emit('<type>', …)` in `board.store.ts`
 * (37 call sites at the time of writing — see regeneration command above).
 */
const EMITTED_TYPES: readonly string[] = [
  'board:cursor',
  'board:join',
  'board:leave',
  'boardfield:create',
  'boardfield:delete',
  'boardfield:update',
  'card:create',
  'card:delete',
  'card:editing',
  'card:layer',
  'card:lock',
  'card:move',
  'card:recolor',
  'card:resize',
  'card:update',
  'cardfield:clear',
  'cardfield:set',
  'cards:group',
  'cards:group-color',
  'cards:ungroup',
  'connection:create',
  'connection:delete',
  'connection:update',
  'frame:create',
  'frame:delete',
  'frame:layer',
  'frame:move',
  'frame:resize',
  'frame:update',
  'RESET',
  'timer:start',
  'timer:stop',
  'vote:cast',
  'vote:extend',
  'vote:start',
  'vote:stop',
  'vote:uncast',
];

/**
 * Every literal type argument passed to `this.on('<type>', …)` in `board.store.ts`'s
 * `registerHandlers()` (39 call sites at the time of writing — see regeneration command above).
 */
const LISTENED_TYPES: readonly string[] = [
  'board:cursors',
  'board:error',
  'board:import-undone',
  'board:imported',
  'board:presence',
  'board:resetted',
  'board:state',
  'boardfield:created',
  'boardfield:deleted',
  'boardfield:updated',
  'card:created',
  'card:deleted',
  'card:editing',
  'card:layered',
  'card:meta_updated',
  'card:moved',
  'card:recolored',
  'card:resized',
  'card:updated',
  'cardfield:cleared',
  'cardfield:updated',
  'cards:group-colored',
  'cards:grouped',
  'cards:locked',
  'cards:ungrouped',
  'connection:created',
  'connection:deleted',
  'connection:updated',
  'frame:created',
  'frame:deleted',
  'frame:layered',
  'frame:moved',
  'frame:resized',
  'frame:updated',
  'timer:started',
  'timer:stopped',
  'vote:session:closed',
  'vote:session:started',
  'vote:updated',
];

/**
 * Documented extras (task spec, EN08.5): the backend emits these two wire types as raw
 * strings, outside the `ActionType` enum captured by `vocabulary.json` — `board:state` is the
 * initial-state reply to `JOIN`, `board:resetted` is the reset broadcast. The front legitimately
 * listens to both; they are not a contract gap.
 */
const DOCUMENTED_WIREOUT_EXTRAS = new Set(['board:state', 'board:resetted']);

/**
 * Outgoing action types `BoardStore` emits that target feature domains the Socle backend does
 * not implement at all yet (no corresponding `vocabulary.json` entry under ANY name) — frames,
 * timer, vote sessions, board/card custom fields, card locking, card-grouping, and the
 * editing-presence soft-lock. See `BoardTransport`'s class TSDoc ("⚠️ WIP: … the structured
 * events below have no backend handler yet"). Intentionally excludes `RESET`'s former
 * `'board:reset'` typo: unlike these, `RESET` DOES have a canonical entry in `vocabulary.json`
 * (`wireIn: "RESET"`) — a mismatched name for an existing contract entry is a real divergence,
 * not a missing feature, so it must never be allowlisted here (fixed in `board.store.ts`
 * alongside this test — see the dedicated regression test below).
 */
const KNOWN_WIP_EMIT_TYPES = new Set([
  'boardfield:create',
  'boardfield:delete',
  'boardfield:update',
  'card:editing',
  'card:lock',
  'cardfield:clear',
  'cardfield:set',
  'cards:group',
  'cards:group-color',
  'cards:ungroup',
  'frame:create',
  'frame:delete',
  'frame:layer',
  'frame:move',
  'frame:resize',
  'frame:update',
  'timer:start',
  'timer:stop',
  'vote:cast',
  'vote:extend',
  'vote:start',
  'vote:stop',
  'vote:uncast',
]);

/** Inbound broadcast types the store listens to for those same not-yet-implemented domains. */
const KNOWN_WIP_LISTEN_TYPES = new Set([
  'board:cursors',
  'board:error',
  'board:import-undone',
  'board:imported',
  'board:presence',
  'boardfield:created',
  'boardfield:deleted',
  'boardfield:updated',
  'card:editing',
  'card:meta_updated',
  'cardfield:cleared',
  'cardfield:updated',
  'cards:group-colored',
  'cards:grouped',
  'cards:locked',
  'cards:ungrouped',
  'frame:created',
  'frame:deleted',
  'frame:layered',
  'frame:moved',
  'frame:resized',
  'frame:updated',
  'timer:started',
  'timer:stopped',
  'vote:session:closed',
  'vote:session:started',
  'vote:updated',
]);

describe('BoardStore wire vocabulary vs. canonical vocabulary.json (EN08.5, Couche 1)', () => {
  const typedVocabulary = vocabulary as VocabularyEntry[];
  const wireInSet = new Set(typedVocabulary.map((v) => v.wireIn));
  const wireOutSet = new Set(typedVocabulary.map((v) => v.wireOut));

  it('loaded the canonical vocabulary with the 16 documented Socle entries', () => {
    expect(typedVocabulary).toHaveLength(16);
  });

  describe.each(EMITTED_TYPES.map((type) => [type] as const))('emit(%s, …)', (type) => {
    it('is a known wireIn or a documented WIP extension', () => {
      const isContractWireIn = wireInSet.has(type);
      const isKnownWip = KNOWN_WIP_EMIT_TYPES.has(type);
      expect(
        isContractWireIn || isKnownWip,
        `"${type}" is emitted by board.store.ts but is neither a wireIn in vocabulary.json ` +
          `nor listed in KNOWN_WIP_EMIT_TYPES. Either the canonical vocabulary drifted, or this ` +
          `is a genuine front/back wire-type mismatch (the class of bug EN08.5 exists to catch).`,
      ).toBe(true);
    });
  });

  describe.each(LISTENED_TYPES.map((type) => [type] as const))('on(%s, …)', (type) => {
    it('is a known wireOut, a documented extra, or a documented WIP extension', () => {
      const isContractWireOut = wireOutSet.has(type);
      const isDocumentedExtra = DOCUMENTED_WIREOUT_EXTRAS.has(type);
      const isKnownWip = KNOWN_WIP_LISTEN_TYPES.has(type);
      expect(
        isContractWireOut || isDocumentedExtra || isKnownWip,
        `"${type}" is listened to by board.store.ts but is neither a wireOut in vocabulary.json, ` +
          `a documented extra (board:state/board:resetted), nor listed in KNOWN_WIP_LISTEN_TYPES. ` +
          `Either the canonical vocabulary drifted, or this is a genuine front/back wire-type ` +
          `mismatch (the class of bug EN08.5 exists to catch).`,
      ).toBe(true);
    });
  });

  it('KNOWN_WIP_EMIT_TYPES contains no type that already has a matching wireIn (stale allowlist entry)', () => {
    const stale = Array.from(KNOWN_WIP_EMIT_TYPES).filter((t) => wireInSet.has(t));
    expect(stale, 'these types should be removed from the WIP allowlist — the backend now implements them').toEqual([]);
  });

  it('KNOWN_WIP_LISTEN_TYPES contains no type that already has a matching wireOut/extra (stale allowlist entry)', () => {
    const stale = Array.from(KNOWN_WIP_LISTEN_TYPES).filter((t) => wireOutSet.has(t) || DOCUMENTED_WIREOUT_EXTRAS.has(t));
    expect(stale, 'these types should be removed from the WIP allowlist — the backend now implements them').toEqual([]);
  });

  it('RESET is emitted with the exact canonical wireIn string ("RESET"), not a guessed "board:reset"', () => {
    // Regression pin (EN08.5 finding): board.store.ts's resetBoard() used to emit the literal
    // type 'board:reset', which does not match vocabulary.json's RESET entry (wireIn: "RESET",
    // matching DRAW/UNDO's raw, un-namespaced convention rather than JOIN/LEAVE's "board:*"
    // convention) — a silent wire-contract divergence the backend would have ignored outright.
    // Fixed in board.store.ts alongside this test; asserted here explicitly (in addition to the
    // generic emit()-vs-vocabulary sweep above) so a regression back to 'board:reset' fails with
    // a message pointing straight at the historical bug, not just a generic allowlist miss.
    expect(EMITTED_TYPES).toContain('RESET');
    expect(EMITTED_TYPES).not.toContain('board:reset');
  });
});
