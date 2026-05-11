/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { typedRoutes: true },
  transpilePackages: ["@tcr/db"],
};
export default nextConfig;
