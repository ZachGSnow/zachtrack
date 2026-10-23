import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// package.json is the one source of the version; releases tag the same value.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    svelte(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ZachTrack',
        short_name: 'ZachTrack',
        description: 'A personal fasting timer and everything tracker with cross-metric charting.',
        theme_color: '#0b0f0e',
        background_color: '#0b0f0e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the installed app's icon (Android) for these. See src/lib/utils/shortcuts.ts.
        shortcuts: [
          {
            name: 'Start a fast',
            short_name: 'Start fast',
            description: 'Start a fast with your default method',
            url: '/?shortcut=start-fast#/',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Trackables',
            short_name: 'Trackables',
            description: 'Log something or check what is due',
            url: '/#/trackables',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Journey',
            short_name: 'Journey',
            description: 'Fasting streaks and history',
            url: '/#/journey',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Never answer these navigations with the cached app shell -- they must
        // reach the network so Cloudflare Access can run its login/callback
        // flow (see ARCHITECTURE.md 4.9). `?reauth=` is the marker the sync
        // store's `reauthenticate()` uses to force a real network navigation.
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//, /[?&]reauth=/],
      },
    }),
  ],
})
