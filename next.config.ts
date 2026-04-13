import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent MIME-type sniffing
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          // Deny embedding in iframes (clickjacking protection)
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // Force HTTPS for 1 year, including subdomains
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Disable legacy XSS auditor (modern browsers ignore it, but still)
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          // Referrer policy: only send origin on same-origin requests
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Permissions policy: restrict sensitive APIs
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
          // Content Security Policy
          // - Scripts: self + unpkg for ffmpeg.wasm CDN
          // - Styles: self + unsafe-inline required for Tailwind
          // - Fonts: self + Google Fonts
          // - Connect: self + Supabase + LiveKit + Gemini + R2
          // - Worker: blob: required for ffmpeg.wasm Web Workers
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "connect-src 'self' https://*.supabase.co wss://*.livekit.cloud https://*.r2.cloudflarestorage.com https://generativelanguage.googleapis.com",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
