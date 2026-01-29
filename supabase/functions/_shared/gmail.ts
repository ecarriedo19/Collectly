/**
 * Gmail Client for Edge Functions
 * 
 * Handles Gmail OAuth token refresh and email operations.
 */

import { supabaseAdmin } from './supabase.ts'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1'

interface GmailTokens {
  access_token: string
  refresh_token: string
  token_expiry: string
}

interface GmailMessage {
  id: string
  threadId: string
  snippet: string
  payload: {
    headers: Array<{ name: string; value: string }>
  }
}

/**
 * Get Gmail client for a workspace
 * Automatically refreshes token if expired
 */
export async function getGmailTokens(workspaceId: string): Promise<GmailTokens | null> {
  const { data: connection, error } = await supabaseAdmin
    .from('gmail_connections')
    .select('access_token, refresh_token, token_expiry, connection_id')
    .eq('workspace_id', workspaceId)
    .single()
  
  if (error || !connection) {
    return null
  }
  
  // Check if token is expired
  const expiry = new Date(connection.token_expiry)
  const now = new Date()
  
  if (expiry <= now) {
    // Refresh the token
    const newTokens = await refreshGmailToken(connection.refresh_token)
    if (!newTokens) {
      return null
    }
    
    // Update stored tokens
    await supabaseAdmin
      .from('gmail_connections')
      .update({
        access_token: newTokens.access_token,
        token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
      })
      .eq('connection_id', connection.connection_id)
    
    return {
      access_token: newTokens.access_token,
      refresh_token: connection.refresh_token,
      token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    }
  }
  
  return {
    access_token: connection.access_token,
    refresh_token: connection.refresh_token,
    token_expiry: connection.token_expiry,
  }
}

/**
 * Refresh Gmail access token
 */
async function refreshGmailToken(refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  
  if (!clientId || !clientSecret) {
    console.error('Google OAuth credentials not configured')
    return null
  }
  
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    
    if (!response.ok) {
      console.error('Token refresh failed:', await response.text())
      return null
    }
    
    return await response.json()
  } catch (error) {
    console.error('Token refresh error:', error)
    return null
  }
}

/**
 * Send email via Gmail API
 */
export async function sendGmailEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  replyToMessageId?: string
): Promise<{ messageId: string; threadId: string } | null> {
  // Build MIME message
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
  ]
  
  if (replyToMessageId) {
    headers.push(`In-Reply-To: ${replyToMessageId}`)
    headers.push(`References: ${replyToMessageId}`)
  }
  
  const mimeMessage = `${headers.join('\r\n')}\r\n\r\n${body}`
  const encodedMessage = btoa(mimeMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  
  try {
    const response = await fetch(`${GMAIL_API_URL}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodedMessage }),
    })
    
    if (!response.ok) {
      console.error('Gmail send failed:', await response.text())
      return null
    }
    
    const data = await response.json()
    return {
      messageId: data.id,
      threadId: data.threadId,
    }
  } catch (error) {
    console.error('Gmail send error:', error)
    return null
  }
}

/**
 * Check for replies in a Gmail thread
 */
export async function checkThreadForReplies(
  accessToken: string,
  threadId: string,
  afterMessageId: string
): Promise<GmailMessage[]> {
  try {
    const response = await fetch(
      `${GMAIL_API_URL}/users/me/threads/${threadId}?format=metadata`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    
    if (!response.ok) {
      return []
    }
    
    const thread = await response.json()
    const messages: GmailMessage[] = thread.messages || []
    
    // Find messages after our sent message (replies)
    const afterIndex = messages.findIndex((m: GmailMessage) => m.id === afterMessageId)
    if (afterIndex === -1) {
      return []
    }
    
    // Return only inbound messages (not from us)
    return messages.slice(afterIndex + 1).filter((m: GmailMessage) => {
      const fromHeader = m.payload.headers.find(h => h.name.toLowerCase() === 'from')
      // Check if this is an inbound message (simple check - not from our domain)
      return fromHeader && !fromHeader.value.includes('@gmail.com') // TODO: Better check
    })
  } catch (error) {
    console.error('Thread check error:', error)
    return []
  }
}

/**
 * Get user's Gmail address
 */
export async function getGmailUserEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${GMAIL_API_URL}/users/me/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    return data.emailAddress
  } catch {
    return null
  }
}
