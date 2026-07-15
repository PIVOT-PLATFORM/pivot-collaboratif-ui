# Wire contract fixtures — EN08.5

Ces 5 fichiers sont des **copies exactes**, non modifiées, des fixtures committées côté backend :

```
pivot-collaboratif-core/src/test/resources/wire-contract/
├── vocabulary.json
├── card-dto.json
├── card-connection-dto.json
├── board-state.json
└── participants-update.json
```

(branche `feat/en08-5-test-contrat-wire`, PR #83 sur `pivot-collaboratif-core`).

## Source de vérité

Le **backend est la source de vérité**. Ces fichiers sont générés depuis les vrais DTO/enum
Java (`WireContractFixturesIT`), jamais tapés à la main côté back ni côté front. Ce dossier ne
fait que **consommer** une copie figée pour piloter les tests Vitest de ce repo
(`board.store.wire-contract.spec.ts`, `board.store.payload-shapes.spec.ts`,
`participants-presence.spec.ts`) — il ne les régénère jamais lui-même.

## Régénération

Quand le contrat backend évolue (nouveau type d'action, nouveau champ DTO), régénérer côté
`pivot-collaboratif-core` :

```bash
mvn test -Dtest=WireContractFixturesIT -Dwire.contract.regenerate=true
```

puis re-copier les 5 fichiers ici à l'identique (voir procédure dans le corps de la PR EN08.5 —
`gh api repos/PIVOT-PLATFORM/pivot-collaboratif-core/contents/src/test/resources/wire-contract/<f>
--jq '.content' | base64 -d`). Toute divergence entre la copie ici et le fichier backend après un
changement de contrat = un des deux repos est en retard, à corriger avant merge.

## Ce que chaque fichier vérifie côté front

| Fichier | Consommé par | Vérifie |
|---|---|---|
| `vocabulary.json` | `board.store.wire-contract.spec.ts` | Tout type `transport.emit`/`transport.on` réellement utilisé par `BoardStore` est un `wireIn`/`wireOut` connu du contrat (ou un extra documenté / une extension WIP explicitement listée). |
| `card-dto.json` | `board.store.payload-shapes.spec.ts` | `card:created`/`card:updated` reconstruits depuis cette fixture sont réconciliés en état avec les noms de champs exacts (`meta`, `posX`/`posY`, `groupColor`, `layer`, …). |
| `card-connection-dto.json` | `board.store.payload-shapes.spec.ts` | `connection:created`/`connection:updated` sont réconciliés avec les noms de champs exacts (`fromId`/`toId`, `shape`, `arrow`, `dashed`, …). |
| `board-state.json` | `board.store.payload-shapes.spec.ts` | L'enveloppe `{type:"board:state", boardId, userId, data:{cards, connections, frames, fields}}` est correctement désenveloppée par `BoardTransport` et réconciliée en état par `BoardStore`. |
| `participants-update.json` | `participants-presence.spec.ts` | Le payload non enveloppé `{participants:[...]}` du topic `/presence` dédié est parsé par `WhiteboardSyncService` avec les noms de champs exacts (`userId`, `displayName`, `avatarUrl`, `color`, `role`). |
