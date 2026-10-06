/**
 * Transparent proxy to the Lunch API.
 *
 * The browser calls `/api/v1/...` on this origin; this handler forwards it to
 * the API and passes `Set-Cookie` straight back. Doing it this way means:
 *
 *   • session cookies are first-party, so httpOnly works in every browser
 *     without third-party-cookie or SameSite exemptions, and
 *   • the API's address is never exposed to the client bundle.
 *
 * It is a dumb pipe on purpose — no business logic belongs here.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { serverConfig } from '@/lib/config';

/** Hop-by-hop and length headers must not be copied through a proxy. */
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const search = req.nextUrl.search;
  // `path` is everything after this app's `/api/`, so `/api/v1/auth/login`
  // arrives as ['v1','auth','login'] and must be re-prefixed to reach the API's
  // own `/api/v1/...` surface.
  const target = `${serverConfig.apiBaseUrl}/api/${path.join('/')}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  // Let the API log the real client address rather than the Next.js server's.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = !['GET', 'HEAD'].includes(req.method);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(hasBody ? { body: await req.arrayBuffer() } : {}),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    // The API being down is an infrastructure fault, not a client error.
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'The Lunch service is unreachable. Please try again.' } },
      { status: 503 }
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.append(key, value);
  });
  // `Headers.forEach` folds multiple Set-Cookie values into one string, which
  // would break multi-cookie responses. getSetCookie() preserves them.
  responseHeaders.delete('set-cookie');
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append('set-cookie', cookie);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Context) {
  return proxy(req, (await ctx.params).path);
}
