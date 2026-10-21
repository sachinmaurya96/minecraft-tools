import { DISCLAIMER } from '../components/Layout';
import { PageMeta } from '../components/PageMeta';
import { Panel } from '../components/ui';

export function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageMeta title="About" description="What Blockwright is, how it works, and what it is not." />
      <h1 className="mb-4 text-3xl">About Blockwright</h1>
      <Panel className="mb-6 p-5">
        <p className="font-pixel text-gold">{DISCLAIMER}</p>
      </Panel>
      <div className="space-y-4 text-muted [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:text-ink">
        <p>
          Blockwright is an independent website with tools for people who make things for Minecraft. It is not made, endorsed or reviewed by
          Mojang Studios or Microsoft. The name “Minecraft” is used only to describe what the files are compatible with.
        </p>
        <h2>What the Character Builder does</h2>
        <p>
          It creates two different kinds of file. A <strong className="text-ink">player skin</strong> is a 64×64 image that recolours the
          standard player body. A <strong className="text-ink">custom entity</strong> is a Bedrock Edition add-on: a new creature with its own
          cuboid shape, texture and simple behaviour that you can spawn in a world.
        </p>
        <h2>How results are made</h2>
        <p>
          Templates, imports, the pixel editor and the photo-assisted tools are ordinary, predictable code that runs in your browser and on our
          server. Optional AI models (for example Sking for skins or TripoSR for 3D shapes) only run when the server has the right hardware and
          they are shown as unavailable otherwise. Each result carries a label saying which of these produced it.
        </p>
        <h2>What we check before you download</h2>
        <p>
          Skins are checked for size, PNG validity and an opaque base layer. Add-ons are built, zipped, re-opened and checked: manifests, unique
          pack IDs, the link between the two packs, matching identifiers, geometry and texture references, texture size and every UV rectangle.
          These checks are necessary, but they cannot prove that every Minecraft version will load a file; test new add-ons in a copy of your world.
        </p>
        <h2>Credits</h2>
        <p>
          Built with React, Vite, Three.js, skinview3d (MIT), Express, FastAPI, trimesh and other open-source software. Optional AI models keep
          their own licences, listed in the project documentation.
        </p>
      </div>
    </div>
  );
}
