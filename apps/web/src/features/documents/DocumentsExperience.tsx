import { useEffect } from 'react'
import { DocumentShell } from './DocumentShell'
import { DocumentsList } from './DocumentsList'
import { useDocuments } from './store'

export function DocumentsExperience({ roomId, owner }: { roomId?: string; owner: string }) {
  const openId = useDocuments((state) => state.openId)
  const ensure = useDocuments((state) => state.ensure)
  useEffect(() => { ensure(owner) }, [ensure, owner])
  if (openId) return <DocumentShell roomId={roomId} owner={owner} />
  return <DocumentsList owner={owner} />
}
