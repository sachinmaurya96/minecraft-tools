import { PageMeta } from '../components/PageMeta';
import { LinkButton } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <PageMeta title="Page not found" description="This page does not exist." noindex />
      <p className="font-pixel mb-2 text-6xl text-gold">404</p>
      <h1 className="mb-4 text-3xl">Nothing here but air</h1>
      <p className="mb-6 text-muted">This page does not exist, or the tool is not available yet.</p>
      <div className="flex justify-center gap-3">
        <LinkButton to="/" variant="primary">
          Go home
        </LinkButton>
        <LinkButton to="/tools">See tools</LinkButton>
      </div>
    </div>
  );
}
