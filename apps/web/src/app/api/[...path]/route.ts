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
import { NextResponse, type NextRequest } from "next/server";
import { serverConfig } from "@/lib/config";

/** Hop-by-hop and length headers must not be copied through a proxy. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "forwarded",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (
    path[0] !== "v1" ||
    path.some((p) => p === "." || p === ".." || /[\\/?#]/.test(p))
  )
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid API path" } },
      { status: 400 },
    );
  const search = req.nextUrl.search;
  // `path` is everything after this app's `/api/`, so `/api/v1/auth/login`
  // arrives as ['v1','auth','login'] and must be re-prefixed to reach the API's
  // own `/api/v1/...` surface.
  const target = `${serverConfig.apiBaseUrl}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase()))
      headers.set(key, value);
  });
  // Caddy overwrites these values at the only public ingress. The API is not
  // host-published and trusts exactly this Next.js proxy hop.
  const clientIp = req.headers.get('x-forwarded-for');
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  if (forwardedProto) headers.set('x-forwarded-proto', forwardedProto);

  const hasBody = !["GET", "HEAD"].includes(req.method);

  let body: Uint8Array | undefined;
  if (hasBody && req.body) {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 1048576) {
        await reader.cancel();
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Request body too large" } },
          { status: 413 },
        );
      }
      chunks.push(chunk.value);
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      ...(body ? { body: body as BodyInit } : {}),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(
        req.method === 'GET' && path[1] === 'tracking' &&
        (path.join('/') === 'v1/tracking/events' || path.join('/') === 'v1/tracking/meals/events') ? 60000 : 15000,
      )]),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    // The API being down is an infrastructure fault, not a client error.
    return NextResponse.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The Lunch service is unreachable. Please try again.",
        },
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase()))
      responseHeaders.append(key, value);
  });
  // `Headers.forEach` folds multiple Set-Cookie values into one string, which
  // would break multi-cookie responses. getSetCookie() preserves them.
  responseHeaders.delete("set-cookie");
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
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
