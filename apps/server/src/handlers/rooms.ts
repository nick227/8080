import { RoomService } from '../services/RoomService'

const roomService = new RoomService()

export async function listRooms(request: any, reply: any) {
  return reply.send(await roomService.listPublic(request.user.id, request.query))
}

export async function listMyRooms(request: any, reply: any) {
  return reply.send(await roomService.listMine(request.user.id, request.query))
}

export async function createRoom(request: any, reply: any) {
  const room = await roomService.create(request.user.id, request.body)
  return reply.status(201).send({ data: room })
}

export async function getRoom(request: any, reply: any) {
  return reply.send({ data: await roomService.get(request.user.id, request.params.roomId) })
}

export async function updateRoom(request: any, reply: any) {
  return reply.send({ data: await roomService.update(request.user.id, request.params.roomId, request.body) })
}

export async function deleteRoom(request: any, reply: any) {
  await roomService.remove(request.user.id, request.params.roomId)
  return reply.send({ data: null })
}

export async function joinRoom(request: any, reply: any) {
  const room = await roomService.join(request.user.id, request.params.roomId, request.body?.inviteCode)
  return reply.send({ data: room })
}

export async function leaveRoom(request: any, reply: any) {
  await roomService.leave(request.user.id, request.params.roomId)
  return reply.send({ data: null })
}

export async function rotateInviteCode(request: any, reply: any) {
  return reply.send({ data: await roomService.rotateInviteCode(request.user.id, request.params.roomId) })
}
