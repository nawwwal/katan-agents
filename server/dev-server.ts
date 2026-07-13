import { createRealtimeServer } from './realtime-server'
import { closeRoomStore } from './room-service'

const host = '127.0.0.1'
const port = Number(process.env.KATAN_ROOM_PORT || 8787)
const server = createRealtimeServer()

server.listen(port, host, () => console.log(`Katan room service listening on http://${host}:${port}`))

const shutdown = () => server.close(() => { void closeRoomStore().finally(() => process.exit(0)) })
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
