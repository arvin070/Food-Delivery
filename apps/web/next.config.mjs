/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @lunch/shared ships as TypeScript-compiled CJS from the workspace.
  transpilePackages: ['@lunch/shared'],
  eslint: { ignoreDuringBuilds: true },
  // The browser never calls the API directly; it goes through the proxy route
  // in src/app/api/[...path]/route.ts so auth cookies stay first-party.
  env: {},
};

export default nextConfig;
