import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// zod direct, not the `z` re-exported by astro:content — that alias is
// deprecated in Astro 7. Same zod the Worker boundary validates with (4.4.3).
import { z } from 'zod';
import { SOURCE_GROUPS, canonicalFormats } from './lib/results-model';

/**
 * Tool-variant landing pages (/tools/<slug>) — the SEO surface.
 *
 * The schema's job is not shape validation, it is CLAIM DISCIPLINE at scale.
 * /privacy and /terms were written by reading the code before writing the
 * sentence; that worked because there were two of them. There will be sixty of
 * these, and a landing page promising a capability we lack is the same failure
 * class as a false privacy claim — so the verification is a FIELD here, not a
 * habit, and a companion test walks every claim's evidence.
 *
 * Three rules are encoded below (agreed 2026-08-12):
 *   1. No page ships without a `limits` entry. Every variant has one; a page
 *      with nothing to caveat is a page nobody checked.
 *   2. No page ships without a corpus row or code symbol behind its headline
 *      capability claim — hence `evidence` is required on every claim and
 *      exactly one claim is the headline.
 *   3. Claims may not restate a claim already on `/` verbatim. That one cannot
 *      be a zod rule (it is a comparison against another page's rendered
 *      copy); it lives in the claims test.
 */

// The funnel vocabulary is the SHIPPED vocabulary, imported rather than
// retyped: `format=` takes ImageExt values and `source=` takes source-group
// ids, exactly as parseFormatParam/parseSourceParam accept them on /results.
// Remove a format from the sidebar and every page promising it fails the build
// here, which is the coupling we want — the page cannot outlive the filter.
const FORMAT_VALUES = canonicalFormats();
const GROUP_VALUES = SOURCE_GROUPS.map((group) => group.id);
const formatValue = z.enum(FORMAT_VALUES as [string, ...string[]]);
const groupValue = z.enum(GROUP_VALUES as [string, ...string[]]);

// Evidence is one of two kinds, both machine-checkable:
//   code   — an identifier that must exist in src/ (the doc-sync layer-2 rule,
//            applied to page copy instead of docs)
//   corpus — a page in the measured corpus plus the figure being cited, both
//            of which must appear in docs/frontend-plan.md
const evidence = z.union([
  z.object({ code: z.string().min(1) }).strict(),
  z.object({ corpus: z.string().min(1), figure: z.string().min(1) }).strict(),
]);

// Claims and limits are rendered as TEXT, not markdown — they are structured
// data the page lays out itself, so a backtick prints as a backtick. Caught on
// page one, where "`<img src>`" shipped to the built HTML with its backticks
// visible. Rejected at the schema rather than left to proofreading, because
// the mistake is invisible in the source file and only appears in the build.
// Formatting belongs in the markdown body, which is rendered.
const prose = z
  .string()
  .min(1)
  .refine((text) => !text.includes('`'), {
    message: 'claims and limits render as plain text — move backticked code into the markdown body',
  });

const claim = z
  .object({
    // The sentence as a visitor reads it. Kept as data, not prose in the body,
    // precisely so it can be checked.
    text: prose,
    // Exactly one claim per page carries the page's headline capability — the
    // thing the H1 promises. Rule 2 applies to it hardest.
    headline: z.boolean().default(false),
    evidence,
  })
  .strict();

// A page's copy can be true BECAUSE something does not exist yet. That is a
// dependency in the opposite direction from `evidence`, and it is the one that
// rots silently: the capability ships, the sentence stays, and nobody re-reads
// a page written three months ago. So it is declared as data and the companion
// test asserts the symbol is ABSENT — the day it ships, the suite goes red and
// names the page and the paragraph. Same self-retiring shape as doc-sync's
// `kind: 'planned'` allowlist entries, applied to page copy.
//
// This generalises on purpose: sixty pages will accumulate more of these, and
// each one is three lines rather than a comment nobody re-reads.
const assumption = z
  .object({
    // The exported identifier whose ARRIVAL invalidates the copy. Pick the
    // name the future implementation will actually use, and record that name
    // wherever the work is tracked so the implementer collides with it.
    absent: z.string().min(1),
    // Which part of the page goes stale — precise enough to edit without
    // re-reading the whole file.
    affects: z.string().min(1),
    // What the copy will have to say instead. Written now, while the reasoning
    // is in someone's head, not later under a red suite.
    because: z.string().min(1),
  })
  .strict();

const limit = z
  .object({
    // What we cannot do, in the visitor's terms, before they spend a scan
    // finding out. This is the field that keeps sixty pages honest.
    text: prose,
    // Optional but encouraged: the constant or corpus row that sets the limit.
    evidence: evidence.optional(),
  })
  .strict();

const tools = defineCollection({
  loader: glob({ base: './src/content/tools', pattern: '**/*.md' }),
  schema: z
    .object({
      // Rendered as <h1>; deliberately separate from metaTitle, which carries
      // the site suffix and reads as a search result rather than a heading.
      h1: z.string().min(1),
      metaTitle: z.string().min(1).max(70),
      metaDescription: z.string().min(1).max(165),
      // Which axis this page tests. With no query data yet, the first five
      // spread across all three so the first Search Console read says which
      // axis earns the next fifty-five.
      axis: z.enum(['format', 'source', 'use-case']),
      // One paragraph in the visitor's words, above the form.
      lead: z.string().min(1),
      claims: z.array(claim).min(1),
      limits: z.array(limit).min(1),
      faq: z
        .array(z.object({ q: z.string().min(1), a: z.string().min(1) }).strict())
        .default([]),
      // Copy whose truth depends on a capability NOT existing yet. See the
      // `assumption` comment above — these are checked by absence, and the
      // check fails the day the capability ships.
      assumes: z.array(assumption).default([]),
      // Slugs of sibling pages, for lateral linking. Existence is checked by
      // the claims test, not here — zod cannot see the rest of the collection.
      related: z.array(z.string()).default([]),
      // What the page's scan form appends to /results, as hidden inputs on the
      // native GET form (zero JS). This is the promise surviving the click:
      // a page titled "every PNG" hands off ?format=png.
      funnel: z
        .object({
          format: z.array(formatValue).min(1).optional(),
          source: z.array(groupValue).min(1).optional(),
        })
        .strict()
        .optional(),
      // Placeholder for the URL input where a generic one would be vaguer than
      // the page ("https://your-store.myshopify.com").
      placeholder: z.string().optional(),
    })
    .strict()
    .refine((page) => page.claims.filter((c) => c.headline).length === 1, {
      message: 'exactly one claim must be the headline (rule 2: the H1 promise needs evidence)',
      path: ['claims'],
    }),
});

export const collections = { tools };
