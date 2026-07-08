import { InjectionToken } from '@angular/core';

/**
 * Base URL of the collaboratif backend API. Provided by the consuming app —
 * `provideCollaboratifUi()` when this module is lazy-loaded from the `pivot-ui` shell,
 * or `app.config.ts` (from `environment.apiUrl`) when this repo runs standalone.
 */
export const COLLABORATIF_API_URL = new InjectionToken<string>('COLLABORATIF_API_URL');
