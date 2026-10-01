import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './generated/types'

type ClientConfig = {
  baseUrl: string
  getToken?: () => string | null  // only for native apps; web uses httpOnly cookies
}

let _client: ReturnType<typeof createClient<paths>> | null = null
let _baseUrl = ''

export function createApiClient(config: ClientConfig) {
  const client = createClient<paths>({
    baseUrl: config.baseUrl,
    credentials: 'include',  // send httpOnly session cookie automatically
  })

  if (config.getToken) {
    const authMiddleware: Middleware = {
      async onRequest({ request }) {
        const token = config.getToken!()
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
        return request
      },
    }
    client.use(authMiddleware)
  }

  _client = client
  _baseUrl = config.baseUrl.replace(/\/$/, '')
  return client
}

export function getApiClient() {
  if (!_client) throw new Error('Call createApiClient() before using hooks.')
  return _client
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// For transports openapi-fetch doesn't cover (EventSource).
export function getApiBaseUrl() {
  if (!_client) throw new Error('Call createApiClient() before using hooks.')
  return _baseUrl
}

// Unwraps openapi-fetch results: throws ApiError (with server `code`) or returns data.
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const err = (result.error ?? {}) as { error?: string; code?: string }
    throw new ApiError(result.response.status, err.error ?? result.response.statusText, err.code)
  }
  return result.data
}
