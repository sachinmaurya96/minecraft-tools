import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Callout } from '../components/ui';

/** Route-level error element: renders inside the layout so navigation stays usable. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-4 text-3xl">{notFound ? 'Page not found' : 'Something broke'}</h1>
      <Callout tone="error" title={notFound ? 'There is nothing at this address.' : 'This page failed to load.'}>
        <p className="mb-2">{message}</p>
        <p>
          Your saved projects are not affected. <Link to="/">Go home</Link> or reload the page.
        </p>
      </Callout>
    </div>
  );
}

/** Last-resort boundary for render errors outside the router. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl">Something broke</h1>
        <Callout tone="error" title="The app hit an unexpected error.">
          <p className="mb-2">{this.state.error.message}</p>
          <p>
            Reload the page. Projects you saved are kept on the server for a limited time; your last local draft is kept in this browser.
          </p>
        </Callout>
      </div>
    );
  }
}
