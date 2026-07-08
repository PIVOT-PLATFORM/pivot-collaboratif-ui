import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { COLLABORATIF_API_URL } from './tokens';

export interface CollaboratifUiConfig {
  apiUrl: string;
}

/** Configures @pivot-platform/collaboratif-ui. Call this in the consuming app's providers array. */
export function provideCollaboratifUi(config: CollaboratifUiConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: COLLABORATIF_API_URL, useValue: config.apiUrl },
  ]);
}
