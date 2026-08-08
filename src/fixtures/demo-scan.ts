import type { ScanResult } from '../lib/extract';

// Fixture behind the landing-page demo grid. `demoScan` is a real ScanResult
// (same type the /api/scan endpoint returns). Dimensions aren't on ScanImage
// yet (that's frontend-plan step 3), so the demo's "scanned" dimensions and
// the webp asset each tile maps to ride alongside in `demoTileMeta`, keyed by
// image id. Nothing here is fetched — it's a canned scan of a fictional
// photography archive, used only to animate the landing demo.

export interface DemoTileMeta {
  /** Dimensions the demo presents as the scanned original (not the thumbnail). */
  width: number;
  height: number;
  /** Base name of the converted webp in src/assets/demo/. */
  asset: string;
  /** Pretend original byte size — feeds the selection bar's running total as
   *  it "resolves" during the scripted intro. Never shown per tile. */
  bytes: number;
}

export const demoScan: ScanResult = {
  pageUrl: 'https://photographyarchive.co/exhibits',
  images: [
    { id: 'e4a17b', url: 'https://photographyarchive.co/exhibits/img/brutalist-facade.jpg', filename: 'brutalist-facade.jpg', ext: 'jpeg', source: 'img' },
    { id: '9c2f04', url: 'https://photographyarchive.co/exhibits/img/salt-flat-aerial.jpg', filename: 'salt-flat-aerial.jpg', ext: 'jpeg', source: 'srcset' },
    { id: '1b8d55', url: 'https://photographyarchive.co/exhibits/img/minimal-chair-studio.png', filename: 'minimal-chair-studio.png', ext: 'png', source: 'img' },
    { id: '7fae23', url: 'https://photographyarchive.co/exhibits/img/concrete-cubes.jpg', filename: 'concrete-cubes.jpg', ext: 'jpeg', source: 'picture' },
    { id: 'c05e9a', url: 'https://photographyarchive.co/exhibits/img/leaf-macro.jpg', filename: 'leaf-macro.jpg', ext: 'jpeg', source: 'img' },
    { id: '3d61f8', url: 'https://photographyarchive.co/exhibits/works/abstract-landscape.jpg', filename: 'abstract-landscape.jpg', ext: 'jpeg', source: 'json-ld' },
    { id: 'a82c47', url: 'https://photographyarchive.co/exhibits/img/gallery-interior.webp', filename: 'gallery-interior.webp', ext: 'webp', source: 'img' },
    { id: '5e90d1', url: 'https://photographyarchive.co/exhibits/img/desert-rock-formation.jpg', filename: 'desert-rock-formation.jpg', ext: 'jpeg', source: 'srcset' },
    { id: 'b47a6c', url: 'https://photographyarchive.co/exhibits/img/iridescent-glass-disc.png', filename: 'iridescent-glass-disc.png', ext: 'png', source: 'lazy' },
    { id: '2f3ba9', url: 'https://photographyarchive.co/exhibits/img/mountain-sunrise.avif', filename: 'mountain-sunrise.avif', ext: 'avif', source: 'img' },
    { id: 'd6108e', url: 'https://photographyarchive.co/exhibits/img/vintage-typewriter.jpg', filename: 'vintage-typewriter.jpg', ext: 'jpeg', source: 'meta' },
    { id: '8ac3f2', url: 'https://photographyarchive.co/exhibits/img/clay-vases-shelf.webp', filename: 'clay-vases-shelf.webp', ext: 'webp', source: 'lazy' },
    { id: '4b7e15', url: 'https://photographyarchive.co/exhibits/img/long-exposure-seascape.jpg', filename: 'long-exposure-seascape.jpg', ext: 'jpeg', source: 'img' },
    { id: 'f21c60', url: 'https://photographyarchive.co/exhibits/img/design-principles-poster.png', filename: 'design-principles-poster.png', ext: 'png', source: 'meta' },
  ],
};

export const demoTileMeta: Record<string, DemoTileMeta> = {
  e4a17b: { width: 1920, height: 1567, asset: 'brutalist-facade', bytes: 1_340_000 },
  '9c2f04': { width: 2000, height: 1622, asset: 'salt-flat-aerial', bytes: 2_180_000 },
  '1b8d55': { width: 1600, height: 1306, asset: 'minimal-chair-studio', bytes: 410_000 },
  '7fae23': { width: 2400, height: 1946, asset: 'concrete-cubes', bytes: 3_050_000 },
  c05e9a: { width: 2048, height: 1024, asset: 'leaf-macro', bytes: 1_720_000 },
  '3d61f8': { width: 3000, height: 1500, asset: 'abstract-landscape', bytes: 2_640_000 },
  a82c47: { width: 2400, height: 1200, asset: 'gallery-interior', bytes: 690_000 },
  '5e90d1': { width: 1600, height: 1408, asset: 'desert-rock-formation', bytes: 1_510_000 },
  b47a6c: { width: 1400, height: 1240, asset: 'iridescent-glass-disc', bytes: 980_000 },
  '2f3ba9': { width: 2048, height: 1801, asset: 'mountain-sunrise', bytes: 2_260_000 },
  d6108e: { width: 1800, height: 1583, asset: 'vintage-typewriter', bytes: 1_870_000 },
  '8ac3f2': { width: 2000, height: 900, asset: 'clay-vases-shelf', bytes: 720_000 },
  '4b7e15': { width: 2400, height: 1080, asset: 'long-exposure-seascape', bytes: 1_120_000 },
  f21c60: { width: 1600, height: 720, asset: 'design-principles-poster', bytes: 260_000 },
};
