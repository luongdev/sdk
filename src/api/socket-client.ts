import { io, type ManagerOptions, Socket, type SocketOptions } from 'socket.io-client';
import type { State } from '@api/broadcaster.ts';

export class SocketClient {
  private _socket?: Socket;
  private readonly _url: URL;
  private readonly _opts: Partial<ManagerOptions & SocketOptions>;

  private readonly _stateBroadcast: { broadcast: (state: State) => void };

  private _connecting = false;
  private _connected = false;
  private _alive = false;

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return this._connected;
  }

  get alive(): boolean {
    return this._alive;
  }

  constructor(nssUrl: URL, extension: string, appName: string, stateBroadcast: { broadcast: (state: State) => void }) {
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

  public setup(): void {
    this._socket = io(this._url.origin, this._opts);
    this._socket.connect();

    this._socket.on('connect', () => {
      this._connecting = false;
      this._connected = true;
      this._alive = true;
    });

    this._socket.on('disconnect', _ => {
      this._connected = false;
      this._alive = false;
    });

    this._socket.on('connect_error', error => {
      console.error('Socket connection error:', error);
    });

    this._socket.on('change-status', (data: any, metadata: any, ack: (d: any) => void) => {
      console.log('Status change received:', { data, metadata });

      this._stateBroadcast.broadcast({
        key: 'change-status',
        value: { ...data },
        version: metadata.seq || Date.now(),
      });

      ack({ success: true });
    });
  }

  /**
   * Gửi sự kiện đến server
   * @param event Tên sự kiện
   * @param data Dữ liệu gửi đi
   * @param callback Hàm callback được gọi khi nhận được ack từ server
   */
  public emit(event: string, data: any, callback?: (response: any) => void): void {
    if (!this._socket || !this._connected) {
      console.error('Cannot emit event: socket not connected');
      if (callback) {
        callback({ success: false, error: 'Socket not connected' });
      }
      return;
    }

    if (callback) {
      this._socket.emit(event, data, callback);
    } else {
      this._socket.emit(event, data);
    }
  }
}
