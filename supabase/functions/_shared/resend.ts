/**
 * Resend Email Client
 * 
 * Used for sending transactional emails (weekly digest, notifications).
 * For reminder emails, use Gmail API via gmail.ts instead.
 * 
 * Usage:
 *   import { sendEmail, sendDigestEmail } from '../_shared/resend.ts'
 *   await sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Hello</p>' })
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const DEFAULT_FROM = Deno.env.get('RESEND_FROM_EMAIL') || 'Collectly <notifications@collectly.app>'

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
}

interface ResendResponse {
  id: string
}

interface ResendError {
  statusCode: number
  message: string
  name: string
}

/**
 * Send an email via Resend API
 */
export async function sendEmail(options: SendEmailOptions): Promise<ResendResponse | null> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured')
    return null
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: options.from || DEFAULT_FROM,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
        reply_to: options.replyTo,
        tags: options.tags,
      }),
    })

    if (!response.ok) {
      const error: ResendError = await response.json()
      console.error('Resend API error:', error)
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('Failed to send email via Resend:', error)
    return null
  }
}

/**
 * Send weekly AR digest email
 */
export async function sendDigestEmail(options: {
  to: string
  workspaceName: string
  totalOpen: number
  totalOpenAmount: string
  pastDueCount: number
  pastDueAmount: string
  collected7d: number
  collected7dAmount: string
  emailsSent7d: number
  replies7d: number
  topInvoices: Array<{
    customer: string
    amount: string
    daysOverdue: number
  }>
}): Promise<ResendResponse | null> {
  const html = generateDigestHtml(options)
  
  return sendEmail({
    to: options.to,
    subject: `Weekly AR Digest - ${options.workspaceName}`,
    html,
    tags: [
      { name: 'type', value: 'weekly-digest' },
      { name: 'workspace', value: options.workspaceName },
    ],
  })
}

/**
 * Generate HTML for weekly digest email
 */
function generateDigestHtml(data: {
  workspaceName: string
  totalOpen: number
  totalOpenAmount: string
  pastDueCount: number
  pastDueAmount: string
  collected7d: number
  collected7dAmount: string
  emailsSent7d: number
  replies7d: number
  topInvoices: Array<{
    customer: string
    amount: string
    daysOverdue: number
  }>
}): string {
  const topInvoicesHtml = data.topInvoices.length > 0
    ? data.topInvoices.map(inv => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${inv.customer}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${inv.amount}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #ef4444;">${inv.daysOverdue} days</td>
        </tr>
      `).join('')
    : '<tr><td colspan="3" style="padding: 12px; text-align: center; color: #6b7280;">No past due invoices</td></tr>'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly AR Digest</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Weekly AR Digest</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${data.workspaceName}</p>
    </div>
    
    <!-- KPIs -->
    <div style="padding: 24px;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        
        <!-- Open Invoices -->
        <div style="background: #f0f9ff; border-radius: 8px; padding: 16px;">
          <p style="color: #0369a1; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Open Invoices</p>
          <p style="color: #0c4a6e; font-size: 28px; margin: 8px 0 4px; font-weight: 700;">${data.totalOpen}</p>
          <p style="color: #0369a1; font-size: 14px; margin: 0;">${data.totalOpenAmount}</p>
        </div>
        
        <!-- Past Due -->
        <div style="background: #fef2f2; border-radius: 8px; padding: 16px;">
          <p style="color: #b91c1c; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Past Due</p>
          <p style="color: #7f1d1d; font-size: 28px; margin: 8px 0 4px; font-weight: 700;">${data.pastDueCount}</p>
          <p style="color: #b91c1c; font-size: 14px; margin: 0;">${data.pastDueAmount}</p>
        </div>
        
        <!-- Collected This Week -->
        <div style="background: #f0fdf4; border-radius: 8px; padding: 16px;">
          <p style="color: #15803d; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Collected (7d)</p>
          <p style="color: #14532d; font-size: 28px; margin: 8px 0 4px; font-weight: 700;">${data.collected7d}</p>
          <p style="color: #15803d; font-size: 14px; margin: 0;">${data.collected7dAmount}</p>
        </div>
        
        <!-- Activity -->
        <div style="background: #faf5ff; border-radius: 8px; padding: 16px;">
          <p style="color: #7e22ce; font-size: 12px; margin: 0; text-transform: uppercase; font-weight: 600;">Email Activity</p>
          <p style="color: #581c87; font-size: 28px; margin: 8px 0 4px; font-weight: 700;">${data.emailsSent7d}</p>
          <p style="color: #7e22ce; font-size: 14px; margin: 0;">${data.replies7d} replies</p>
        </div>
        
      </div>
    </div>
    
    <!-- Top Past Due -->
    <div style="padding: 0 24px 24px;">
      <h2 style="font-size: 16px; color: #111827; margin: 0 0 12px;">Top Past Due Invoices</h2>
      <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 600;">Customer</th>
            <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">Amount</th>
            <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; font-weight: 600;">Overdue</th>
          </tr>
        </thead>
        <tbody>
          ${topInvoicesHtml}
        </tbody>
      </table>
    </div>
    
    <!-- Footer -->
    <div style="background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 12px; margin: 0;">
        Sent by <a href="https://collectly.app" style="color: #6366f1; text-decoration: none;">Collectly</a>
      </p>
      <p style="color: #9ca3af; font-size: 11px; margin: 8px 0 0;">
        You're receiving this because you have weekly digests enabled.
      </p>
    </div>
    
  </div>
</body>
</html>
  `.trim()
}
