export class ApiError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, options: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
  }
}

export function toApiError(error: unknown, fallback = 'Request failed') {
  if (error instanceof ApiError) return error
  if (error instanceof Error) return new ApiError(error.message, { cause: error })
  return new ApiError(fallback, { cause: error })
}
