// Config
export { COLLABORATIF_API_URL } from './lib/core/whiteboard/config/tokens';
export { provideCollaboratifUi } from './lib/core/whiteboard/config/provide-collaboratif-ui';
export type { CollaboratifUiConfig } from './lib/core/whiteboard/config/provide-collaboratif-ui';

// Routes — mounted by the consuming shell under a guarded path (e.g. moduleGuard('whiteboard')
// from @pivot-platform/ui-core), see pivot-docs EN17.9.
export { whiteboardRoutes as COLLABORATIF_ROUTES } from './lib/whiteboard/whiteboard.routes';
