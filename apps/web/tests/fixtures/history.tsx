import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createApiClient, useRoomItems, useRoomStream } from '@project/sdk'
import { ChatStream } from '../../src/features/room/ChatStream'

createApiClient({ baseUrl: '/history-api' })
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function History() {
  const history = useRoomItems('history', { pageSize: 3 })
  useRoomStream('history')
  return <ChatStream
    rows={history.items.map((item) => ({ id: item.id, author: 'Alice', authorId: 'alice', text: item.message.text ?? '', media: [] }))}
    pin={0}
    hasOlder={history.hasNextPage}
    loadingOlder={history.isFetchingNextPage}
    onLoadOlder={() => { void history.fetchNextPage() }}
  />
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><History /></QueryClientProvider>)
