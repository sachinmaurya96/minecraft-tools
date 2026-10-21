import type { RouteObject } from 'react-router';

/** Character Builder routes; page components load on demand. */
export const characterBuilderRoutes: RouteObject[] = [
  { index: true, lazy: { Component: async () => (await import('./StartPage')).StartPage } },
  { path: 'skin', lazy: { Component: async () => (await import('./editor-skin/SkinWorkspace')).SkinWorkspace } },
  { path: 'entity', lazy: { Component: async () => (await import('./editor-entity/EntityWorkspace')).EntityWorkspace } },
];
