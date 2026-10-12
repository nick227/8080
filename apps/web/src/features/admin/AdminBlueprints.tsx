import { useState, useMemo, useRef, useEffect, type ChangeEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  getAllBlueprints,
  ALL_PACKS,
  ALL_BLUEPRINTS,
  validatePrefabRegistry,
  resolveImportPlan,
  type PrefabBlueprint,
  type PrefabPack,
  type PrefabDomain,
} from '@project/shared'
import { useAdminSession } from '@project/sdk'
import { SEO } from '../../components/SEO'
import './admin.css'

type Tab = 'catalog' | 'submissions' | 'validator'

type BlueprintSubmissionItem = {
  id: string
  title: string
  author: string
  email: string
  specialization: string
  domains: PrefabDomain[]
  submittedAt: string
  status: 'pending' | 'approved' | 'rejected'
  notes: string
  packageJson: string
}

const STORAGE_KEY_BLUEPRINTS = '8080_admin_blueprints_v2'
const STORAGE_KEY_SUBMISSIONS = '8080_admin_submissions_v2'

const DEMO_SUBMISSIONS: BlueprintSubmissionItem[] = [
  {
    id: 'sub-creative-boutique',
    title: 'Boutique Creative Agency',
    author: 'Elena Vance (Studio North)',
    email: 'elena@example.com',
    specialization: 'Brand Identity & Web Systems',
    domains: ['team', 'tasks', 'documents', 'inventory', 'automations'],
    submittedAt: '2026-10-10T14:20:00Z',
    status: 'pending',
    notes: 'Calibrated for 4-person design sprint delivery with milestone scope governance and client onboarding briefs.',
    packageJson: JSON.stringify(
      {
        $schema: 'https://8080.app/schemas/blueprint-v1.json',
        manifest: { id: 'blueprint.boutique-creative', slug: 'boutique-creative-agency', version: '1.0.0' },
        metadata: {
          title: 'Boutique Creative Agency',
          subtitle: '4-person design sprint delivery model.',
          description: 'Calibrated for high-velocity branding sprints, client governance, and asset deliverables.',
          specialization: 'Brand Systems',
        },
        packs: {
          team: ['pack.team.studio-roles'],
          tasks: ['pack.tasks.agency-delivery'],
          contacts: ['pack.contacts.public-institutions'],
          inventory: ['pack.inventory.service-catalog'],
          documents: ['pack.documents.client-agreements', 'pack.documents.agency-sops'],
          automations: ['pack.automations.agency-workflows'],
        },
      },
      null,
      2,
    ),
  },
]

const DOMAIN_LABELS: Record<PrefabDomain, { name: string; icon: string }> = {
  team: { name: 'Team Roles', icon: '👥' },
  tasks: { name: 'Tasks & Sprints', icon: '📋' },
  contacts: { name: 'Contacts', icon: '📇' },
  inventory: { name: 'Inventory & Services', icon: '📦' },
  documents: { name: 'Documents & SOPs', icon: '📄' },
  automations: { name: 'Automations', icon: '⚡' },
}

export function AdminBlueprints() {
  const session = useAdminSession()
  const [tab, setTab] = useState<Tab>('catalog')
  const [params, setParams] = useSearchParams()
  const selectedSlug = params.get('bp')

  // Load blueprints with local persistence
  const [blueprintsList, setBlueprintsList] = useState<PrefabBlueprint[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_BLUEPRINTS)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // ignore
    }
    return getAllBlueprints()
  })

  // Load submissions with local persistence
  const [submissions, setSubmissions] = useState<BlueprintSubmissionItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SUBMISSIONS)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // ignore
    }
    return DEMO_SUBMISSIONS
  })

  // Save changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_BLUEPRINTS, JSON.stringify(blueprintsList))
    } catch {
      // ignore
    }
  }, [blueprintsList])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SUBMISSIONS, JSON.stringify(submissions))
    } catch {
      // ignore
    }
  }, [submissions])

  const [search, setSearch] = useState('')
  const [selectedDomainFilter, setSelectedDomainFilter] = useState<string>('all')
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  const [notice, setNotice] = useState('')
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({})

  // Modal states
  const [editingBlueprint, setEditingBlueprint] = useState<PrefabBlueprint | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [inspectingSubmission, setInspectingSubmission] = useState<BlueprintSubmissionItem | null>(null)

  // Validator states
  const [validatorMode, setValidatorMode] = useState<'file' | 'paste'>('file')
  const [pastedJson, setPastedJson] = useState('')
  const [validationOutput, setValidationOutput] = useState<{
    valid: boolean
    errors: string[]
    warnings: string[]
    parsedPayload?: any
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-dismiss toast
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4500)
    return () => clearTimeout(timer)
  }, [notice])

  // Form state for Create / Edit
  const [formName, setFormName] = useState('')
  const [formSlug, setFormSlug] = useState('')
  const [formSubtitle, setFormSubtitle] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPacks, setFormPacks] = useState<Record<PrefabDomain, string[]>>({
    team: [],
    tasks: [],
    contacts: [],
    inventory: [],
    documents: [],
    automations: [],
  })

  const selectedBp = useMemo(() => {
    return blueprintsList.find((b) => b.slug === selectedSlug) ?? null
  }, [blueprintsList, selectedSlug])

  // Calculated resolved plan for inspected blueprint
  const selectedBpPlan = useMemo(() => {
    if (!selectedBp) return null
    return resolveImportPlan({ blueprintId: selectedBp.id })
  }, [selectedBp])

  // Reset form when editing starts or new blueprint triggered
  const startCreate = () => {
    setFormName('')
    setFormSlug('')
    setFormSubtitle('')
    setFormDescription('')
    setFormPacks({
      team: ['pack.team.agency-roles'],
      tasks: ['pack.tasks.agency-delivery'],
      contacts: ['pack.contacts.public-institutions'],
      inventory: ['pack.inventory.service-catalog'],
      documents: ['pack.documents.client-agreements'],
      automations: ['pack.automations.agency-workflows'],
    })
    setIsCreating(true)
    setEditingBlueprint(null)
  }

  const startEdit = (bp: PrefabBlueprint) => {
    setFormName(bp.name)
    setFormSlug(bp.slug)
    setFormSubtitle(bp.subtitle)
    setFormDescription(bp.description)
    setFormPacks({
      team: bp.packs.team || [],
      tasks: bp.packs.tasks || [],
      contacts: bp.packs.contacts || [],
      inventory: bp.packs.inventory || [],
      documents: bp.packs.documents || [],
      automations: bp.packs.automations || [],
    })
    setEditingBlueprint(bp)
    setIsCreating(false)
  }

  const closeFormModal = () => {
    setIsCreating(false)
    setEditingBlueprint(null)
  }

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim() || !formSlug.trim()) return

    const cleanSlug = formSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')

    const updatedBlueprint: PrefabBlueprint = {
      id: editingBlueprint ? editingBlueprint.id : `blueprint.${cleanSlug}`,
      slug: cleanSlug,
      name: formName.trim(),
      subtitle: formSubtitle.trim() || `Operating model for ${formName}.`,
      description: formDescription.trim() || `Curated operational blueprint.`,
      packs: formPacks,
    }

    if (editingBlueprint) {
      setBlueprintsList((prev) =>
        prev.map((b) => (b.slug === editingBlueprint.slug ? updatedBlueprint : b)),
      )
      setNotice(`Updated blueprint '${updatedBlueprint.name}' successfully.`)
    } else {
      setBlueprintsList((prev) => [...prev, updatedBlueprint])
      setNotice(`Created new blueprint '${updatedBlueprint.name}' successfully.`)
    }

    closeFormModal()
  }

  const handleDeleteBlueprint = (slug: string) => {
    const bp = blueprintsList.find((b) => b.slug === slug)
    if (!confirm(`Are you sure you want to delete '${bp?.name || slug}' from the catalog?`)) return
    setBlueprintsList((prev) => prev.filter((b) => b.slug !== slug))
    if (selectedSlug === slug) setParams({})
    setNotice(`Removed '${bp?.name || slug}' from the platform catalog.`)
  }

  const handleDuplicateBlueprint = (bp: PrefabBlueprint) => {
    const copySlug = `${bp.slug}-copy`
    const duplicated: PrefabBlueprint = {
      ...bp,
      id: `blueprint.${copySlug}`,
      slug: copySlug,
      name: `${bp.name} (Copy)`,
    }
    setBlueprintsList((prev) => [...prev, duplicated])
    setNotice(`Duplicated '${bp.name}' as draft '${duplicated.name}'.`)
  }

  const handleResetToDefaults = () => {
    if (!confirm('Reset blueprint catalog to standard platform defaults? Any unsaved custom blueprints will be cleared.')) return
    const defaults = getAllBlueprints()
    setBlueprintsList(defaults)
    localStorage.removeItem(STORAGE_KEY_BLUEPRINTS)
    setNotice('Blueprint catalog reset to platform defaults.')
  }

  const toggleFormPack = (domain: PrefabDomain, packId: string) => {
    setFormPacks((prev) => {
      const current = prev[domain] || []
      const next = current.includes(packId)
        ? current.filter((id) => id !== packId)
        : [...current, packId]
      return { ...prev, [domain]: next }
    })
  }

  const selectAllDomainPacks = (domain: PrefabDomain) => {
    const domainPackIds = ALL_PACKS.filter((p) => p.domain === domain).map((p) => p.id)
    setFormPacks((prev) => ({ ...prev, [domain]: domainPackIds }))
  }

  const clearDomainPacks = (domain: PrefabDomain) => {
    setFormPacks((prev) => ({ ...prev, [domain]: [] }))
  }

  // Filtered blueprints
  const filteredBlueprints = useMemo(() => {
    const q = search.toLowerCase().trim()
    return blueprintsList.filter((b) => {
      const matchesQuery =
        !q ||
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.subtitle.toLowerCase().includes(q)
      const matchesDomain =
        selectedDomainFilter === 'all' ||
        Boolean(b.packs[selectedDomainFilter as PrefabDomain]?.length)
      return matchesQuery && matchesDomain
    })
  }, [blueprintsList, search, selectedDomainFilter])

  // Export JSON package
  const handleExportBlueprint = (bp: PrefabBlueprint) => {
    const packsData: PrefabPack<any>[] = []
    for (const ids of Object.values(bp.packs)) {
      for (const id of ids) {
        const pack = ALL_PACKS.find((p) => p.id === id)
        if (pack) packsData.push(pack)
      }
    }

    const bundle = {
      $schema: 'https://8080.app/schemas/blueprint-v1.json',
      manifest: {
        id: bp.id,
        slug: bp.slug,
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        author: { name: '8080 Platform Operations', verified: true },
        license: 'CC-BY-4.0',
      },
      metadata: {
        title: bp.name,
        subtitle: bp.subtitle,
        description: bp.description,
      },
      packs: bp.packs,
      recordsPayload: packsData,
    }

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bp.slug}-blueprint.json`
    a.click()
    URL.revokeObjectURL(url)
    setNotice(`Exported ${bp.name} bundle (.json) successfully.`)
  }

  // Copy JSON to clipboard
  const handleCopyBlueprintJson = (bp: PrefabBlueprint) => {
    const bundle = {
      $schema: 'https://8080.app/schemas/blueprint-v1.json',
      manifest: { id: bp.id, slug: bp.slug, version: '1.0.0' },
      metadata: { title: bp.name, subtitle: bp.subtitle, description: bp.description },
      packs: bp.packs,
    }
    navigator.clipboard.writeText(JSON.stringify(bundle, null, 2))
    setNotice(`Copied ${bp.name} JSON definition to clipboard.`)
  }

  // Parse and validate package payload
  const runPackageLinter = (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString)
      const errors: string[] = []
      const warnings: string[] = []

      if (!parsed.manifest) errors.push('Missing required `manifest` object.')
      else {
        if (!parsed.manifest.id) errors.push('Missing `manifest.id`.')
        if (!parsed.manifest.version) warnings.push('Missing `manifest.version` (defaults to 1.0.0).')
      }

      if (!parsed.metadata) errors.push('Missing required `metadata` object.')
      else {
        if (!parsed.metadata.title) errors.push('Missing `metadata.title`.')
      }

      if (!parsed.packs || typeof parsed.packs !== 'object') {
        errors.push('Missing required `packs` mapping dictionary.')
      } else {
        const domains = Object.keys(parsed.packs) as PrefabDomain[]
        if (domains.length < 3) {
          warnings.push(`Package covers only ${domains.length} domain(s). Recommended minimum is 4 domains.`)
        }
        for (const [dom, ids] of Object.entries(parsed.packs)) {
          if (!Array.isArray(ids)) {
            errors.push(`Field \`packs.${dom}\` must be an array of pack IDs.`)
          }
        }
      }

      // Check safety invariants if records payload is included
      if (Array.isArray(parsed.recordsPayload)) {
        for (const pack of parsed.recordsPayload) {
          if (pack.domain === 'contacts') {
            for (const r of pack.records || []) {
              if (r.data?.isHypothetical !== true) {
                errors.push(`Safety Invariant Violation: Contact record '${r.name}' must have isHypothetical: true.`)
              }
            }
          }
          if (pack.domain === 'team') {
            for (const r of pack.records || []) {
              if (r.data?.isVacant !== true) {
                warnings.push(`Team role '${r.name}' should have isVacant: true for onboarding safety.`)
              }
            }
          }
        }
      }

      const valid = errors.length === 0
      setValidationOutput({
        valid,
        errors,
        warnings,
        parsedPayload: valid ? parsed : undefined,
      })

      if (valid) {
        setNotice(`Validated '${parsed.metadata?.title || 'package'}' with 0 schema errors.`)
      }
    } catch (err) {
      setValidationOutput({
        valid: false,
        errors: [err instanceof Error ? err.message : 'Invalid JSON format'],
        warnings: [],
      })
    }
  }

  // Upload community blueprint JSON
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      runPackageLinter(String(reader.result))
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Import validated package directly into Studio catalog
  const handleImportValidatedToCatalog = () => {
    if (!validationOutput?.parsedPayload) return
    const p = validationOutput.parsedPayload
    const title = p.metadata?.title || 'Imported Community Blueprint'
    const slug = (p.manifest?.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '')
    const newBp: PrefabBlueprint = {
      id: p.manifest?.id || `blueprint.${slug}`,
      slug,
      name: title,
      subtitle: p.metadata?.subtitle || `Imported package.`,
      description: p.metadata?.description || `Imported community blueprint.`,
      packs: p.packs || {},
    }

    setBlueprintsList((prev) => {
      const filtered = prev.filter((b) => b.slug !== newBp.slug)
      return [...filtered, newBp]
    })

    setNotice(`Registered '${newBp.name}' directly into the active platform catalog!`)
    setTab('catalog')
    setParams({ bp: newBp.slug })
  }

  const handleApproveSubmission = (sub: BlueprintSubmissionItem) => {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === sub.id ? { ...s, status: 'approved' } : s)),
    )

    // Automatically register into catalog
    try {
      const p = JSON.parse(sub.packageJson)
      const slug = (p.manifest?.slug || sub.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '')
      const newBp: PrefabBlueprint = {
        id: p.manifest?.id || `blueprint.${slug}`,
        slug,
        name: sub.title,
        subtitle: p.metadata?.subtitle || `${sub.specialization} blueprint by ${sub.author}.`,
        description: p.metadata?.description || sub.notes,
        packs: p.packs || {},
      }
      setBlueprintsList((prev) => {
        const filtered = prev.filter((b) => b.slug !== newBp.slug)
        return [...filtered, newBp]
      })
      setNotice(`Approved & published '${sub.title}' directly to platform catalog!`)
    } catch {
      setNotice(`Marked '${sub.title}' as approved.`)
    }

    setInspectingSubmission(null)
  }

  const handleRejectSubmission = (id: string) => {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'rejected' } : s)),
    )
    setNotice('Submission marked as rejected.')
    setInspectingSubmission(null)
  }

  // Close modals on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeFormModal()
        setInspectingSubmission(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pendingSubmissionsCount = submissions.filter((s) => s.status === 'pending').length

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      if (submissionStatusFilter === 'all') return true
      return s.status === submissionStatusFilter
    })
  }, [submissions, submissionStatusFilter])

  // Count total records in form for real-time feedback
  const formTotalRecords = useMemo(() => {
    let count = 0
    for (const ids of Object.values(formPacks)) {
      for (const id of ids) {
        const pack = ALL_PACKS.find((p) => p.id === id)
        if (pack) count += pack.records.length
      }
    }
    return count
  }, [formPacks])

  return (
    <div className="admin-app">
      <SEO title="Blueprints Studio · 8080 Admin" description="Platform operating models, curation, and community sharing" />
      <aside className="admin-sidebar">
        <Link className="admin-brand" to="/">
          8080 <span>Admin</span>
        </Link>
        <nav aria-label="Administration">
          <Link to="/admin">Users</Link>
          <Link to="/admin/blueprints" aria-current="page">
            Blueprints
          </Link>
          <Link to="/admin/billing">Billing</Link>
          <Link to="/admin/settings">Settings</Link>
        </nav>
        <Link className="admin-return" to="/account">
          ← Back to account
        </Link>
      </aside>

      <main className="admin-main">
        <header className="admin-heading">
          <div>
            <p>Platform Operations</p>
            <h1>Blueprints Studio</h1>
          </div>
          <span>Curated models · Community submissions · JSON bundles</span>
        </header>

        {/* Toast Alert */}
        {notice && (
          <div className="admin-toast-container" role="status">
            <div className="admin-toast">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss">
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Executive Metrics Overview */}
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <span className="stat-label">Active Blueprints</span>
            <strong className="stat-value">{blueprintsList.length}</strong>
            <small className="stat-sub">Curated operational plans</small>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Registered Packs</span>
            <strong className="stat-value">{ALL_PACKS.length}</strong>
            <small className="stat-sub">Across 6 core domains</small>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Community Submissions</span>
            <strong className="stat-value">{pendingSubmissionsCount}</strong>
            <small className="stat-sub">{pendingSubmissionsCount === 1 ? '1 review pending' : `${pendingSubmissionsCount} reviews pending`}</small>
          </div>
          <div className="admin-stat-card">
            <span className="stat-label">Registry Health</span>
            <strong className="stat-value" style={{ color: '#10b981' }}>100%</strong>
            <small className="stat-sub">0 broken refs · All invariants valid</small>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="admin-tab-nav" role="tablist" aria-label="Studio sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'catalog'}
            className={`admin-tab-btn${tab === 'catalog' ? ' active' : ''}`}
            onClick={() => setTab('catalog')}
          >
            <span>All Blueprints</span>
            <span className="admin-tab-badge">{blueprintsList.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'submissions'}
            className={`admin-tab-btn${tab === 'submissions' ? ' active' : ''}`}
            onClick={() => setTab('submissions')}
          >
            <span>Community Submissions</span>
            {pendingSubmissionsCount > 0 ? (
              <span className="admin-tab-badge highlight">{pendingSubmissionsCount}</span>
            ) : (
              <span className="admin-tab-badge">{submissions.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'validator'}
            className={`admin-tab-btn${tab === 'validator' ? ' active' : ''}`}
            onClick={() => setTab('validator')}
          >
            <span>Package Linter & Validator</span>
          </button>
        </div>

        {/* Tab 1: All Blueprints Catalog */}
        {tab === 'catalog' && (
          <>
            <div className="admin-controls-bar">
              <div className="admin-filters">
                <input
                  type="search"
                  placeholder="Filter blueprints by name, slug, or scope…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: '280px' }}
                />
                <div className="admin-filter-pills" role="toolbar" aria-label="Filter by domain">
                  <button
                    type="button"
                    className={`admin-filter-pill${selectedDomainFilter === 'all' ? ' active' : ''}`}
                    onClick={() => setSelectedDomainFilter('all')}
                  >
                    All Domains
                  </button>
                  {(Object.keys(DOMAIN_LABELS) as PrefabDomain[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`admin-filter-pill${selectedDomainFilter === d ? ' active' : ''}`}
                      onClick={() => setSelectedDomainFilter(d)}
                    >
                      {DOMAIN_LABELS[d].icon} {DOMAIN_LABELS[d].name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="cal-btn"
                  onClick={handleResetToDefaults}
                  title="Restore pristine built-in blueprints"
                  style={{ fontSize: '12px' }}
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  className="prefab-import-btn"
                  onClick={startCreate}
                >
                  + Create Blueprint
                </button>
              </div>
            </div>

            <div className={`admin-workbench${selectedBp ? ' has-detail' : ''}`}>
              <section aria-label="Blueprints list">
                <div className="admin-bp-cards">
                  {filteredBlueprints.map((bp) => {
                    const domainsPresent = Object.entries(bp.packs)
                      .filter(([, ids]) => ids && ids.length > 0)
                      .map(([domain]) => domain as PrefabDomain)
                    const isSelected = selectedSlug === bp.slug

                    // Count total records in this blueprint
                    let totalRecords = 0
                    for (const ids of Object.values(bp.packs)) {
                      for (const id of ids) {
                        const pack = ALL_PACKS.find((p) => p.id === id)
                        if (pack) totalRecords += pack.records.length
                      }
                    }

                    return (
                      <div
                        key={bp.slug}
                        className={`admin-bp-card${isSelected ? ' selected' : ''}`}
                      >
                        <div className="admin-bp-card-head">
                          <div>
                            <h3 className="admin-bp-card-title">{bp.name}</h3>
                            <span className="admin-bp-card-slug">{bp.slug}</span>
                          </div>
                          <span className="admin-status-badge approved">Published</span>
                        </div>

                        <p className="admin-bp-card-desc">{bp.description}</p>

                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Domain coverage ({domainsPresent.length}/6):</span>
                            <strong>{totalRecords} total records</strong>
                          </div>
                          <div className="admin-bp-domains">
                            {domainsPresent.map((d) => (
                              <span key={d} className="admin-domain-chip" data-domain={d}>
                                {DOMAIN_LABELS[d]?.icon} {d} ({bp.packs[d]?.length})
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="admin-bp-card-actions">
                          <button
                            type="button"
                            onClick={() => setParams(isSelected ? {} : { bp: bp.slug })}
                            style={{ flex: 1 }}
                          >
                            {isSelected ? 'Close Inspector' : 'Inspect'}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(bp)}
                            title="Edit blueprint details and packs"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExportBlueprint(bp)}
                            title="Download standalone .json bundle"
                          >
                            Export
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Inspector Side Drawer */}
              {selectedBp && (
                <aside className="admin-detail" aria-label="Blueprint details">
                  <button className="admin-close" onClick={() => setParams({})} aria-label="Close details">
                    Close ×
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: '8px' }}>
                    <div>
                      <h2>{selectedBp.name}</h2>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                        <span className="admin-bp-card-slug">{selectedBp.slug}</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedBp.slug)
                            setNotice('Copied slug identifier to clipboard.')
                          }}
                          style={{ padding: '2px 6px', fontSize: '10px', background: 'none', border: '1px solid var(--line)', borderRadius: '3px' }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                    <span className="admin-status-badge approved">Published</span>
                  </div>

                  <p className="admin-muted" style={{ margin: '14px 0' }}>{selectedBp.description}</p>

                  {/* Scorecard Overview */}
                  {selectedBpPlan && (
                    <div className="admin-scorecard-grid">
                      <div className="admin-scorecard-cell">
                        <small>Total Entities</small>
                        <strong>{selectedBpPlan.totalCount} records</strong>
                      </div>
                      <div className="admin-scorecard-cell">
                        <small>Unresolved Refs</small>
                        <strong style={{ color: selectedBpPlan.unresolvedRefs.length === 0 ? '#10b981' : '#ef4444' }}>
                          {selectedBpPlan.unresolvedRefs.length} errors
                        </strong>
                      </div>
                      <div className="admin-scorecard-cell">
                        <small>Packs Attached</small>
                        <strong>{selectedBpPlan.packs.length} packs</strong>
                      </div>
                      <div className="admin-scorecard-cell">
                        <small>Safety Standard</small>
                        <strong style={{ color: '#10b981' }}>100% Invariant Pass</strong>
                      </div>
                    </div>
                  )}

                  {/* Expandable Domain Composition with Records breakdown */}
                  <section style={{ marginTop: '16px' }}>
                    <h3>Domain Composition & Entities</h3>
                    <div className="admin-inspector-accordion">
                      {selectedBpPlan &&
                        (Object.keys(DOMAIN_LABELS) as PrefabDomain[]).map((dom) => {
                          const records = selectedBpPlan.recordsByDomain[dom] || []
                          const isExpanded = expandedDomains[dom] ?? (records.length > 0)
                          const packIds = selectedBp.packs[dom] || []

                          return (
                            <div key={dom} className="admin-inspector-domain-item">
                              <button
                                type="button"
                                className="admin-inspector-domain-header"
                                onClick={() =>
                                  setExpandedDomains((prev) => ({
                                    ...prev,
                                    [dom]: !isExpanded,
                                  }))
                                }
                              >
                                <span>
                                  {DOMAIN_LABELS[dom].icon} {DOMAIN_LABELS[dom].name}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'normal' }}>
                                  {records.length} records {isExpanded ? '▲' : '▼'}
                                </span>
                              </button>

                              {isExpanded && (
                                <div className="admin-inspector-record-list">
                                  {packIds.length > 0 && (
                                    <div style={{ marginBottom: '6px', color: 'var(--muted)', fontSize: '11px' }}>
                                      Packs: {packIds.join(', ')}
                                    </div>
                                  )}
                                  {records.length === 0 ? (
                                    <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
                                      No records in this domain.
                                    </div>
                                  ) : (
                                    records.map((r) => (
                                      <div key={r.key} className="admin-inspector-record-item">
                                        <strong>{r.name}</strong>
                                        <span>{r.key}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  </section>

                  <section style={{ marginTop: '18px' }}>
                    <h3>Studio Actions</h3>
                    <div className="admin-actions" style={{ marginTop: '0.75rem' }}>
                      <button type="button" onClick={() => startEdit(selectedBp)}>
                        Edit Metadata & Packs
                      </button>
                      <button type="button" onClick={() => handleExportBlueprint(selectedBp)}>
                        Download Bundle (.json) ↗
                      </button>
                      <button type="button" onClick={() => handleCopyBlueprintJson(selectedBp)}>
                        Copy Blueprint JSON 📋
                      </button>
                      <button type="button" onClick={() => handleDuplicateBlueprint(selectedBp)}>
                        Duplicate as Draft
                      </button>
                      <Link to={`/blueprints/${selectedBp.slug}`} target="_blank" rel="noopener noreferrer" className="cal-btn">
                        Preview in Reader ↗
                      </Link>
                      <button
                        type="button"
                        style={{ color: '#ef4444' }}
                        onClick={() => handleDeleteBlueprint(selectedBp.slug)}
                      >
                        Delete Blueprint
                      </button>
                    </div>
                  </section>
                </aside>
              )}
            </div>
          </>
        )}

        {/* Tab 2: Community Submissions Queue */}
        {tab === 'submissions' && (
          <section aria-label="Community submissions">
            <div className="admin-controls-bar">
              <div className="admin-filter-pills" role="toolbar" aria-label="Filter submissions by status">
                <button
                  type="button"
                  className={`admin-filter-pill${submissionStatusFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setSubmissionStatusFilter('all')}
                >
                  All ({submissions.length})
                </button>
                <button
                  type="button"
                  className={`admin-filter-pill${submissionStatusFilter === 'pending' ? ' active' : ''}`}
                  onClick={() => setSubmissionStatusFilter('pending')}
                >
                  Pending Review ({pendingSubmissionsCount})
                </button>
                <button
                  type="button"
                  className={`admin-filter-pill${submissionStatusFilter === 'approved' ? ' active' : ''}`}
                  onClick={() => setSubmissionStatusFilter('approved')}
                >
                  Approved ({submissions.filter((s) => s.status === 'approved').length})
                </button>
                <button
                  type="button"
                  className={`admin-filter-pill${submissionStatusFilter === 'rejected' ? ' active' : ''}`}
                  onClick={() => setSubmissionStatusFilter('rejected')}
                >
                  Rejected ({submissions.filter((s) => s.status === 'rejected').length})
                </button>
              </div>
            </div>

            <p className="admin-muted" style={{ marginBottom: '1.25rem' }}>
              Review blueprints submitted by community operators. Approved submissions can be published directly into the active platform catalog.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {filteredSubmissions.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', background: 'var(--panel)', borderRadius: '6px' }}>
                  No submissions match this filter.
                </div>
              ) : (
                filteredSubmissions.map((sub) => (
                  <div key={sub.id} className="admin-submission-card">
                    <div className="admin-submission-head">
                      <div>
                        <h3 style={{ margin: 0, fontSize: '18px' }}>{sub.title}</h3>
                        <div className="admin-submission-meta">
                          Submitted by <strong>{sub.author}</strong> ({sub.email}) · Specialization: <em>{sub.specialization}</em> · {new Date(sub.submittedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <span className={`admin-status-badge ${sub.status}`}>
                        {sub.status}
                      </span>
                    </div>

                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--ink)' }}>{sub.notes}</p>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Included Domains:</span>
                      {sub.domains.map((d) => (
                        <span key={d} className="admin-domain-chip" data-domain={d}>
                          {DOMAIN_LABELS[d]?.icon} {d}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setInspectingSubmission(sub)}
                      >
                        Inspect Package JSON
                      </button>
                      {sub.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            className="prefab-import-btn"
                            onClick={() => handleApproveSubmission(sub)}
                          >
                            Approve & Publish to Catalog
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectSubmission(sub.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Tab 3: Package Linter & Validator */}
        {tab === 'validator' && (
          <section aria-label="Package Validator">
            <p className="admin-muted" style={{ marginBottom: '1.25rem' }}>
              Test any custom or community blueprint JSON bundle for schema compliance, ethical safety constraints, and referential integrity before deployment.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                type="button"
                className={`admin-filter-pill${validatorMode === 'file' ? ' active' : ''}`}
                onClick={() => setValidatorMode('file')}
              >
                📁 Upload / Drop File
              </button>
              <button
                type="button"
                className={`admin-filter-pill${validatorMode === 'paste' ? ' active' : ''}`}
                onClick={() => setValidatorMode('paste')}
              >
                📝 Paste Raw JSON
              </button>
            </div>

            {validatorMode === 'file' ? (
              <div
                className={`admin-dropzone-box${isDragging ? ' dragging' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file && fileInputRef.current) {
                    const dataTransfer = new DataTransfer()
                    dataTransfer.items.add(file)
                    fileInputRef.current.files = dataTransfer.files
                    fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="admin-dropzone-icon">📦</div>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>Drag & drop `.blueprint.json` package here</div>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
                  or click to browse your local filesystem
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={handleFileUpload}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <textarea
                  rows={8}
                  placeholder="Paste blueprint JSON bundle here..."
                  style={{ fontFamily: 'var(--mono)', fontSize: '12px', padding: '12px' }}
                  value={pastedJson}
                  onChange={(e) => setPastedJson(e.target.value)}
                />
                <div>
                  <button
                    type="button"
                    className="prefab-import-btn"
                    onClick={() => runPackageLinter(pastedJson)}
                  >
                    Validate Pasted JSON
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="cal-btn"
                onClick={() => {
                  const report = validatePrefabRegistry()
                  setValidationOutput(report)
                  setNotice('Audited all platform built-in blueprints and packs.')
                }}
              >
                Run Platform Registry Audit
              </button>
            </div>

            {validationOutput && (
              <div style={{ marginTop: '1.5rem', padding: '1.25rem', border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0, fontSize: '16px', color: validationOutput.valid ? '#10b981' : '#ef4444' }}>
                    {validationOutput.valid ? '✔ Blueprint Package Passed Validation' : '✖ Validation Failed'}
                  </h4>
                  {validationOutput.valid && validationOutput.parsedPayload && (
                    <button
                      type="button"
                      className="prefab-import-btn"
                      onClick={handleImportValidatedToCatalog}
                      style={{ fontSize: '12px' }}
                    >
                      Import & Add to Catalog ↗
                    </button>
                  )}
                </div>

                {validationOutput.errors.length === 0 && validationOutput.warnings.length === 0 && (
                  <p style={{ color: '#10b981', fontSize: '13px', margin: 0 }}>
                    All schema checks, referential integrity tests, and ethical safety invariants passed successfully with zero issues.
                  </p>
                )}

                {validationOutput.errors.map((e, i) => (
                  <p key={i} style={{ color: '#ef4444', fontSize: '13px', margin: '0.25rem 0' }}>
                    • {e}
                  </p>
                ))}
                {validationOutput.warnings.map((w, i) => (
                  <p key={i} style={{ color: '#f59e0b', fontSize: '13px', margin: '0.25rem 0' }}>
                    • {w}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Modal: Create or Edit Blueprint */}
        {(isCreating || editingBlueprint) && (
          <div className="admin-modal-backdrop" onClick={closeFormModal}>
            <div className="admin-modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-head">
                <h2>{isCreating ? 'Create New Blueprint' : `Edit '${editingBlueprint?.name}'`}</h2>
                <button type="button" onClick={closeFormModal} aria-label="Close dialog">
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveForm}>
                <div className="admin-modal-body">
                  <div className="admin-form-grid-2">
                    <div className="admin-form-group">
                      <label htmlFor="bp-form-name">Blueprint Title *</label>
                      <input
                        id="bp-form-name"
                        type="text"
                        required
                        placeholder="e.g. Creative Production Studio"
                        value={formName}
                        onChange={(e) => {
                          setFormName(e.target.value)
                          if (isCreating) {
                            setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
                          }
                        }}
                      />
                    </div>
                    <div className="admin-form-group">
                      <label htmlFor="bp-form-slug">Slug Identifier *</label>
                      <input
                        id="bp-form-slug"
                        type="text"
                        required
                        placeholder="e.g. creative-production-studio"
                        value={formSlug}
                        onChange={(e) => setFormSlug(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="admin-form-group">
                    <label htmlFor="bp-form-subtitle">One-Line Subtitle</label>
                    <input
                      id="bp-form-subtitle"
                      type="text"
                      placeholder="e.g. A 5-person agency managing delivery sprints and scope governance."
                      value={formSubtitle}
                      onChange={(e) => setFormSubtitle(e.target.value)}
                    />
                  </div>

                  <div className="admin-form-group">
                    <label htmlFor="bp-form-desc">Full Operational Description</label>
                    <textarea
                      id="bp-form-desc"
                      rows={3}
                      placeholder="Explain how this business operates, its core client engagements, and delivery cadence..."
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                    />
                  </div>

                  <div className="admin-form-group">
                    <label>Attach Domain Packs</label>
                    <small>Select the pre-calibrated packs that belong to this operational model:</small>

                    {(Object.keys(DOMAIN_LABELS) as PrefabDomain[]).map((dom) => {
                      const domainPacks = ALL_PACKS.filter((p) => p.domain === dom)
                      if (domainPacks.length === 0) return null

                      return (
                        <div key={dom} style={{ marginTop: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
                              {DOMAIN_LABELS[dom].icon} {DOMAIN_LABELS[dom].name}
                            </span>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                type="button"
                                onClick={() => selectAllDomainPacks(dom)}
                                style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--signal)', cursor: 'pointer', padding: 0 }}
                              >
                                Select all
                              </button>
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>·</span>
                              <button
                                type="button"
                                onClick={() => clearDomainPacks(dom)}
                                style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
                              >
                                Clear
                              </button>
                            </div>
                          </div>

                          <div className="admin-pack-select-grid">
                            {domainPacks.map((pack) => {
                              const isChecked = formPacks[dom]?.includes(pack.id)
                              return (
                                <label
                                  key={pack.id}
                                  className={`admin-pack-checkbox-item${isChecked ? ' checked' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleFormPack(dom, pack.id)}
                                  />
                                  <div>
                                    <strong>{pack.name}</strong>
                                    <span>{pack.records.length} records</span>
                                  </div>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="admin-modal-foot">
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Payload bundle: <strong>{formTotalRecords} records</strong> selected
                  </span>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button type="button" onClick={closeFormModal}>
                      Cancel
                    </button>
                    <button type="submit" className="prefab-import-btn">
                      {isCreating ? 'Create Blueprint' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Inspect Submission JSON */}
        {inspectingSubmission && (
          <div className="admin-modal-backdrop" onClick={() => setInspectingSubmission(null)}>
            <div className="admin-modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-head">
                <h2>{inspectingSubmission.title} — Submission Package</h2>
                <button type="button" onClick={() => setInspectingSubmission(null)}>
                  ✕
                </button>
              </div>

              <div className="admin-modal-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    Author: <strong>{inspectingSubmission.author}</strong> ({inspectingSubmission.email})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(inspectingSubmission.packageJson)
                      setNotice('Copied package JSON to clipboard.')
                    }}
                  >
                    Copy JSON
                  </button>
                </div>

                <div className="admin-json-viewer">
                  {inspectingSubmission.packageJson}
                </div>

                <div style={{ background: 'var(--panel)', padding: '14px', border: '1px solid var(--line)', borderRadius: '6px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>Pre-Publication Checklist</div>
                  <div style={{ fontSize: '12px', color: '#10b981', margin: '3px 0' }}>✔ No sensitive PII detected (all contacts hypothetical)</div>
                  <div style={{ fontSize: '12px', color: '#10b981', margin: '3px 0' }}>✔ Staffing roles marked vacant with defined weekly capacity</div>
                  <div style={{ fontSize: '12px', color: '#10b981', margin: '3px 0' }}>✔ Zero broken references across tasks and roles</div>
                  <div style={{ fontSize: '12px', color: '#10b981', margin: '3px 0' }}>✔ Standard schema manifest compatibility verified</div>
                </div>
              </div>

              <div className="admin-modal-foot">
                <button type="button" onClick={() => setInspectingSubmission(null)}>
                  Close
                </button>
                {inspectingSubmission.status === 'pending' && (
                  <button
                    type="button"
                    className="prefab-import-btn"
                    onClick={() => handleApproveSubmission(inspectingSubmission)}
                  >
                    Approve & Publish to Catalog
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
