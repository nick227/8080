import type { DocumentRecord } from './types'

export type DocKind = 'doc' | 'map' | 'sheet' | 'contacts' | 'gdoc' | 'gsheet'

export function kindOf(doc: DocumentRecord): DocKind {
  if (doc.surface === 'blocks') return 'doc'
  if (doc.surface === 'mental_map') return 'map'
  if (doc.surface === 'external') return doc.shared?.externalUrl?.includes('/spreadsheets/') ? 'gsheet' : 'gdoc'
  if (doc.sheet?.mode === 'dataset') return 'contacts'
  return 'sheet'
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

// One 16px line glyph per document kind; Google files share the doc/sheet glyph.
export function DocIcon({ kind }: { kind: DocKind }) {
  return (
    <svg className="docs-icon" data-kind={kind} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {(kind === 'doc' || kind === 'gdoc') && (
        <>
          <path d="M3.5 1.75h5.75l3.25 3.25v9.25h-9z" {...stroke} />
          <path d="M9.25 1.75V5h3.25M5.75 8.25h4.5M5.75 10.75h3" {...stroke} />
        </>
      )}
      {(kind === 'sheet' || kind === 'gsheet') && (
        <>
          <rect x="2" y="2.5" width="12" height="11" rx=".75" {...stroke} />
          <path d="M2 6.25h12M2 9.75h12M6.25 6.25v7.25" {...stroke} />
        </>
      )}
      {kind === 'map' && (
        <>
          <circle cx="3.75" cy="4" r="1.75" {...stroke} />
          <circle cx="12.25" cy="5.5" r="1.75" {...stroke} />
          <circle cx="7" cy="12.25" r="1.75" {...stroke} />
          <path d="M5.45 4.35 10.55 5.15M4.6 5.55l1.55 5.1M11.1 6.9l-3 3.95" {...stroke} />
        </>
      )}
      {kind === 'contacts' && (
        <>
          <rect x="1.75" y="3" width="12.5" height="10" rx=".75" {...stroke} />
          <circle cx="6" cy="7" r="1.6" {...stroke} />
          <path d="M3.6 11c.5-1.15 1.3-1.7 2.4-1.7s1.9.55 2.4 1.7M10 7h2.25M10 9.5h2.25" {...stroke} />
        </>
      )}
    </svg>
  )
}
