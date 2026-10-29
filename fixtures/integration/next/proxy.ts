import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = ["default-src 'none'", `script-src 'self' 'nonce-${nonce}'`, `style-src 'self' 'nonce-${nonce}'`, "style-src-attr 'none'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|audit.js).*)'] };
