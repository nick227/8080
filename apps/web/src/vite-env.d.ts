/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />

/** Versioned runtime asset URLs for the virtual background (vite.config.ts `define`). */
declare const __VBG_ASSETS__: { mediapipe: string; ort: string; modnet: string }

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_API_MODE?: 'http' | 'mock'
}
