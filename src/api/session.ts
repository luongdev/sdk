import type { RTCSessionEvent } from 'jssip/lib/UA';

export interface SessionEventHandler {
  handle(session: RTCSessionEvent): Promise<any>;
}

export class IncomingSessionEventHandler {}

export class OutgoingSessionEventHandler {}
