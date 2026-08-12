import { describe, expect, it } from 'vitest';
import frontendPlanMd from '../../docs/frontend-plan.md?raw';
import { parseFormatParam, parseSourceParam } from './results-model';

/**
 * Claim discipline for the /tools landing pages.
 *
 * /privacy and /terms were written by reading the code before writing the
 * sentence. That scales to two pages. There will be sixty of these, written
 * weeks apart, and a landing page promising a capability we lack is the same
 * failure class as a false privacy claim — so the verification is DATA in each
 * page's frontmatter and this file walks it.
 *
 * Four things are checked, and the second is the one that does not exist
 * anywhere else in this project:
 *   1. Every claim's evidence resolves — a symbol declared in src/lib, or a
 *      corpus row and figure present in the coverage study.
 *   2. Every `assumes` entry's symbol is still ABSENT. This is copy that is
 *      true only while something is UNBUILT; the day it ships, this test goes
 *      red and names the page and the paragraph. Self-retiring, same shape as
 *      doc-sync's `kind: 'planned'` entries.
 *   3. A page's funnel is deliverable — the params it hands /results parse
 *      back to the same filter, through the real parsers, not a schema copy.
 *   4. The three page rules hold (a limits entry, one evidenced headline
 *      claim, no verbatim restatement of a claim already on /).
 */

// Injected by vitest.config.ts (Node side, where YAML and the filesystem
// exist). Parsed there with `yaml` rather than through Astro's content layer
// on purpose: a guard that shares its subject's parser inherits its blind
// spots.
declare const __TOOL_PAGES__: Array<{
  slug: string;
  data: Record<string, any> | null;
  body: string;
}>;
declare const __LANDING_SOURCE__: string;
const pages = __TOOL_PAGES__;
const landing = __LANDING_SOURCE__;

// Same harvest as doc-sync layer 2, widened from exports to DECLARATIONS:
// evidence may legitimately name a private helper (`extFromPathname` is not
// exported and does not need to be — the claim is that the mechanism exists,
// not that it is public API).
const libRawByPath = import.meta.glob('./*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const libSource = Object.entries(libRawByPath)
  .filter(([path]) => !path.endsWith('.test.ts'))
  .map(([, raw]) => raw)
  .join('\n');
const declaredNames = new Set(
  [
    ...libSource.matchAll(
      /(?:export\s+)?(?:async\s+)?(?:const|class|function|let|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((m) => m[1] as string),
);

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const landingText = squash(landing);

describe('tool pages: frontmatter parses', () => {
  it('there is at least one page (this suite is not silently empty)', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const page of pages) {
    it(`${page.slug}: frontmatter is a parsed object`, () => {
      expect(page.data, `${page.slug}.md has no --- frontmatter block`).not.toBeNull();
    });
  }
});

describe('tool pages: claim evidence resolves', () => {
  for (const page of pages) {
    const claims = (page.data?.claims ?? []) as Array<Record<string, any>>;
    for (const [i, claim] of claims.entries()) {
      it(`${page.slug} claim[${i}]: evidence exists`, () => {
        const evidence = claim.evidence ?? {};
        if (typeof evidence.code === 'string') {
          expect(
            declaredNames.has(evidence.code),
            `${page.slug} claims "${claim.text}" citing ${evidence.code}, which is declared nowhere in src/lib`,
          ).toBe(true);
        } else {
          // Corpus evidence: both the page and the figure must appear in the
          // coverage study, so a claim cannot cite a measurement that was
          // never recorded or a number that has since been corrected.
          expect(
            frontendPlanMd.includes(evidence.corpus),
            `${page.slug} cites corpus page "${evidence.corpus}", absent from docs/frontend-plan.md`,
          ).toBe(true);
          expect(
            frontendPlanMd.includes(evidence.figure),
            `${page.slug} cites figure "${evidence.figure}", absent from docs/frontend-plan.md`,
          ).toBe(true);
        }
      });
    }

    // Limits may cite evidence too; when they do it is held to the same bar.
    const limits = (page.data?.limits ?? []) as Array<Record<string, any>>;
    for (const [i, limit] of limits.entries()) {
      if (!limit.evidence?.code) continue;
      it(`${page.slug} limit[${i}]: evidence exists`, () => {
        expect(
          declaredNames.has(limit.evidence.code),
          `${page.slug} states a limit citing ${limit.evidence.code}, declared nowhere in src/lib`,
        ).toBe(true);
      });
    }
  }
});

// The mechanism that makes a copy dependency mechanical instead of a comment
// nobody re-reads. A page declares what its copy assumes is UNBUILT; the day
// that symbol appears, this fails with the page, the paragraph, and what the
// copy has to say instead — written down while the reasoning was fresh.
describe('tool pages: assumed-absent capabilities are still absent', () => {
  type Assumption = {
    page: (typeof pages)[number];
    absent: string;
    affects: string;
    because: string;
  };
  const assumptions: Assumption[] = pages.flatMap((page) =>
    ((page.data?.assumes ?? []) as Array<Omit<Assumption, 'page'>>).map((a) => ({ page, ...a })),
  );

  if (assumptions.length === 0) {
    it('no page currently depends on an unbuilt capability', () => {
      expect(assumptions).toHaveLength(0);
    });
  }

  for (const assumption of assumptions) {
    it(`${assumption.page.slug}: "${assumption.absent}" has not shipped yet`, () => {
      expect(
        declaredNames.has(assumption.absent),
        [
          `${assumption.absent} now exists in src/lib, so copy on /tools/${assumption.page.slug} is stale.`,
          `Affected: ${assumption.affects}`,
          `Why: ${assumption.because}`,
          'Fix the copy, then delete this `assumes` entry.',
        ].join('\n'),
      ).toBe(false);
    });
  }
});

// A page's promise has to survive the click. These are the same parsers
// /results runs, so a funnel that cannot be delivered fails here rather than
// in front of a visitor.
describe('tool pages: the funnel delivers what the page promises', () => {
  for (const page of pages) {
    const funnel = page.data?.funnel;
    if (!funnel) continue;
    it(`${page.slug}: funnel params parse back to the same filter`, () => {
      if (funnel.format) {
        const parsed = parseFormatParam(funnel.format.join(','));
        expect([...parsed].sort()).toEqual(
          [...new Set(funnel.format.map((f: string) => (f === 'jpg' ? 'jpeg' : f)))].sort(),
        );
      }
      if (funnel.source) {
        const parsed = parseSourceParam(funnel.source.join(','));
        expect([...parsed].sort()).toEqual([...new Set(funnel.source)].sort());
      }
    });
  }
});

describe('tool pages: the three page rules', () => {
  const slugs = new Set(pages.map((p) => p.slug));

  for (const page of pages) {
    const data = page.data ?? {};

    // Rule 1 — every variant has something it cannot do, and the visitor
    // should meet it before spending a scan discovering it.
    it(`${page.slug}: states at least one limit`, () => {
      expect((data.limits ?? []).length).toBeGreaterThan(0);
    });

    // Rule 2 — the H1's promise is the claim most likely to be believed, so it
    // is the one that must carry evidence.
    it(`${page.slug}: exactly one headline claim, and it is evidenced`, () => {
      const headlines = ((data.claims ?? []) as Array<Record<string, any>>).filter((c) => c.headline);
      expect(headlines).toHaveLength(1);
      expect(headlines[0]?.evidence).toBeTruthy();
    });

    // Rule 3 — sixty pages recycling the landing page's sentences is a doorway
    // network. Each page has to say something / does not already say.
    it(`${page.slug}: no claim restates a / claim verbatim`, () => {
      for (const claim of (data.claims ?? []) as Array<Record<string, any>>) {
        expect(
          landingText.includes(squash(claim.text)),
          `${page.slug} repeats a sentence already on the landing page: "${claim.text}"`,
        ).toBe(false);
      }
    });

    it(`${page.slug}: related slugs resolve`, () => {
      for (const slug of (data.related ?? []) as string[]) {
        expect(slugs.has(slug), `${page.slug} links to /tools/${slug}, which does not exist`).toBe(true);
      }
    });
  }

  it('metaTitle and metaDescription are unique across pages', () => {
    const titles = pages.map((p) => p.data?.metaTitle);
    const descriptions = pages.map((p) => p.data?.metaDescription);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
