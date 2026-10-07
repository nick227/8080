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
    font: "Helvetica, Arial, sans-serif",
    headingFont: "Helvetica, Arial, sans-serif",
    text: '#1d1f23',
    muted: '#6b6f76',
    page: '#f2f3f5',
    surface: '#ffffff',
    accent: '#2552d0',
    onAccent: '#ffffff',
    rule: '#e2e4e8',
    radius: 6,
  },
  mono: {
    font: "'Courier New', Courier, monospace",
    headingFont: "'Courier New', Courier, monospace",
    text: '#111111',
    muted: '#5c5c5c',
    page: '#ffffff',
    surface: '#ffffff',
    accent: '#111111',
    onAccent: '#ffffff',
    rule: '#111111',
    radius: 0,
  },
  warm: {
    font: "Georgia, 'Times New Roman', serif",
    headingFont: "Georgia, 'Times New Roman', serif",
    text: '#2b2118',
    muted: '#7a6a5a',
    page: '#f6efe6',
    surface: '#fffaf3',
    accent: '#b4532a',
    onAccent: '#fffaf3',
    rule: '#e6d8c6',
    radius: 4,
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

function renderText(blocks: EmailBlock[], footer: string[], test?: boolean): string {
  const out: string[] = []
  if (test) out.push('This is a test. It was sent only to you.')
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(b.text.toUpperCase())
        break
      case 'text':
        out.push(b.text.trim())
        break
      case 'list':
        out.push(b.items.map((i) => `- ${i}`).join('\n'))
        break
      case 'image':
        if (b.alt) out.push(`[${b.alt}]`)
        break
      case 'button':
        out.push(`${b.label}: ${b.href}`)
        break
      case 'divider':
        out.push('---')
        break
      case 'section':
        out.push([b.title.toUpperCase(), ...b.lines.map((l) => `- ${l}`), ...(b.link ? [`${b.link.label}: ${b.link.href}`] : [])].join('\n'))
        break
    }
  }
  if (footer.length) out.push('--\n' + footer.join('\n'))
  return out.filter(Boolean).join('\n\n') + '\n'
}

// ─── html ──────────────────────────────────────────────────────────────────────

function paragraphs(text: string, t: Theme, size = 16) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-family:${t.font};font-size:${size}px;line-height:1.55;color:${t.text}">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
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
  const compact = template === 'team_brief'
  const body = (test ? testBanner(t) : '') + blocks.map((b) => blockHtml(b, t, compact)).join('')
  const card = (pad: number, content: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px"><tr><td style="padding:${pad}px">${content}</td></tr></table>`

  if (template === 'basic') return shell(t, subject, card(32, body) + `<div style="max-width:600px">${footerHtml(footer, t)}</div>`)

  if (template === 'team_brief') {
    const head = `<div style="padding:0 0 14px;margin:0 0 16px;border-bottom:2px solid ${t.text};font-family:${t.headingFont};font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${t.text}">${esc(masthead || subject)}</div>`
    return shell(t, subject, card(24, head + body) + `<div style="max-width:600px">${footerHtml(footer, t)}</div>`)
  }

  // bulletin — the distinctive one: an accent masthead band, a large lead heading
  // and a closing band; the content reads like a printed bulletin.
  const band = `<tr><td style="background:${t.accent};padding:28px 32px"><div style="font-family:${t.headingFont};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${t.onAccent};opacity:.85">${esc(masthead)}</div><div style="padding-top:10px;font-family:${t.headingFont};font-size:30px;line-height:1.15;font-weight:bold;color:${t.onAccent}">${esc(subject.replace(/^\[Test\] /, ''))}</div></td></tr>`
  const content = `<tr><td style="padding:28px 32px 12px">${body}</td></tr>`
  const close = `<tr><td style="padding:0 32px"><div style="border-top:4px solid ${t.accent}"></div></td></tr><tr><td style="padding:4px 28px 24px">${footerHtml(footer, t)}</td></tr>`
  return shell(
    t,
    subject,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${t.surface};border-radius:${t.radius}px;overflow:hidden">${band}${content}${close}</table>`,
  )
}
