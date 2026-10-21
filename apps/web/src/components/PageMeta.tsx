import { useLocation } from 'react-router';

const SITE_URL = (import.meta.env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');

/**
 * Per-page title, description, canonical URL and social tags. React 19 hoists
 * <title>, <meta> and <link> rendered anywhere into <head>.
 */
export function PageMeta({ title, description, noindex }: { title: string; description: string; noindex?: boolean }) {
  const { pathname } = useLocation();
  const fullTitle = title.includes('Blockwright') ? title : `${title} · Blockwright`;
  const url = `${SITE_URL}${pathname}`;
  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={`${SITE_URL}/og-image.png`} />
      {noindex && <meta name="robots" content="noindex" />}
    </>
  );
}
