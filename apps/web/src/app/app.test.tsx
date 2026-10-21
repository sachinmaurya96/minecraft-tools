import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCLAIMER } from '../components/Layout';
import { toolRoutes } from '../tools/routes';
import { TOOLS } from '../tools/registry';
import { routes } from './router';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: null, error: { code: 'NETWORK', message: 'offline in tests' }, requestId: 't' }), { status: 503 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('site shell', () => {
  it('shows the non-affiliation statement on every page', async () => {
    renderAt('/');
    expect(await screen.findByTestId('disclaimer')).toHaveTextContent(DISCLAIMER);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Make your character Minecraft-ready.');
  });

  it('lists active and planned tools from the registry; planned tools have no link', async () => {
    renderAt('/tools');
    expect(await screen.findByRole('heading', { name: 'Character Builder' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Character Builder' })).toHaveAttribute('href', '/tools/character-builder');
    for (const planned of TOOLS.filter((t) => t.status === 'coming-soon')) {
      expect(screen.getByRole('heading', { name: planned.title })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: `Open ${planned.title}` })).toBeNull();
    }
    expect(screen.getAllByText('Planned').length).toBe(TOOLS.filter((t) => t.status === 'coming-soon').length);
  });

  it('only active tools get routes; a planned tool URL is a 404', async () => {
    expect(toolRoutes().map((r) => r.path)).toEqual(['tools/character-builder']);
    renderAt('/tools/pixel-art');
    expect(await screen.findByText('Nothing here but air')).toBeInTheDocument();
  });

  it('renders the character builder mode selection and reports an unreachable server honestly', async () => {
    renderAt('/tools/character-builder');
    expect(await screen.findByRole('heading', { name: 'Player skin' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Custom 3D entity' })).toBeInTheDocument();
    expect(screen.getByText(/64×64 PNG for Minecraft Java Edition/)).toBeInTheDocument();
    expect(screen.getByText(/Bedrock Edition add-on \(.mcaddon\) with your own cuboid model/)).toBeInTheDocument();
    expect(await screen.findByText('Server not reachable')).toBeInTheDocument();
  });
});

describe('skinview3d lifecycle', () => {
  it('creates one viewer per mount and disposes it on unmount, also under StrictMode', async () => {
    const created: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    vi.doMock('skinview3d', () => ({
      SkinViewer: vi.fn(function (this: Record<string, unknown>) {
        const v = {
          dispose: vi.fn(() => (v.disposed = true)),
          disposed: false,
          setSize: vi.fn(),
          loadSkin: vi.fn(),
          resetCameraPose: vi.fn(),
          animation: null,
          background: null,
          playerObject: {
            skin: { setInnerLayerVisible: vi.fn(), setOuterLayerVisible: vi.fn(), head: {}, body: {}, rightArm: {}, leftArm: {}, rightLeg: {}, leftLeg: {} },
          },
        };
        created.push(v);
        return v;
      }),
      WalkingAnimation: vi.fn(),
    }));
    vi.doMock('../lib/webgl', () => ({ hasWebGL: () => true }));
    const { SkinPreview3D } = await import('../features/character-builder/editor-skin/SkinPreview3D');
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const view = render(
      <StrictMode>
        <SkinPreview3D pixels={pixels} model="classic" showBase showOverlay hiddenParts={[]} />
      </StrictMode>,
    );
    // StrictMode mounts, unmounts and re-mounts effects in development
    expect(created.length).toBe(2);
    expect(created[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(created[1]!.dispose).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(created[1]!.dispose).toHaveBeenCalledTimes(1);
    vi.doUnmock('skinview3d');
    vi.doUnmock('../lib/webgl');
  });
});
