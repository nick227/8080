import { RoomServiceClient, AccessToken } from 'livekit-server-sdk'

async function runTest() {
  const url = process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET

  if (!url || !apiKey || !apiSecret) {
    console.error('Missing required LiveKit environment variables.')
    console.error({ url: !!url, apiKey: !!apiKey, apiSecret: !!apiSecret })
    process.exit(1)
  }

  console.log(`Validating LiveKit credentials against ${url}...`)

  try {
    // 1. Validate network/API connection by listing rooms
    const roomService = new RoomServiceClient(url, apiKey, apiSecret)
    const rooms = await roomService.listRooms()
    console.log('✅ Connection successful!')
    console.log(`✅ Currently active rooms: ${rooms.length}`)

    // 2. Validate token generation
    const at = new AccessToken(apiKey, apiSecret, {
      identity: 'test-user-id',
      name: 'Test User',
    })
    at.addGrant({ roomJoin: true, room: 'test-room' })
    const token = await at.toJwt()
    
    if (token && typeof token === 'string') {
      console.log('✅ Token generation successful!')
    } else {
      throw new Error('Token generation returned invalid format')
    }

    console.log('\nAll LiveKit MVP validations passed! 🚀')
    process.exit(0)
  } catch (err: any) {
    console.error('\n❌ LiveKit validation failed:')
    console.error(err?.message || err)
    process.exit(1)
  }
}

void runTest()
