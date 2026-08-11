import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobotsGroups, type RobotsRule } from './robots';

const UA = 'imageextract';

function allowed(robots: string, path: string): boolean {
  return isPathAllowed(parseRobotsGroups(robots, UA), path);
}

describe('parseRobotsGroups', () => {
  it('returns star-group rules when our agent is not named', () => {
    const rules = parseRobotsGroups('User-agent: *\nDisallow: /private/', UA);
    expect(rules).toEqual([{ allow: false, pattern: '/private/' }]);
  });

  it('prefers our exact group over the star group', () => {
    const robots = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: ImageExtract',
      'Disallow: /only-this/',
    ].join('\n');
    expect(parseRobotsGroups(robots, UA)).toEqual([{ allow: false, pattern: '/only-this/' }]);
  });

  it('an empty group naming us suppresses the star group', () => {
    const robots = ['User-agent: *', 'Disallow: /', '', 'User-agent: imageextract'].join('\n');
    expect(parseRobotsGroups(robots, UA)).toEqual([]);
    expect(allowed(robots, '/anything')).toBe(true);
  });

  it('stacked user-agent lines share the following rules', () => {
    const robots = ['User-agent: otherbot', 'User-agent: imageextract', 'Disallow: /x'].join('\n');
    expect(parseRobotsGroups(robots, UA)).toEqual([{ allow: false, pattern: '/x' }]);
  });

  it('a user-agent line after rules starts a new group', () => {
    const robots = [
      'User-agent: imageextract',
      'Disallow: /ours',
      'User-agent: otherbot',
      'Disallow: /theirs',
    ].join('\n');
    expect(parseRobotsGroups(robots, UA)).toEqual([{ allow: false, pattern: '/ours' }]);
  });

  it('ignores comments, blank lines, unknown fields, and CRLF', () => {
    const robots = 'User-agent: * # everyone\r\nCrawl-delay: 10\r\n\r\nDisallow: /a # comment\r\nSitemap: https://x.example/s.xml\r\n';
    expect(parseRobotsGroups(robots, UA)).toEqual([{ allow: false, pattern: '/a' }]);
  });

  it('treats an empty Disallow value as no rule', () => {
    expect(parseRobotsGroups('User-agent: *\nDisallow:', UA)).toEqual([]);
  });
});

describe('isPathAllowed', () => {
  it('allows everything when there are no rules', () => {
    expect(isPathAllowed([], '/any/path')).toBe(true);
  });

  it('matches by prefix', () => {
    expect(allowed('User-agent: *\nDisallow: /private/', '/private/photo.jpg')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /private/', '/public/photo.jpg')).toBe(true);
    expect(allowed('User-agent: *\nDisallow: /', '/anything')).toBe(false);
  });

  it('longest match wins', () => {
    const robots = ['User-agent: *', 'Disallow: /shop/', 'Allow: /shop/images/'].join('\n');
    expect(allowed(robots, '/shop/cart')).toBe(false);
    expect(allowed(robots, '/shop/images/a.png')).toBe(true);
  });

  it('allow wins a tie of equal length', () => {
    const rules: RobotsRule[] = [
      { allow: false, pattern: '/dir/a' },
      { allow: true, pattern: '/dir/b' },
    ];
    // Same-length patterns, only one matches — sanity
    expect(isPathAllowed(rules, '/dir/a')).toBe(false);
    // True tie: identical pattern both ways
    const tie: RobotsRule[] = [
      { allow: false, pattern: '/page' },
      { allow: true, pattern: '/page' },
    ];
    expect(isPathAllowed(tie, '/page')).toBe(true);
  });

  it('supports * wildcards', () => {
    expect(allowed('User-agent: *\nDisallow: /*.pdf', '/docs/manual.pdf')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /*.pdf', '/docs/manual.html')).toBe(true);
    expect(allowed('User-agent: *\nDisallow: /a*/b', '/anything/b')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /a*/b', '/anything/c')).toBe(true);
  });

  it('supports the $ end anchor', () => {
    expect(allowed('User-agent: *\nDisallow: /*.php$', '/index.php')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /*.php$', '/index.php?x=1')).toBe(true);
    expect(allowed('User-agent: *\nDisallow: /exact$', '/exact')).toBe(false);
    expect(allowed('User-agent: *\nDisallow: /exact$', '/exact/sub')).toBe(true);
  });

  it('matches against path plus query string', () => {
    expect(allowed('User-agent: *\nDisallow: /*?print=', '/article?print=1')).toBe(false);
  });

  it('survives pathological wildcard patterns without blowing up', () => {
    const hostile = `User-agent: *\nDisallow: /${'*a'.repeat(500)}`;
    const path = `/${'a'.repeat(2000)}b`;
    const started = Date.now();
    expect(allowed(hostile, path)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('the renamed token still matches name-specific rules (UA rename, 2026-08-10)', () => {
  // The matcher keys on UA_TOKEN, not on parsing USER_AGENT — the two
  // constants renamed together, and these pin the pairing.
  it('a group naming ImageExtract is honoured under the new token', () => {
    const robots = ['User-agent: *', 'Allow: /', '', 'User-agent: ImageExtract', 'Disallow: /'].join('\n');
    expect(allowed(robots, '/anything')).toBe(false);
  });

  it('a version-suffixed group (ImageExtract/1.0) does NOT match — equality per spec', () => {
    // The stacked silent-failure a site owner can hit: this rule looks
    // right, matches nothing, and /traffic never mentions robots at all.
    // Recorded in DECISIONS ("The User-Agent presents as a user-directed
    // fetch") as one half of the future reconsideration.
    const robots = ['User-agent: ImageExtract/1.0', 'Disallow: /'].join('\n');
    expect(allowed(robots, '/anything')).toBe(true);
  });
});
