import { describe, expect, it } from 'vitest';
// Inlined at build time by Vite, so this works inside workerd (no fs there).
import agentsMd from '../../AGENTS.md?raw';
import { IMAGE_SOURCES, TRUNCATION_REASONS } from './extract';

/**
 * AGENTS.md's manifest snippet duplicates two unions from extract.ts for
 * readability. These tests are what "derived from one constant" means for a
 * markdown file: the doc can't import TypeScript, so drift becomes a test
 * failure instead of a doc lie.
 */
describe('AGENTS.md stays in sync with extract.ts', () => {
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
});
