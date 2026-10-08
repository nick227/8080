import type { ReactNode } from 'react'
import type { InventoryItem, WorkspaceMember } from '@project/sdk'
import { STAGES, titleCase } from './labels'

export type FormDraft = {
  name: string
  email: string
  phone: string
  company: string
  stage: string
  ownerId: string
  source: string
  tagIds: string[]
  price: string
  sku: string
  category: string
  description: string
  offered: boolean
  tracking: boolean
  quantity: string
  threshold: string
  location: string
}

type SetDraft = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => void

export function ContactFields({
  form,
  set,
  fieldError,
  members,
  creating,
  stages = STAGES.map((key) => ({ key, label: titleCase(key) })),
  categories = [],
}: {
  form: FormDraft
  set: SetDraft
  fieldError: Partial<Record<keyof FormDraft, string>>
  members: WorkspaceMember[]
  creating: boolean
  stages?: { key: string; label: string }[]
  categories?: { id: string; name: string }[]
}) {
  return (
    <>
      <FieldGroup title="Identity">
        <Field label="Name" error={fieldError.name}>
          <input
            autoFocus
            required
            maxLength={160}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <div className="record-field-pair">
          <Field label="Email">
            <input type="email" maxLength={255} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input type="tel" maxLength={40} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
        </div>
        {creating ? (
          <Field label="Company">
            <input maxLength={160} value={form.company} onChange={(e) => set('company', e.target.value)} />
          </Field>
        ) : form.company ? (
          <p className="record-muted">Company · {form.company}</p>
        ) : null}
      </FieldGroup>
      <FieldGroup title="Business details">
        <div className="record-field-pair">
          <Field label="Lead stage">
            <select value={form.stage} onChange={(e) => set('stage', e.target.value)}>
              {creating && <option value="">First open pipeline stage</option>}
              {stages.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner">
            <select value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
              <option value="">Unassigned</option>
              {members
                .filter((member) => member.status === 'active')
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.user.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Source">
          <input maxLength={80} value={form.source} onChange={(e) => set('source', e.target.value)} />
        </Field>
        {categories.length > 0 && (
          <Field label="Categories">
            <div className="record-category-toggles" role="group" aria-label="Contact categories">
              {categories.map((tag) => {
                const on = form.tagIds.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set('tagIds', on ? form.tagIds.filter((id) => id !== tag.id) : [...form.tagIds, tag.id])
                    }
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </Field>
        )}
      </FieldGroup>
    </>
  )
}

export function InventoryFields({
  form,
  set,
  fieldError,
  currency,
  item,
  categories = [],
}: {
  form: FormDraft
  set: SetDraft
  fieldError: Partial<Record<keyof FormDraft, string>>
  currency: string
  item?: InventoryItem
  categories?: string[]
}) {
  return (
    <>
      <FieldGroup title="Identity">
        <Field label="Name" error={fieldError.name}>
          <input
            autoFocus
            required
            maxLength={160}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
      </FieldGroup>
      <FieldGroup title="Business details">
        <div className="record-field-pair">
          <Field label={`Price (${currency})`} error={fieldError.price}>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>
          <Field label="SKU">
            <input maxLength={80} value={form.sku} onChange={(e) => set('sku', e.target.value)} />
          </Field>
        </div>
        <div className="record-field-pair">
          <Field label="Category">
            {categories.length ? (
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">None</option>
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {form.category && !categories.includes(form.category) && (
                  <option value={form.category}>{form.category}</option>
                )}
              </select>
            ) : (
              <input maxLength={80} value={form.category} onChange={(e) => set('category', e.target.value)} />
            )}
          </Field>
          <Field label="Availability">
            <select
              value={form.offered ? 'offered' : 'paused'}
              onChange={(e) => set('offered', e.target.value === 'offered')}
            >
              <option value="offered">Offered</option>
              <option value="paused">Paused</option>
            </select>
          </Field>
        </div>
        <Field label="Description">
          <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </FieldGroup>
      <FieldGroup title="Properties">
        <label className="record-checkbox">
          <input
            type="checkbox"
            checked={form.tracking}
            onChange={(e) => {
              const tracking = e.target.checked
              if (
                !tracking &&
                item?.quantity != null &&
                !window.confirm('Stop tracking stock? The saved quantity will be cleared.')
              )
                return
              set('tracking', tracking)
            }}
          />
          <span>Track stock for this item</span>
        </label>
        {form.tracking ? (
          <>
            <div className="record-field-pair">
              <Field label="In stock" error={fieldError.quantity}>
                <input
                  required
                  inputMode="numeric"
                  placeholder="0"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                />
              </Field>
              <Field label="Low-stock at" error={fieldError.threshold}>
                <input
                  inputMode="numeric"
                  placeholder="Optional"
                  value={form.threshold}
                  onChange={(e) => set('threshold', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Location">
              <input
                maxLength={120}
                placeholder="Shelf, bin, warehouse…"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
              />
            </Field>
          </>
        ) : (
          <p className="record-muted"></p>
        )}
      </FieldGroup>
    </>
  )
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="record-form-group">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
      {error && (
        <small className="record-error" role="alert">
          {error}
        </small>
      )}
    </label>
  )
}
