---
name: email-reply-detection-qa
description: Define and validate logic for detecting customer email replies in Gmail threads. Use when implementing, reviewing, or debugging reply detection code, investigating false positives/negatives in email tracking, or when the user asks about "customer replied" logic.
---

# Email Reply Detection QA

QA checklist and reference for determining when a customer has replied to a reminder email. Use this skill to review or implement reply detection logic.

## Core Detection Logic

A message counts as a **customer reply** when ALL of these conditions are true:

```
1. Same thread     → message.threadId === originalEmail.threadId
2. After our send  → message.internalDate > originalEmail.internalDate
3. Inbound         → INBOX label present OR sender ≠ workspace email
4. From customer   → sender domain/address matches customer record
5. Not automated   → no auto-reply headers detected
6. Within window   → received within configured time window (default: 7 days)
```

### Gmail Thread Matching

Gmail groups messages into threads using:
- `In-Reply-To` header matching a previous `Message-ID`
- `References` header chain
- Subject line similarity (after stripping Re:/Fwd:)

**Reliable**: Use `threadId` from Gmail API—don't reconstruct thread logic manually.

### Header Checks

| Header | Purpose | Check |
|--------|---------|-------|
| `From` | Identify sender | Must NOT match workspace Gmail address |
| `Message-ID` | Unique message identifier | Store for deduplication |
| `In-Reply-To` | Links to parent message | Confirms thread relationship |
| `X-Auto-Response` | Auto-reply indicator | If present → skip |
| `Auto-Submitted` | RFC 3834 auto-reply | If `auto-replied` or `auto-generated` → skip |
| `X-Autoreply` | Legacy auto-reply | If present → skip |
| `Precedence` | Bulk/auto mail | If `bulk` or `auto_reply` → skip |

### Gmail Labels

Use label IDs to determine direction:

```typescript
const isInbound = message.labelIds?.includes('INBOX')
const isOutbound = message.labelIds?.includes('SENT')

// True reply = INBOX present, SENT absent
const isReply = isInbound && !isOutbound
```

### Time Window

Default: Check emails from last **7 days** only.

Rationale:
- Replies after 7 days are rare for payment reminders
- Reduces API calls and processing time
- Can be configurable per workspace if needed

---

## False Positive Scenarios

These should NOT trigger "customer replied" state:

### 1. Auto-Replies (Vacation/OOO)

**Detection**:
```typescript
function isAutoReply(headers: Header[]): boolean {
  const autoHeaders = [
    'x-auto-response',
    'x-autoreply', 
    'auto-submitted',
    'x-autorespond',
  ]
  
  for (const h of headers) {
    if (autoHeaders.includes(h.name.toLowerCase())) {
      return true
    }
    if (h.name.toLowerCase() === 'auto-submitted' && 
        h.value !== 'no') {
      return true
    }
    if (h.name.toLowerCase() === 'precedence' &&
        ['bulk', 'auto_reply', 'junk'].includes(h.value.toLowerCase())) {
      return true
    }
  }
  return false
}
```

**Mitigation**: Skip messages with auto-reply headers.

### 2. Bounce/Delivery Failure Messages

**Detection**:
- `Content-Type: multipart/report`
- `From` contains `mailer-daemon`, `postmaster`, or `noreply`
- Subject contains "Delivery Status", "Undeliverable", "Failed"

```typescript
function isBounceMessage(headers: Header[]): boolean {
  const from = getHeader(headers, 'from')?.toLowerCase() || ''
  const subject = getHeader(headers, 'subject')?.toLowerCase() || ''
  const contentType = getHeader(headers, 'content-type')?.toLowerCase() || ''
  
  const bounceFromPatterns = ['mailer-daemon', 'postmaster', 'noreply', 'no-reply']
  const bounceSubjectPatterns = ['delivery status', 'undeliverable', 'failed', 'returned mail']
  
  return bounceFromPatterns.some(p => from.includes(p)) ||
         bounceSubjectPatterns.some(p => subject.includes(p)) ||
         contentType.includes('multipart/report')
}
```

**Mitigation**: Skip bounce messages; optionally flag invoice for manual review.

### 3. Read Receipts / Delivery Receipts

**Detection**:
- `Content-Type: message/disposition-notification`
- `Content-Type: message/delivery-status`
- Subject contains "Read:", "Delivered:"

**Mitigation**: Skip messages with receipt content types.

### 4. Own Account Reply (Multi-Device)

**Detection**: Sender email === workspace's connected Gmail address

```typescript
function isOwnReply(senderEmail: string, workspaceEmail: string): boolean {
  return normalizeEmail(senderEmail) === normalizeEmail(workspaceEmail)
}

function normalizeEmail(email: string): string {
  // Extract email from "Name <email@domain.com>" format
  const match = email.match(/<([^>]+)>/)
  const raw = match ? match[1] : email
  return raw.toLowerCase().trim()
}
```

**Mitigation**: Compare sender against stored workspace Gmail address.

### 5. CC/BCC Recipients Replying

**Scenario**: Original email CC'd someone; that person replies.

**Detection**: Sender email doesn't match any known customer email for this invoice.

**Mitigation**: Verify sender matches `customers.email` for the associated invoice.

### 6. Forwarded Then Replied

**Scenario**: Customer forwards email internally, colleague replies.

**Detection**: 
- Different sender domain than customer's domain
- `X-Forwarded-To` or `X-Forwarded-For` headers present

**Mitigation**: 
- Accept if sender domain matches customer domain (internal forward)
- Flag for manual review if domain mismatch

### 7. Spam/Phishing in Thread

**Scenario**: Spammer injects message into thread.

**Detection**: 
- `SPAM` label present
- Sender doesn't match customer email/domain

**Mitigation**: Skip messages with SPAM label; verify sender identity.

---

## False Negative Scenarios

These SHOULD trigger "customer replied" but might be missed:

### 1. Reply Without Thread ID

**Scenario**: Customer's email client doesn't preserve `In-Reply-To` header.

**Indicators**:
- New thread created
- Subject still matches (with Re: prefix)
- From address matches customer

**Mitigation**: Secondary matching by subject + sender + time proximity:

```typescript
async function findOrphanedReplies(
  accessToken: string,
  originalSubject: string,
  customerEmail: string,
  sentAfter: Date
): Promise<GmailMessage[]> {
  // Search for messages from customer with similar subject
  const query = `from:${customerEmail} subject:"Re: ${originalSubject}" after:${toGmailDate(sentAfter)}`
  
  const response = await fetch(
    `${GMAIL_API_URL}/users/me/messages?q=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  // ... process results
}
```

### 2. Reply to Different Address

**Scenario**: Customer replies to a different email (e.g., support@ instead of the connected Gmail).

**Mitigation**: 
- Document limitation clearly
- Consider monitoring additional inboxes if needed
- Implement alias detection if workspace uses Gmail aliases

### 3. Reply via Different Channel

**Scenario**: Customer calls or uses chat instead of email.

**Mitigation**: Out of scope for email detection; provide manual "mark as replied" UI action.

### 4. Gmail Conversation View Mismatch

**Scenario**: Gmail groups messages differently than expected due to subject changes.

**Mitigation**: Trust Gmail's `threadId`; don't try to override Gmail's grouping.

### 5. Delayed Replies (Outside Window)

**Scenario**: Customer replies after 7-day window.

**Mitigation**: 
- Make window configurable
- For invoices still unpaid after window, consider extending check period
- Log when replies are detected outside window for monitoring

### 6. Reply in HTML-Only Format

**Scenario**: Email body is HTML-only; `snippet` extraction fails.

**Detection**: Check `payload.mimeType` and `payload.parts`

**Mitigation**: Parse HTML parts to extract text; don't rely solely on snippet.

---

## Recommended Implementation

### Complete Reply Detection Function

```typescript
interface ReplyCheckResult {
  isReply: boolean
  reason: string
  message?: GmailMessage
  confidence: 'high' | 'medium' | 'low'
}

export async function checkThreadForReplies(
  accessToken: string,
  threadId: string,
  afterMessageId: string,
  workspaceEmail: string,
  customerEmail: string
): Promise<ReplyCheckResult[]> {
  const response = await fetch(
    `${GMAIL_API_URL}/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Auto-Submitted&metadataHeaders=X-Auto-Response&metadataHeaders=Precedence&metadataHeaders=Content-Type`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  
  if (!response.ok) {
    return []
  }
  
  const thread = await response.json()
  const messages: GmailMessage[] = thread.messages || []
  
  // Find our sent message index
  const afterIndex = messages.findIndex(m => m.id === afterMessageId)
  if (afterIndex === -1) {
    return []
  }
  
  const results: ReplyCheckResult[] = []
  
  for (const message of messages.slice(afterIndex + 1)) {
    const headers = message.payload?.headers || []
    const labelIds = message.labelIds || []
    
    // Check 1: Is it inbound?
    const isInbox = labelIds.includes('INBOX')
    const isSent = labelIds.includes('SENT')
    const isSpam = labelIds.includes('SPAM')
    
    if (isSpam) {
      results.push({ isReply: false, reason: 'spam', confidence: 'high' })
      continue
    }
    
    if (isSent && !isInbox) {
      results.push({ isReply: false, reason: 'outbound', confidence: 'high' })
      continue
    }
    
    // Check 2: Not from ourselves
    const fromHeader = getHeader(headers, 'From')
    const senderEmail = extractEmail(fromHeader || '')
    
    if (normalizeEmail(senderEmail) === normalizeEmail(workspaceEmail)) {
      results.push({ isReply: false, reason: 'own_message', confidence: 'high' })
      continue
    }
    
    // Check 3: Not an auto-reply
    if (isAutoReply(headers)) {
      results.push({ isReply: false, reason: 'auto_reply', confidence: 'high' })
      continue
    }
    
    // Check 4: Not a bounce
    if (isBounceMessage(headers)) {
      results.push({ isReply: false, reason: 'bounce', confidence: 'high' })
      continue
    }
    
    // Check 5: Sender matches customer (confidence adjustment)
    const senderMatchesCustomer = 
      normalizeEmail(senderEmail) === normalizeEmail(customerEmail)
    
    const confidence = senderMatchesCustomer ? 'high' : 'medium'
    
    results.push({
      isReply: true,
      reason: 'valid_reply',
      message,
      confidence
    })
  }
  
  return results.filter(r => r.isReply)
}
```

### Helper Functions

```typescript
function getHeader(headers: Header[], name: string): string | undefined {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value
}

function extractEmail(fromString: string): string {
  const match = fromString.match(/<([^>]+)>/)
  return match ? match[1] : fromString
}

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}
```

---

## QA Checklist

Before merging reply detection changes, verify:

### Logic Correctness
- [ ] Thread ID matching used (not subject-based)
- [ ] Messages filtered to after original send
- [ ] Sender compared against workspace Gmail address
- [ ] Customer email verified when possible
- [ ] Auto-reply headers checked
- [ ] Bounce messages excluded
- [ ] SPAM label exclusion

### False Positive Prevention
- [ ] Auto-reply detection includes all common headers
- [ ] Bounce detection covers delivery failures
- [ ] Own-account replies excluded
- [ ] Read receipts excluded

### False Negative Prevention
- [ ] Time window is appropriate (not too short)
- [ ] Snippet extraction handles edge cases
- [ ] Logging captures skipped messages for debugging

### Operational
- [ ] Workspace email stored and accessible for comparison
- [ ] Reply events logged with gmail_message_id for deduplication
- [ ] Confidence level logged for monitoring
- [ ] Error handling doesn't silently swallow failures

---

## Testing Scenarios

Manual QA scenarios to test:

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Customer replies within thread | ✅ Detect, pause invoice |
| 2 | Out-of-office auto-reply | ❌ Ignore, no pause |
| 3 | Bounce message | ❌ Ignore, optionally flag |
| 4 | Workspace owner replies from phone | ❌ Ignore (own message) |
| 5 | CC recipient replies | ⚠️ Detect with medium confidence |
| 6 | Customer replies after 7 days | ❌ Missed (by design) or ✅ if extended |
| 7 | SPAM message in thread | ❌ Ignore |
| 8 | Read receipt | ❌ Ignore |
| 9 | Customer replies from different email | ⚠️ Detect with medium confidence |
| 10 | Reply to forwarded email | ⚠️ Depends on domain match |

---

## Current Implementation Gaps

Review `supabase/functions/_shared/gmail.ts` for these issues:

1. **No auto-reply detection** — Currently missing header checks
2. **Incorrect sender check** — Uses `!fromHeader.value.includes('@gmail.com')` which is wrong
3. **No bounce detection** — Bounce messages will trigger false positives
4. **No workspace email comparison** — Doesn't check if sender === workspace email
5. **No customer email verification** — Doesn't verify sender is the customer
6. **No confidence scoring** — All replies treated equally

See `supabase/functions/check-replies/index.ts` for integration points.
