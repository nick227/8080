import { useEffect } from 'react'
import { DocumentShell } from './DocumentShell'
import { DocumentsList } from './DocumentsList'
import { DocumentsHeader } from './DocumentsHeader'
import { useDocuments } from './store'
import { useCurrentWorkspace } from '../../app/workspace'

export function DocumentsExperience({ roomId, owner }: { roomId?: string; owner: string }) {
  const openId = useDocuments((state) => state.openId)
  const ensure = useDocuments((state) => state.ensure)
  const notice = useDocuments((state) => state.notice)
  const companyId = useCurrentWorkspace().workspace?.id ?? null
  useEffect(() => { ensure(owner, companyId) }, [ensure, owner, companyId])

  return (
    <div className="docs-layout">
      {openId && <DocumentsHeader />}
      {!openId && notice && <p className="docs-notice" role="status">{notice}</p>}
      <div className="docs-content">
        {openId ? <DocumentShell roomId={roomId} owner={owner} /> : <DocumentsList owner={owner} />}
      </div>
    </div>
  )
}
