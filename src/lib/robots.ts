/**
 * Minimal robots.txt evaluator — the Google REP subset that matters in the
 * wild: user-agent groups, longest-match precedence, Allow winning ties,
 * `*` wildcards, and the `$` end anchor.
 *
 * Wildcards are matched iteratively with indexOf instead of being compiled
 * to regexes: robots.txt is attacker-controlled input (the target site's),
 * and `*`-heavy patterns as regexes invite catastrophic backtracking.
 *
 * Percent-encoding equivalence between rule and path is not normalized;
 * both sides are compared as-is. Real-world files rarely mix encodings.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/**
 * Extract the rules that apply to our user agent: the union of groups whose
 * user-agent line equals `userAgentToken` (case-insensitive) if any exist,
 * else the `*` groups. A group naming us but containing no rules means
 * "everything allowed" — it still suppresses the `*` groups.
 */
export function parseRobotsGroups(text: string, userAgentToken: string): RobotsRule[] {
  const token = userAgentToken.toLowerCase();
  const exactRules: RobotsRule[] = [];
  const wildcardRules: RobotsRule[] = [];
  let sawExactGroup = false;
  let currentAgents: string[] = [];
  // A run of consecutive user-agent lines shares the rules that follow; the
  // next user-agent line after a rule starts a new group.
  let inRules = false;

  for (let line of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const hash = line.indexOf('#');
    if (hash !== -1) line = line.slice(0, hash);
    line = line.trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (inRules) {
        currentAgents = [];
        inRules = false;
      }
      currentAgents.push(value.toLowerCase());
      if (value.toLowerCase() === token) sawExactGroup = true;
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      // "Disallow:" with an empty value matches nothing.
      if (value === '') continue;
      const rule = { allow: field === 'allow', pattern: value };
      if (currentAgents.includes(token)) exactRules.push(rule);
      else if (currentAgents.includes('*')) wildcardRules.push(rule);
    }
    // sitemap:, crawl-delay:, etc. are ignored and do not end a group.
  }
  return sawExactGroup ? exactRules : wildcardRules;
}

function matchesPattern(pattern: string, path: string): boolean {
  let anchored = false;
  if (pattern.endsWith('$')) {
    anchored = true;
    pattern = pattern.slice(0, -1);
  }
  const segments = pattern.split('*');
  const first = segments[0] as string;
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] as string;
    if (seg === '') continue; // consecutive or trailing '*'
    if (anchored && i === segments.length - 1) {
      const idx = path.lastIndexOf(seg);
      return idx >= pos && idx + seg.length === path.length;
    }
    const idx = path.indexOf(seg, pos);
    if (idx === -1) return false;
    pos = idx + seg.length;
  }
  if (anchored) {
    // Either no wildcard at all (exact match required) or the pattern ended
    // with '*$' (any suffix reaches the end).
    return segments.length === 1 ? pos === path.length : true;
  }
  return true;
}

/** Longest matching pattern wins; on equal length, Allow beats Disallow. */
export function isPathAllowed(rules: RobotsRule[], pathAndQuery: string): boolean {
  let bestLength = -1;
  let bestAllow = true;
  for (const rule of rules) {
    if (!matchesPattern(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow && !bestAllow)) {
      bestLength = length;
      bestAllow = rule.allow;
    }
  }
  return bestLength === -1 ? true : bestAllow;
}
