import { useEffect } from 'react'
import { DocumentShell } from './DocumentShell'
import { DocumentsList } from './DocumentsList'
import { DocumentsHeader } from './DocumentsHeader'
import { useDocuments } from './store'

export function DocumentsExperience({ roomId, owner }: { roomId?: string; owner: string }) {
  const openId = useDocuments((state) => state.openId)
  const ensure = useDocuments((state) => state.ensure)
  useEffect(() => { ensure(owner) }, [ensure, owner])

  return (
    <div className="docs-layout">
      {openId && <DocumentsHeader />}
      <div className="docs-content">
        {openId ? <DocumentShell roomId={roomId} owner={owner} /> : <DocumentsList owner={owner} />}
      </div>
    </div>
  )
}
