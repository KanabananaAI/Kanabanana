import { Server as SocketServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

// ---------- Types ----------

export type BusChannel = 'chat-ui' | 'server';

export interface BusMessage {
  id: string;
  type: string;
  channel: BusChannel;
  threadId: string | null;
  payload: any;
  timestamp: string;
}

export type BusHandler = (message: BusMessage) => void | Promise<void>;

// ---------- Message Bus ----------

const handlers = new Map<string, Set<BusHandler>>();
let io: SocketServer | null = null;

export function initBus(socketServer: SocketServer): void {
  io = socketServer;
}

export function emit(type: string, channel: BusChannel, threadId: string | null, payload: any): BusMessage {
  const message: BusMessage = {
    id: uuidv4(),
    type,
    channel,
    threadId,
    payload,
    timestamp: new Date().toISOString(),
  };

  const typeHandlers = handlers.get(type);
  if (typeHandlers) {
    for (const handler of typeHandlers) {
      try {
        handler(message);
      } catch (err) {
        console.error(`[kanaban:bus] Error in handler for ${type}:`, err);
      }
    }
  }

  return message;
}

export function on(type: string, handler: BusHandler): void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(handler);
}

export function off(type: string, handler: BusHandler): void {
  handlers.get(type)?.delete(handler);
}

export function getIO(): SocketServer | null {
  return io;
}
