// Config
// COLLABORATIF_CURRENT_USER bridges the host shell's authenticated profile to the whiteboard
// presence layer (board:join displayName) — the consumer (pivot-ui) provides it; without it the
// backend labels every participant "Anonymous". See pivot-ui app.config.ts.
export { COLLABORATIF_API_URL, COLLABORATIF_BEARER_TOKEN, COLLABORATIF_CURRENT_USER } from './lib/core/whiteboard/config/tokens';
export type { CollaboratifCurrentUser } from './lib/core/whiteboard/config/tokens';
export { provideCollaboratifUi } from './lib/core/whiteboard/config/provide-collaboratif-ui';
export type { CollaboratifUiConfig } from './lib/core/whiteboard/config/provide-collaboratif-ui';

// Routes — mounted by the consuming shell under a guarded path (e.g. moduleGuard('whiteboard')
// from @pivot-platform/ui-core), see pivot-docs EN17.9.
export { whiteboardRoutes as COLLABORATIF_ROUTES } from './lib/whiteboard/whiteboard.routes';
