import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from '../components/Layout';
import { AboutPage } from '../pages/AboutPage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PrivacyPage } from '../pages/PrivacyPage';
import { TermsPage } from '../pages/TermsPage';
import { ToolsPage } from '../pages/ToolsPage';
import { toolRoutes } from '../tools/routes';
import { RouteError } from './errors';
import { Spinner } from '../components/ui';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    // shown while a lazily loaded route module downloads on first load
    hydrateFallbackElement: (
      <div className="p-8">
        <Spinner label="Loading" />
      </div>
    ),
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'tools', element: <ToolsPage /> },
          ...toolRoutes(),
          { path: 'about', element: <AboutPage /> },
          { path: 'privacy', element: <PrivacyPage /> },
          { path: 'terms', element: <TermsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
