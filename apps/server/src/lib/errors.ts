// Services throw these; the global error handler maps them to { error, code }.
export type HttpError = { statusCode: number; message: string; code?: string }

export const httpError = (statusCode: number, message: string, code?: string): HttpError => ({
  statusCode,
  message,
  code,
})

export const notFound = (what = 'Not found') => httpError(404, what, 'NOT_FOUND')
export const forbidden = (why = 'Forbidden') => httpError(403, why, 'FORBIDDEN')
export const badRequest = (why: string, code?: string) => httpError(400, why, code)
export const conflict = (why: string, code?: string) => httpError(409, why, code)
