import { io, type ManagerOptions, Socket, type SocketOptions } from 'socket.io-client';
import type { StateBroadcast } from '@/shared/state-broadcast.ts';

export class SocketClient {
  private _socket?: Socket;
  private readonly _url: URL;
  private readonly _opts: Partial<ManagerOptions & SocketOptions>;

  private readonly _stateBroadcast: StateBroadcast;

  private _connecting = false;
  private _connected = false;
  private _alive = false;

  get connecting() {
    return this._connecting;
  }
  get connected() {
    return this._connected;
  }
  get alive() {
    return this._alive;
  }

  constructor(nssUrl: URL, extension: string, appName: string, stateBroadcast: StateBroadcast) {
    this._url = nssUrl;
    this._opts = {
      path: nssUrl.pathname,
      ackTimeout: 3000,
      closeOnBeforeunload: true,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      query: {
        extension: extension,
        domain: appName,
      },
    };

    this._stateBroadcast = stateBroadcast;
  }

  public setup() {
    this._socket = io(this._url.origin, this._opts);
    this._socket.connect();

    this._socket.on('connect', () => {
      this._connecting = false;
      this._connected = true;
      this._alive = true;
    });

    this._socket.on('disconnect', reason => {
      console.log('reason', reason);
      this._connecting = false;
      this._connected = false;
      this._alive = false;
    });

    this._socket.on('connect_error', error => {
      console.log('error', error);
    });

    this._socket.on('change-status', (data: any, metadata: any, ack: (d: any) => void) => {
      console.log('status', { data, metadata });

      this._stateBroadcast.broadcast({
        key: 'change-status',
        value: { ...data },
        version: metadata.ts,
      });

      ack({ success: true });
    });
  }

  public emit() {
    this._socket?.emit('');
  }
}
