/**
 * tailwind.config.ts
 *
 * Tailwind v4 still supports this file for content scanning configuration.
 * All design tokens (colors, fonts, animations) are defined in globals.css
 * via @theme — which is the v4-native approach.
 *
 * This file is kept for content path configuration and IDE support.
 */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
};

export default config;
