import { badRequest, httpError } from '../lib/errors'

export function getGoogleLoginConfig() {
  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_LOGIN_REDIRECT_URI?.trim() || 'http://localhost:3001/api/auth/google/callback'
  if (!clientId || !clientSecret) {
    throw httpError(503, 'Google Login is not configured on this server', 'GOOGLE_LOGIN_NOT_CONFIGURED')
  }
  return { clientId, clientSecret, redirectUri }
}

export function getGoogleGmailConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:3001/api/integrations/google/callback'
  if (!clientId || !clientSecret) {
    throw httpError(503, 'Gmail integration is not configured on this server', 'GMAIL_NOT_CONFIGURED')
  }
  return { clientId, clientSecret, redirectUri }
}

/** Generates OAuth URL for Google Login & Signup */
export function getGoogleLoginAuthUrl(state?: string): string {
  const { clientId, redirectUri } = getGoogleLoginConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state: state || 'login',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/** Exchanges authorization code for tokens and verifies ID Token / UserInfo for Google Login */
export async function exchangeAndVerifyGoogleLoginCode(code: string, redirectUriOverride?: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleLoginConfig()
  const effectiveRedirectUri = redirectUriOverride || redirectUri

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: effectiveRedirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text()
    throw badRequest(`Google authorization failed: ${errorBody}`, 'GOOGLE_AUTH_FAILED')
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; id_token?: string }

  // Fetch verified user profile using access_token
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!userRes.ok) {
    throw badRequest('Failed to fetch user info from Google', 'GOOGLE_USERINFO_FAILED')
  }

  const userInfo = (await userRes.json()) as {
    sub: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }

  if (!userInfo.sub) {
    throw badRequest('Google user profile is missing required subject identifier', 'GOOGLE_INVALID_PROFILE')
  }

  return {
    googleSub: userInfo.sub,
    email: userInfo.email?.toLowerCase().trim() || null,
    emailVerified: !!userInfo.email_verified,
    displayName: userInfo.name?.trim() || null,
    avatarUrl: userInfo.picture || null,
  }
}

/** Generates OAuth URL for Gmail Connect (offline access with prompt=consent) */
export function getGoogleGmailAuthUrl(workspaceId: string, userId: string): string {
  const { clientId, redirectUri } = getGoogleGmailConfig()
  const statePayload = Buffer.from(JSON.stringify({ workspaceId, userId, nonce: Date.now() })).toString('base64url')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state: statePayload,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/** Exchanges authorization code for tokens and retrieves primary Gmail email address */
export async function exchangeGoogleGmailCode(code: string, redirectUriOverride?: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleGmailConfig()
  const effectiveRedirectUri = redirectUriOverride || redirectUri

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: effectiveRedirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text()
    throw badRequest(`Gmail authorization failed: ${errorBody}`, 'GMAIL_AUTH_FAILED')
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }

  // Fetch primary Gmail address via Gmail profile API or userinfo
  let emailAddress = ''
  try {
    const gmailProfileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (gmailProfileRes.ok) {
      const profile = (await gmailProfileRes.json()) as { emailAddress?: string }
      if (profile.emailAddress) emailAddress = profile.emailAddress.toLowerCase().trim()
    }
  } catch {
    // fallback to userinfo
  }

  if (!emailAddress) {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    if (userRes.ok) {
      const userInfo = (await userRes.json()) as { email?: string }
      if (userInfo.email) emailAddress = userInfo.email.toLowerCase().trim()
    }
  }

  if (!emailAddress) {
    throw badRequest('Could not determine authorized Gmail address', 'GMAIL_EMAIL_UNKNOWN')
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresIn: tokenData.expires_in,
    emailAddress,
    scope: tokenData.scope,
  }
}

/** Automatically refreshes an expired access token using a refresh token */
export async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleGmailConfig()

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text()
    throw badRequest(`Failed to refresh Google access token: ${errorBody}`, 'GMAIL_REFRESH_FAILED')
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; expires_in: number }
  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
  }
}
