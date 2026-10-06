import { createRoot } from 'react-dom/client'
import { MapEditor } from '../src/features/documents/editors/MapEditor'
import { useDocuments } from '../src/features/documents/store'
import { useDocumentPresence } from '../src/features/documents/presence'
import '../src/features/work/work.css'
const doc = { id: 'map-test', title: 'Map', surface: 'mental_map' as const, ownerName: 'Test', updatedAt: 1, roomIds: [], nodes: [
  { id: 'one', shape: 'rect' as const, x: 100, y: 100, width: 148, height: 72, text: 'One' },
  { id: 'two', shape: 'diamond' as const, x: 400, y: 100, width: 148, height: 72, text: 'Two' },
  ...Array.from({ length: 1000 }, (_, i) => ({ id: `far-${i}`, shape: 'circle' as const, x: 10000 + i * 200, y: 10000, width: 148, height: 72, text: 'Far' })),
], edges: [{ id: 'edge', sourceId: 'one', targetId: 'two', sourceNub: 'right' as const, targetNub: 'left' as const, direction: 'forward' as const }] }
useDocuments.setState({ docs: [doc], mode: 'local', ready: true })
;(window as any).mapStore = useDocuments
function Fixture() {
  const current = useDocuments(state => state.docs[0])
  useDocumentPresence(current.id, 'Test')
  return <MapEditor doc={current} />
}
createRoot(document.getElementById('root')!).render(<Fixture />)
