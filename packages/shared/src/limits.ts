/**
 * Largest upload the server accepts, in MB — the one number both sides use: the
 * server's default limit (apps/server MediaService; env UPLOAD_MAX_SIZE_MB may
 * override it, e.g. tests) and the SDK's pre-check before sending.
 * 100 MB ≈ 2 minutes of 720p capture at 6 Mbps video + audio + container.
 */
export const MAX_UPLOAD_MB = 100
