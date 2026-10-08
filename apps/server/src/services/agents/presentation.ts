// The email presentation system (docs/agents/07 decision 5): content blocks +
// template (structure) + theme (tokens) + merge values → { subject, html, text }.
// Pure and deterministic. HTML is table-based with inline styles (what mail clients
// render); `plain` sends text only. Every interpolated string is escaped.
import {
  fillMergeTags,
  type EmailBlock,
  type EmailContent,
  type EmailTemplateKey,
  type EmailThemeKey,
  type MergeValues,
} from '@project/shared'

export type Theme = {
  font: string
  headingFont: string
  text: string
  muted: string
  page: string
  surface: string
  accent: string
  onAccent: string
  rule: string
  radius: number
}

export const THEMES: Record<EmailThemeKey, Theme> = {
  company: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    text: '#0f172a',
    muted: '#64748b',
    page: '#f8fafc',
    surface: '#ffffff',
    accent: '#2563eb',
    onAccent: '#ffffff',
    rule: '#e2e8f0',
    radius: 8,
  },
  emerald: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    text: '#064e3b',
    muted: '#047857',
    page: '#f0fdf4',
    surface: '#ffffff',
    accent: '#059669',
    onAccent: '#ffffff',
    rule: '#d1fae5',
    radius: 8,
  },
  midnight: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    text: '#f8fafc',
    muted: '#94a3b8',
    page: '#0f172a',
    surface: '#1e293b',
    accent: '#38bdf8',
    onAccent: '#0f172a',
    rule: '#334155',
    radius: 8,
  },
  warm: {
    font: "Georgia, Cambria, 'Times New Roman', Times, serif",
    headingFont: "Georgia, Cambria, 'Times New Roman', Times, serif",
    text: '#291e18',
    muted: '#786657',
    page: '#fdfbf7',
    surface: '#fffcf9',
    accent: '#c2410c',
    onAccent: '#ffffff',
    rule: '#e7e0d6',
    radius: 6,
  },
  mono: {
    font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    headingFont: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    text: '#09090b',
    muted: '#71717a',
    page: '#ffffff',
    surface: '#ffffff',
    accent: '#09090b',
    onAccent: '#ffffff',
    rule: '#e4e4e7',
    radius: 2,
  },
  sunset: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    text: '#3b0764',
    muted: '#7e22ce',
    page: '#faf5ff',
    surface: '#ffffff',
    accent: '#e11d48',
    onAccent: '#ffffff',
    rule: '#f3e8ff',
    radius: 12,
  },
  apple: {
    font: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
    text: '#1d1d1f',
    muted: '#86868b',
    page: '#f5f5f7',
    surface: '#ffffff',
    accent: '#0071e3',
    onAccent: '#ffffff',
    rule: '#d2d2d7',
    radius: 12,
  },
  discord: {
    font: "'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif",
    headingFont: "'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif",
    text: '#dbdee1',
    muted: '#949ba4',
    page: '#1e1f22',
    surface: '#2b2d31',
    accent: '#5865f2',
    onAccent: '#ffffff',
    rule: '#383a40',
    radius: 8,
  },
  monokai: {
    font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    headingFont: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    text: '#f8f8f2',
    muted: '#75715e',
    page: '#1e1e1e',
    surface: '#272822',
    accent: '#f92672',
    onAccent: '#ffffff',
    rule: '#3e3d32',
    radius: 4,
  },
  brutalist: {
    font: "Arial, 'Helvetica Neue', sans-serif",
    headingFont: "'Arial Black', Impact, sans-serif",
    text: '#000000',
    muted: '#555555',
    page: '#f0f0f0',
    surface: '#ffffff',
    accent: '#ffee00',
    onAccent: '#000000',
    rule: '#000000',
    radius: 0,
  },
  bauhaus: {
    font: "'Futura', 'Helvetica Neue', Arial, sans-serif",
    headingFont: "'Futura', 'Helvetica Neue', Arial, sans-serif",
    text: '#111111',
    muted: '#555555',
    page: '#f4f1ea',
    surface: '#ffffff',
    accent: '#d62828',
    onAccent: '#ffffff',
    rule: '#003049',
    radius: 0,
  },
  zen: {
    font: "'Georgia', 'Times New Roman', serif",
    headingFont: "'Georgia', 'Times New Roman', serif",
    text: '#1c1c1c',
    muted: '#6b705c',
    page: '#f7f7f5',
    surface: '#ffffff',
    accent: '#386641',
    onAccent: '#ffffff',
    rule: '#e6e6e2',
    radius: 6,
  },
  editorial: {
    font: "Georgia, 'Times New Roman', serif",
    headingFont: "Georgia, 'Times New Roman', serif",
    text: '#1a1a1a',
    muted: '#706f6d',
    page: '#fcfbf9',
    surface: '#ffffff',
    accent: '#780000',
    onAccent: '#ffffff',
    rule: '#dcd9d2',
    radius: 2,
  },
  fjord: {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    text: '#1e293b',
    muted: '#64748b',
    page: '#f1f5f9',
    surface: '#ffffff',
    accent: '#0284c7',
    onAccent: '#ffffff',
    rule: '#cbd5e1',
    radius: 6,
  },
  obsidian_gilt: {
    font: "Georgia, serif",
    headingFont: "Georgia, serif",
    text: '#e2e8f0',
    muted: '#94a3b8',
    page: '#0b0c10',
    surface: '#12141c',
    accent: '#d4af37',
    onAccent: '#0b0c10',
    rule: '#2a2e3d',
    radius: 4,
  },
  retro_terminal: {
    font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    headingFont: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    text: '#22c55e',
    muted: '#15803d',
    page: '#050a05',
    surface: '#0a120b',
    accent: '#22c55e',
    onAccent: '#050a05',
    rule: '#143818',
    radius: 0,
  },
}

export type RenderInput = {
  subject: string
  content: EmailContent
  template: EmailTemplateKey
  theme: EmailThemeKey
  values: MergeValues
  /** Short lines under the message: who sent it and why (compliance lines later). */
  footer?: string[]
  /** Marks a Send test copy. */
  test?: boolean
}

export type RenderedEmail = { subject: string; html: string; text: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderEmail(input: RenderInput): RenderedEmail {
  const fill = (s: string) => fillMergeTags(s, input.values)
  const subject = (input.test ? '[Test] ' : '') + oneLine(fill(input.subject))
  const blocks = input.content.blocks.map((b) => fillBlock(b, fill))
  const footer = (input.footer ?? []).map(fill).filter(Boolean)
  const text = renderText(blocks, footer, input.test)
  if (input.template === 'plain') return { subject, html: '', text }
  const masthead = fill('{{company.name}}') || fill('{{workspace.name}}')
  const html = renderHtml(input.template, THEMES[input.theme], blocks, footer, masthead, subject, input.test)
  return { subject, html, text }
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function fillBlock(b: EmailBlock, fill: (s: string) => string): EmailBlock {
  switch (b.type) {
    case 'heading':
    case 'text':
      return { ...b, text: fill(b.text) }
    case 'list':
      return { ...b, items: b.items.map(fill) }
    case 'button':
      return { ...b, label: fill(b.label), href: fill(b.href) }
    case 'image':
      return { ...b, alt: b.alt && fill(b.alt), href: b.href && fill(b.href) }
    case 'section':
      return { ...b, title: fill(b.title), lines: b.lines.map(fill), link: b.link && { label: fill(b.link.label), href: fill(b.link.href) } }
    default:
      return b
  }
}

// ─── text ──────────────────────────────────────────────────────────────────────

function sectionToText(b: Extract<EmailBlock, { type: 'section' }>): string {
  let text = b.title.toUpperCase()
  for (const line of b.lines) text += `\n- ${line}`
  if (b.link) text += `\n${b.link.label}: ${b.link.href}`
  return text
}

function blockToText(b: EmailBlock): string | null {
  switch (b.type) {
    case 'heading':
      return b.text.toUpperCase()
    case 'text':
      return b.text.trim()
    case 'list':
      return b.items.map((i) => `- ${i}`).join('\n')
    case 'image':
      return b.alt ? `[${b.alt}]` : null
    case 'button':
      return `${b.label}: ${b.href}`
    case 'divider':
      return '---'
    case 'section':
      return sectionToText(b)
  }
}

function renderText(blocks: EmailBlock[], footer: string[], test?: boolean): string {
  const out: string[] = []
  if (test) out.push('This is a test. It was sent only to you.')
  for (const b of blocks) {
    const txt = blockToText(b)
    if (txt) out.push(txt)
  }
  if (footer.length > 0) out.push('--\n' + footer.join('\n'))
  return out.join('\n\n') + '\n'
}

// ─── html ──────────────────────────────────────────────────────────────────────

function paragraphs(text: string, t: Theme, size = 16): string {
  const pList = text.trim().split(/\n{2,}/)
  let html = ''
  for (let i = 0; i < pList.length; i++) {
    html += `<p style="margin:0 0 14px;font-family:${t.font};font-size:${size}px;line-height:1.55;color:${t.text}">${esc(pList[i]!).replace(/\n/g, '<br>')}</p>`
  }
  return html
}

function blockHtml(b: EmailBlock, t: Theme, compact: boolean): string {
  switch (b.type) {
    case 'heading':
      return `<h2 style="margin:${compact ? '18px 0 8px' : '26px 0 12px'};font-family:${t.headingFont};font-size:${compact ? 18 : 22}px;line-height:1.3;color:${t.text}">${esc(b.text)}</h2>`
    case 'text':
      return paragraphs(b.text, t, compact ? 15 : 16)
    case 'list':
      return `<ul style="margin:0 0 14px;padding-left:20px">${b.items
        .map((i) => `<li style="margin:0 0 6px;font-family:${t.font};font-size:${compact ? 15 : 16}px;line-height:1.5;color:${t.text}">${esc(i)}</li>`)
        .join('')}</ul>`
    case 'image': {
      const img = `<img src="${esc(b.url)}" alt="${esc(b.alt ?? '')}" width="100%" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:${t.radius}px">`
      return `<div style="margin:0 0 16px">${b.href ? `<a href="${esc(b.href)}">${img}</a>` : img}</div>`
    }
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr><td style="background:${t.accent};border-radius:${t.radius}px"><a href="${esc(b.href)}" style="display:inline-block;padding:12px 22px;font-family:${t.font};font-size:15px;font-weight:bold;color:${t.onAccent};text-decoration:none">${esc(b.label)}</a></td></tr></table>`
    case 'divider':
      return `<hr style="margin:22px 0;border:0;border-top:1px solid ${t.rule}">`
    case 'section': {
      const lines = b.lines.length
        ? b.lines.map((l) => `<div style="padding:4px 0;font-family:${t.font};font-size:15px;line-height:1.45;color:${t.text}">${esc(l)}</div>`).join('')
        : `<div style="padding:4px 0;font-family:${t.font};font-size:15px;color:${t.muted}">Nothing today.</div>`
      const link = b.link ? `<div style="padding-top:6px"><a href="${esc(b.link.href)}" style="font-family:${t.font};font-size:14px;color:${t.accent}">${esc(b.link.label)}</a></div>` : ''
      return `<div style="margin:0 0 18px;padding:0 0 14px;border-bottom:1px solid ${t.rule}"><div style="padding:0 0 6px;font-family:${t.font};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.muted}">${esc(b.title)}</div>${lines}${link}</div>`
    }
  }
}

function shell(t: Theme, subject: string, inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:${t.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.page}"><tr><td align="center" style="padding:24px 12px">${inner}</td></tr></table></body></html>`
}

const testBanner = (t: Theme) =>
  `<div style="margin:0 0 18px;padding:8px 12px;border:1px dashed ${t.muted};font-family:${t.font};font-size:13px;color:${t.muted}">Test — sent only to you.</div>`

const footerHtml = (footer: string[], t: Theme) =>
  footer.length
    ? `<div style="padding:18px 4px 0;font-family:${t.font};font-size:12px;line-height:1.5;color:${t.muted}">${footer.map(esc).join('<br>')}</div>`
    : ''

function renderHtml(template: Exclude<EmailTemplateKey, 'plain'>, t: Theme, blocks: EmailBlock[], footer: string[], masthead: string, subject: string, test?: boolean) {
  const compact = template === 'team_brief' || template === 'alert' || template === 'one_touch' || template === 'nudge'
  const body = (test ? testBanner(t) : '') + blocks.map((b) => blockHtml(b, t, compact)).join('')
  const card = (pad: number, content: string, extraStyle = '') =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px;${extraStyle}"><tr><td style="padding:${pad}px">${content}</td></tr></table>`
  const foot = `<div style="max-width:600px">${footerHtml(footer, t)}</div>`

  if (template === 'basic') return shell(t, subject, card(32, body) + foot)

  if (template === 'team_brief') {
    const head = `<div style="padding:0 0 14px;margin:0 0 16px;border-bottom:2px solid ${t.text};font-family:${t.headingFont};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.text}">${esc(masthead || subject)}</div>`
    return shell(t, subject, card(24, head + body) + foot)
  }

  if (template === 'alert') {
    const badge = `<div style="display:inline-block;padding:4px 10px;margin:0 0 14px;background:${t.accent};color:${t.onAccent};font-family:${t.font};font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;border-radius:${t.radius}px">ALERT</div>`
    return shell(t, subject, card(24, badge + body, `border-top:4px solid ${t.accent}`) + foot)
  }

  if (template === 'transactional') {
    const head = `<div style="padding:0 0 12px;margin:0 0 16px;border-bottom:1px dashed ${t.rule};font-family:${t.font};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${t.muted}">RECEIPT / TRANSACTION CONFIRMATION</div>`
    return shell(t, subject, card(28, head + body, `border:1px solid ${t.rule}`) + foot)
  }

  if (template === 'one_touch') {
    return shell(t, subject, card(24, body, `border-left:4px solid ${t.accent}`) + foot)
  }

  if (template === 'nudge') {
    const head = `<div style="padding:0 0 10px;margin:0 0 12px;font-family:${t.font};font-size:13px;font-weight:bold;color:${t.muted}">REMINDER</div>`
    return shell(t, subject, card(20, head + body) + foot)
  }

  if (template === 'digest') {
    const head = `<div style="padding:16px 24px;background:${t.accent};color:${t.onAccent};font-family:${t.headingFont};font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;border-radius:${t.radius}px ${t.radius}px 0 0">${esc(masthead || 'DIGEST')}</div>`
    return shell(t, subject, card(0, head + `<div style="padding:24px">${body}</div>`) + foot)
  }

  if (template === 'update') {
    const badge = `<div style="padding:0 0 12px;margin:0 0 14px;border-bottom:2px solid ${t.accent};font-family:${t.headingFont};font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.accent}">WHAT'S NEW</div>`
    return shell(t, subject, card(28, badge + body) + foot)
  }

  if (template === 'event_invite') {
    const head = `<div style="padding:20px;margin:0 0 20px;background:${t.page};border:1px solid ${t.rule};border-radius:${t.radius}px;text-align:center"><div style="font-family:${t.headingFont};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.accent}">YOU'RE INVITED</div><div style="padding-top:6px;font-family:${t.headingFont};font-size:20px;font-weight:bold;color:${t.text}">${esc(subject.replace(/^\[Test\] /, ''))}</div></div>`
    return shell(t, subject, card(28, head + body) + foot)
  }

  if (template === 'review_request') {
    const stars = `<div style="padding:0 0 14px;text-align:center;font-size:22px;color:${t.accent}">★ ★ ★ ★ ★</div>`
    return shell(t, subject, card(28, stars + body) + foot)
  }

  if (template === 'newsletter') {
    const mast = `<div style="padding:24px 32px;background:${t.text};color:${t.page};font-family:${t.headingFont};font-size:20px;font-weight:bold;letter-spacing:1px">${esc(masthead || 'NEWSLETTER')}</div>`
    return shell(t, subject, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px;overflow:hidden"><tr><td>${mast}</td></tr><tr><td style="padding:32px">${body}</td></tr></table>` + foot)
  }

  if (template === 'executive_report') {
    const head = `<div style="padding:18px 24px;background:${t.surface};border-bottom:3px solid ${t.text};font-family:${t.headingFont};font-size:14px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.text}">EXECUTIVE SUMMARY — ${esc(masthead || 'REPORT')}</div>`
    return shell(t, subject, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px;overflow:hidden"><tr><td>${head}</td></tr><tr><td style="padding:24px">${body}</td></tr></table>` + foot)
  }

  if (template === 'onboarding') {
    const head = `<div style="padding:14px 20px;margin:0 0 20px;background:${t.page};border-left:4px solid ${t.accent};font-family:${t.headingFont};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${t.text}">GETTING STARTED GUIDE</div>`
    return shell(t, subject, card(28, head + body) + foot)
  }

  if (template === 'case_study') {
    const quote = `<div style="padding:16px 20px;margin:0 0 20px;background:${t.page};border-left:3px solid ${t.accent};font-family:${t.font};font-style:italic;font-size:15px;line-height:1.5;color:${t.text}">"Customer Success Story"</div>`
    return shell(t, subject, card(28, quote + body) + foot)
  }

  // bulletin — the distinctive default: an accent masthead band, a large lead heading and a closing band
  const band = `<tr><td style="background:${t.accent};padding:28px 32px"><div style="font-family:${t.headingFont};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${t.onAccent};opacity:.85">${esc(masthead)}</div><div style="padding-top:10px;font-family:${t.headingFont};font-size:30px;line-height:1.15;font-weight:bold;color:${t.onAccent}">${esc(subject.replace(/^\[Test\] /, ''))}</div></td></tr>`
  const content = `<tr><td style="padding:28px 32px 12px">${body}</td></tr>`
  const close = `<tr><td style="padding:0 32px"><div style="border-top:4px solid ${t.accent}"></div></td></tr><tr><td style="padding:4px 28px 24px">${footerHtml(footer, t)}</td></tr>`
  return shell(
    t,
    subject,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px;overflow:hidden">${band}${content}${close}</table>`,
  )
}
