import { describe, expect, it } from 'vitest';
// Docs and source are inlined at build time by Vite (?raw), so these tests run
// inside workerd with no filesystem access.
import agentsMd from '../../AGENTS.md?raw';
import decisionsMd from '../../DECISIONS.md?raw';
import statusMd from '../../STATUS.md?raw';
import designSystemMd from '../../docs/design-system.md?raw';
import frontendPlanMd from '../../docs/frontend-plan.md?raw';
import { DIMENSION_SOURCES, IMAGE_SOURCES, TRUNCATION_REASONS } from './extract';

// Injected by vitest.config.ts — see the note there. The Tailwind Vite plugin
// makes `global.css?raw` empty, so the file's text is read at config time.
declare const __GLOBAL_CSS__: string;
const globalCss = __GLOBAL_CSS__;

// Every src/lib/*.ts (except tests), auto-included — so when a planned symbol
// ships in a new file, the self-retiring check below sees it without edits here.
const libRawByPath = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const libSource = Object.entries(libRawByPath)
  .filter(([path]) => !path.endsWith('.test.ts'))
  .map(([, raw]) => raw)
  .join('\n');

const exportedNames = new Set(
  [...libSource.matchAll(/export\s+(?:const|class|function|let|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)].map(
    (m) => m[1] as string,
  ),
);

/**
 * Allowlist for identifiers the docs name but source can't (yet) satisfy.
 * Each entry states WHY it is tolerated. Planned entries are self-retiring:
 * once the symbol exists in source, the test fails until the entry is removed —
 * shipping the symbol without deleting its allowlist line is itself drift.
 * NOTE the scope: ONLY 'planned' entries self-retire. 'external' and
 * 'historical' entries never trip anything — when an external dependency gets
 * installed and imported (its name then appears in lib source), its entry
 * becomes dead weight that must be deleted by hand, as client-zip's was.
 */
type Allow =
  | { token: string; kind: 'planned'; retiresAt: string }
  | { token: string; kind: 'historical'; note: string }
  | { token: string; kind: 'external'; note: string };

const ALLOWLIST: Allow[] = [
  {
    token: 'css-external',
    kind: 'historical',
    note: 'wrong example; corrected in the DECISIONS.md entry that follows it, retained per the append-only log rule',
  },
  {
    token: 'no-referrer',
    kind: 'external',
    note: 'HTML referrer-policy value; set in src/pages/results.astro, outside the scanned lib corpus',
  },
  {
    token: 'preact-render-to-string',
    kind: 'external',
    note: 'transitive npm dependency of @astrojs/preact (SSR renderer); named in DECISIONS.md, not imported by our lib',
  },
];
const allowed = new Set(ALLOWLIST.map((a) => a.token));

// ---------------------------------------------------------------------------
// Layer 1 — exact unions. The AGENTS.md manifest snippet duplicates two unions
// from extract.ts for readability; these assert the copy has not drifted.
// ---------------------------------------------------------------------------
describe('layer 1: manifest unions match extract.ts', () => {
  function quotedTokens(line: string): string[] {
    return [...line.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  }

  it('the source enum matches IMAGE_SOURCES', () => {
    const line = agentsMd.split('\n').find((l) => l.trimStart().startsWith('source:'));
    expect(line, 'AGENTS.md must contain the manifest source line').toBeDefined();
    expect(quotedTokens(line as string)).toEqual([...IMAGE_SOURCES]);
  });

  it('the truncated union matches TRUNCATION_REASONS', () => {
    const line = agentsMd.split('\n').find((l) => l.trimStart().startsWith('truncated?:'));
    expect(line, 'AGENTS.md must contain the manifest truncated line').toBeDefined();
    expect(quotedTokens(line as string)).toEqual([...TRUNCATION_REASONS]);
  });

  it('the dimensionSource union matches DIMENSION_SOURCES', () => {
    const line = agentsMd.split('\n').find((l) => l.trimStart().startsWith('width?:'));
    expect(line, 'AGENTS.md must contain the manifest width/dimensionSource line').toBeDefined();
    expect(quotedTokens(line as string)).toEqual([...DIMENSION_SOURCES]);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — identifier existence. Every code identifier named in the docs must
// exist in source (or be allowlisted). This is the check that would have caught
// `css-external` mechanically. Prose numbers are deliberately NOT asserted
// (layer 4): a regex confirming "100 KB" sits near "robots" checks a string,
// not a semantic — read at each phase boundary instead (see AGENTS.md).
// ---------------------------------------------------------------------------
describe('layer 2: identifier existence', () => {
  const allDocs = [agentsMd, decisionsMd, statusMd, designSystemMd, frontendPlanMd].join('\n');
  // Hyphenated enum-literal harvest is scoped to the architecture docs; the
  // frontend design docs are dense with CSS/Tailwind vocabulary (aspect-square,
  // content-visibility, …) that is legitimately not ours, and scanning them
  // would trade real signal for allowlist noise.
  const archDocs = [agentsMd, decisionsMd, statusMd].join('\n');

  const harvest = (text: string, re: RegExp): string[] =>
    [...new Set([...text.matchAll(re)].map((m) => m[1] as string))];

  // (a) SCREAMING_SNAKE constants — the underscore requirement excludes bare
  // all-caps prose like HEAD, SESSION, DNS, ZIP, URL.
  it('backticked SCREAMING_SNAKE constants exist in source exports', () => {
    for (const token of harvest(allDocs, /`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)) {
      if (allowed.has(token)) continue;
      expect(exportedNames.has(token), `${token} is named in docs but not exported by src/lib`).toBe(true);
    }
  });

  // (b) Error classes.
  it('backticked *Error classes exist in source exports', () => {
    for (const token of harvest(allDocs, /`([A-Z][A-Za-z]*Error)`/g)) {
      if (allowed.has(token)) continue;
      expect(exportedNames.has(token), `${token} is named in docs but not an exported class`).toBe(true);
    }
  });

  // (c) Hyphenated enum-ish literals must appear as a literal somewhere in the
  // lib source. `css-external` never does — that is the catch.
  //
  // Known false-positive class: this harvest cannot tell an enum literal from a
  // hyphenated CSS property (`content-visibility`), an HTTP header
  // (`cache-control`), or an npm package (`client-zip`) — all legitimately live
  // outside src/lib. When one trips this test, the fix is to REMOVE the
  // backticks in the doc (they aren't our identifiers), not to add an allowlist
  // entry — an allowlist grows unbounded and hides the next real drift.
  // `content-visibility` (STATUS.md) was the first; it will not be the last.
  it('backticked hyphenated literals appear in lib source', () => {
    for (const token of harvest(archDocs, /`([a-z]+(?:-[a-z]+)+)`/g)) {
      if (allowed.has(token)) continue;
      expect(libSource.includes(token), `${token} is named in docs but appears nowhere in src/lib`).toBe(true);
    }
  });

  // Self-retiring: a planned identifier that has since shipped must have its
  // allowlist entry removed, or this fails.
  it('planned identifiers are still absent from source', () => {
    for (const entry of ALLOWLIST) {
      if (entry.kind !== 'planned') continue;
      expect(
        exportedNames.has(entry.token),
        `${entry.token} now exists in source (planned for ${entry.retiresAt}); remove its PLANNED allowlist entry`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — design tokens. The colour table in design-system.md and the
// @theme block in global.css must agree in both directions.
// ---------------------------------------------------------------------------
describe('layer 3: design-system colour table matches @theme', () => {
  const docTokens = new Map(
    [...designSystemMd.matchAll(/^\|\s*`(--color-[a-z-]+)`\s*\|\s*`(#[0-9A-Fa-f]{6})`\s*\|/gm)].map(
      (m) => [m[1] as string, (m[2] as string).toUpperCase()] as const,
    ),
  );
  const cssTokens = new Map(
    [...globalCss.matchAll(/^\s*(--color-[a-z-]+):\s*(#[0-9A-Fa-f]{6});/gm)].map(
      (m) => [m[1] as string, (m[2] as string).toUpperCase()] as const,
    ),
  );

  it('parsed both sides non-empty', () => {
    expect(docTokens.size).toBeGreaterThan(0);
    expect(cssTokens.size).toBe(docTokens.size);
  });

  it('every documented colour token matches @theme', () => {
    for (const [name, value] of docTokens) {
      expect(cssTokens.get(name), `${name} documented but missing from @theme`).toBe(value);
    }
  });

  it('every @theme colour token is documented', () => {
    for (const [name, value] of cssTokens) {
      expect(docTokens.get(name), `${name} in @theme but missing from design-system.md`).toBe(value);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — deployed config. wrangler.jsonc is the kind of file people
// regenerate or paste over, and a comment does not survive that. These
// assertions do. The observability one is a regression test for a real
// incident: the flag sat enabled while the log audit claimed nothing
// enabled it, because the audit swept src/ and never opened config.
declare const __WRANGLER_CONFIG__: {
  observability?: { enabled?: boolean };
  limits?: { cpu_ms?: number; subrequests?: number };
  kv_namespaces?: Array<{ binding: string }>;
};

describe('layer 4: wrangler.jsonc invariants', () => {
  it('observability stays OFF — inbound request URLs embed every scanned URL', () => {
    expect(__WRANGLER_CONFIG__.observability?.enabled).toBe(false);
  });

  it('the limits block matches the documented, derived values', () => {
    // 30,000 = 1,570 ms measured worst-case parse × 4 (hardware
    // assumption) × ~5 headroom; 100 ≈ 1.6× the 61-subrequest worst
    // structural scan (subrequest-budget.test.ts owns that derivation).
    expect(__WRANGLER_CONFIG__.limits).toEqual({ cpu_ms: 30000, subrequests: 100 });
  });

  it('the BLOCKLIST binding survives — the blocklist fails open without it', () => {
    const bindings = (__WRANGLER_CONFIG__.kv_namespaces ?? []).map((n) => n.binding);
    expect(bindings).toContain('BLOCKLIST');
  });
});
