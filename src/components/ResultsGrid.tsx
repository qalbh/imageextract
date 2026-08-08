import { useEffect, useState } from 'react';
import type { ScanResult } from '../lib/extract';
import ImageCard from './ImageCard';

/**
 * The page's only island. The URL form is static HTML that submits ?url=
 * via native browser behavior; this component reads the param on mount and
 * runs the scan, so the input works with zero JavaScript and every scan has
 * a shareable URL.
 */

type ViewState =
  | { kind: 'idle' }
  | { kind: 'loading'; hostname: string }
  | { kind: 'error'; code: string; heading: string; message: string; retry: boolean }
  | { kind: 'robots-blocked' }
  | { kind: 'empty' }
  | { kind: 'results'; result: ScanResult };

const ERRORS: Record<string, { heading: string; retry: boolean }> = {
  'invalid-request': { heading: "That doesn't look like a URL", retry: false },
  'invalid-url': { heading: "That doesn't look like a URL", retry: false },
  'bad-scheme': { heading: 'Only http and https pages can be scanned', retry: false },
  'bad-port': { heading: "Pages on non-standard ports can't be scanned", retry: false },
  'private-ip': { heading: "That address isn't scannable", retry: false },
  'blocked-hostname': { heading: "That address isn't scannable", retry: false },
  'dns-private': { heading: "That address isn't scannable", retry: false },
  'dns-nxdomain': { heading: 'Domain not found', retry: false },
  'dns-error': { heading: "DNS didn't answer", retry: true },
  'too-many-redirects': { heading: 'Too many redirects', retry: false },
  timeout: { heading: 'The site took too long to respond', retry: true },
};

async function runScan(url: string): Promise<ViewState> {
  let response: Response;
  try {
    response = await fetch(`/api/scan?url=${encodeURIComponent(url)}`);
  } catch {
    return {
      kind: 'error',
      code: 'network',
      heading: 'The scan request failed to send',
      message: 'Check your connection and try again.',
      retry: true,
    };
  }
  if (!response.ok) {
    let code = `http-${response.status}`;
    let message = `The scan failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch {
      // Non-JSON error body (e.g. a raw 500) — keep the status-based text.
    }
    const known = ERRORS[code];
    return {
      kind: 'error',
      code,
      heading: known?.heading ?? `The scan failed (HTTP ${response.status})`,
      message,
      retry: known?.retry ?? false,
    };
  }
  const result = (await response.json()) as ScanResult;
  if (result.robotsBlocked === true) return { kind: 'robots-blocked' };
  if (result.images.length === 0) return { kind: 'empty' };
  return { kind: 'results', result };
}

function TruncatedBanner({ reason }: { reason: 'image-cap' | 'size-cap' }) {
  // The two reasons demand different advice: image-cap means everything was
  // seen and the list was trimmed; size-cap means part of the page was never
  // parsed at all.
  return (
    <p className="mb-sm rounded-sm border border-warning-border bg-warning-bg px-sm py-xs text-small text-warning-text">
      {reason === 'image-cap'
        ? 'The whole page was scanned, but it has more than 1,000 images — showing the first 1,000.'
        : 'This page was too large to read completely, so some images may be missing entirely. Scanning a more specific page on the same site may find more.'}
    </p>
  );
}

export default function ResultsGrid() {
  const [state, setState] = useState<ViewState>({ kind: 'idle' });

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get('url');
    if (!url) return;
    // Prefill the static form input so the address being shown matches the
    // scan being run — the input itself ships no JS, so the island does it.
    const input = document.getElementById('scan-url');
    if (input instanceof HTMLInputElement) input.value = url;
    let hostname = url;
    try {
      hostname = new URL(url).hostname;
    } catch {
      // let the API produce the proper invalid-url error
    }
    setState({ kind: 'loading', hostname });
    void runScan(url).then(setState);
  }, []);

  switch (state.kind) {
    case 'idle':
      // Reached on /results with no ?url= — never leave the page blank.
      return (
        <p className="py-lg text-center text-small text-muted">
          Paste a page URL above and hit Scan — every image on the page shows up here.
        </p>
      );
    case 'loading':
      // Skeleton grid rather than a static line — scanning runs for seconds
      // and a frozen message provokes re-submits. Status text is announced
      // for screen readers; the tiles carry the visible progress.
      return (
        <div>
          <p role="status" className="sr-only">
            Scanning {state.hostname}…
          </p>
          <ul
            className="grid gap-md"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--layout-tile-min), 1fr))' }}
            aria-hidden="true"
          >
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="skeleton-tile" />
            ))}
          </ul>
        </div>
      );
    case 'error':
      return (
        <div role="alert" className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">{state.heading}</h2>
          <p className="text-small text-muted">{state.message}</p>
          {state.retry && (
            <p className="mt-xs text-small text-muted">This is usually temporary — try again in a moment.</p>
          )}
        </div>
      );
    case 'robots-blocked':
      return (
        <div className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">
            This site has asked automated tools not to access this page.
          </h2>
          <p className="text-small text-muted">We respect that, so there is nothing to show.</p>
        </div>
      );
    case 'empty':
      return (
        <div className="mx-auto max-w-message py-lg text-center">
          <h2 className="mb-xs font-semibold text-text">No images found</h2>
          <p className="text-small text-muted">
            The page was scanned successfully, but nothing on it looks like an image.
          </p>
        </div>
      );
    case 'results':
      return (
        <div>
          {state.result.truncated !== undefined && <TruncatedBanner reason={state.result.truncated} />}
          <p className="mb-sm font-mono text-label uppercase text-muted">
            {state.result.images.length} image{state.result.images.length === 1 ? '' : 's'}
          </p>
          {/* Columns from --layout-tile-min via auto-fill (inline style — an
              arbitrary Tailwind utility would be off-token). gap = --spacing-md
              (24px, the grid gutter). */}
          <ul
            className="grid gap-md"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(var(--layout-tile-min), 1fr))' }}
          >
            {state.result.images.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </ul>
        </div>
      );
  }
}
