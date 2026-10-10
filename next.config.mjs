// Files the API routes read from disk at runtime must be bundled into the serverless functions on Vercel.
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**/*", "./cache/**/*", "./data/synthetic/**/*"],
  },
};
export default nextConfig;
