import type { RouteObject } from 'react-router';
import { characterBuilderRoutes } from '../features/character-builder/routes';
import { activeTools } from './registry';

/**
 * Route trees for active tools. Each tool in features/<tool-id> exports a small
 * static route list whose components are lazy-loaded (React Router cannot load
 * `children` lazily). Tools without an entry here cannot be routed, so a
 * "coming-soon" registry item can never be opened as a working tool.
 */
const TOOL_ROUTES: Record<string, RouteObject[]> = {
  'character-builder': characterBuilderRoutes,
};

export function toolRoutes(): RouteObject[] {
  return activeTools()
    .filter((t) => TOOL_ROUTES[t.id])
    .map((t) => ({ path: t.path.slice(1), children: TOOL_ROUTES[t.id] }));
}
