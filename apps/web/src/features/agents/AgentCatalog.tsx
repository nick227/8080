import { useAgentTypes, useCreateAgent } from '@project/sdk'

const FAMILY_LABEL: Record<string, string> = { scheduled: 'Scheduled', followup: 'Follow-ups', manual: 'Manual', team: 'Team', social: 'Social' }

/** Add agent: picking a built-in creates a draft and opens it — no wizard (docs/agents/01 §2). */
export function AgentCatalog({ workspaceId, onCancel, onCreated }: { workspaceId: string; onCancel: () => void; onCreated: (agentId: string) => void }) {
  const types = useAgentTypes(workspaceId)
  const create = useCreateAgent(workspaceId)
  const families = [...new Set((types.data ?? []).map((t) => t.family))]

  return (
    <section className="agents-catalog" aria-label="Add agent">
      <div className="agents-bar">
        <button type="button" className="agents-back" onClick={onCancel}>
          ← Agents
        </button>
      </div>
      {types.isLoading && <p className="agents-status">Loading…</p>}
      {types.isError && <p className="agents-status">Couldn’t load the agents you can add.</p>}
      {families.map((family) => (
        <div key={family} className="agents-family">
          <h2 className="agents-label">{FAMILY_LABEL[family] ?? family}</h2>
          <ul className="agents-choices">
            {(types.data ?? [])
              .filter((t) => t.family === family)
              .map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    className="agents-choice"
                    disabled={create.isPending}
                    onClick={() => void create.mutateAsync(t.key).then((agent) => onCreated(agent.id))}
                  >
                    <span className="agents-choice-name">{t.name}</span>
                    <span className="agents-choice-desc">{t.description}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {create.isError && (
        <p className="agents-status" role="alert">
          {create.error instanceof Error ? create.error.message : 'Couldn’t add the agent.'}
        </p>
      )}
    </section>
  )
}
