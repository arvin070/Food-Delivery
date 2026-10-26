import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(appDirectory, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() { return [{source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Content-Security-Policy',value:"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"},
  ]}]; },
  // @lunch/shared ships as TypeScript-compiled CJS from the workspace.
  transpilePackages: ['@lunch/shared'],
  eslint: { ignoreDuringBuilds: true },
  // The browser never calls the API directly; it goes through the proxy route
  // in src/app/api/[...path]/route.ts so auth cookies stay first-party.
  env: {},
};

export default nextConfig;
