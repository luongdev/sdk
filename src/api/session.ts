import type { RTCSessionEvent } from 'jssip/lib/UA';
import type { CallDelegate } from '@api/types/call.ts';
import type { Delegate } from '@api/types/types.ts';

export interface SessionHandler {
  handle(session: RTCSessionEvent): Promise<any>;
}

export class IncomingSessionHandler {}

export class OutgoingSessionHandler {}

export class SessionHandlerFactory {
  private readonly _delegate?: CallDelegate;

  constructor(delegate?: Delegate) {
    this._delegate = delegate;
  }

  create(): SessionHandler {
    console.log(this._delegate);
    throw new Error('Method not implemented.');
  }
}
