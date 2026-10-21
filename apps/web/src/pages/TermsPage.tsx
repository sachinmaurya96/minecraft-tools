import { DISCLAIMER } from '../components/Layout';
import { PageMeta } from '../components/PageMeta';

export function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageMeta title="Terms" description="Terms of use for Blockwright." />
      <h1 className="mb-4 text-3xl">Terms of use</h1>
      <div className="space-y-4 text-muted [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:text-ink">
        <p className="font-pixel text-gold">{DISCLAIMER}</p>
        <h2>The service</h2>
        <p>
          Blockwright is provided free of charge and “as is”, without warranty. Features can change or be unavailable, in particular optional AI
          features that depend on specific hardware.
        </p>
        <h2>Your content</h2>
        <p>
          You keep the rights to what you upload and make. You confirm you have the right to use every image you upload, and you are responsible
          for what you create and share. Do not upload unlawful, hateful or sexual content, or images of people without their permission.
        </p>
        <h2>Minecraft</h2>
        <p>
          Minecraft is a trademark of Mojang Synergies AB. Files made here are designed to be compatible with Minecraft, but compatibility with
          every game version, device or server is not guaranteed. Back up your worlds before adding add-ons. Follow the Minecraft EULA and Usage
          Guidelines when you share or sell what you make.
        </p>
        <h2>AI models</h2>
        <p>
          When an AI-generated result is offered, it was produced by an open model with its own licence (listed in the documentation). AI
          results can be wrong or resemble existing works; review them before use.
        </p>
      </div>
    </div>
  );
}
