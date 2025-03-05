import { io, type ManagerOptions, Socket, type SocketOptions } from 'socket.io-client';
import { StatusEvent } from '@api/types/status.ts';
import { v7 as uuidv7 } from 'uuid';

export type EventCallback = (data: any, metadata?: any) => void;

export class SocketClient {
  private _socket?: Socket;
  private readonly _url: URL;
  private readonly _browserId: string;
  private readonly _opts: Partial<ManagerOptions & SocketOptions>;
  private readonly _eventHandlers: Map<string, Set<EventCallback>> = new Map();

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

  get browserId(): string {
    return this._browserId;
  }

  constructor(nssUrl: URL, extension: string, domain: string, browserId?: string) {
    this._url = nssUrl;

    const storedBrowserId = localStorage.getItem('mpsdk_browser_id');
    if (storedBrowserId) {
      browserId = storedBrowserId;
    } else {
      browserId = `browser_${uuidv7()}`;
      localStorage.setItem('mpsdk_browser_id', browserId);
    }
    console.log('Using browser ID:', browserId);

    this._browserId = browserId;

    this._opts = {
      path: nssUrl.pathname,
      ackTimeout: 3000,
      closeOnBeforeunload: true,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      query: { extension, domain, browserId },
    };
    this._eventHandlers = new Map();
  }

  public addEventHandler(eventName: string, callback: EventCallback): () => void {
    if (!this._eventHandlers.has(eventName)) {
      this._eventHandlers.set(eventName, new Set());
    }

    const handlers = this._eventHandlers.get(eventName)!;
    handlers.add(callback);

    console.log(`Added handler for event: ${eventName}`);

    if (this._socket && this._connected && !this._socket.hasListeners(eventName)) {
      this._registerEventListener(eventName);
    }

    return () => {
      this.removeEventHandler(eventName, callback);
    };
  }

  public removeEventHandler(eventName: string, callback: EventCallback): void {
    if (this._eventHandlers.has(eventName)) {
      const handlers = this._eventHandlers.get(eventName)!;
      handlers.delete(callback);

      if (handlers.size === 0) {
        this._eventHandlers.delete(eventName);

        if (this._socket && this._connected) {
          this._socket.off(eventName);
        }
      }

      console.log(`Removed handler for event: ${eventName}`);
    }
  }

  private _registerEventListener(eventName: string): void {
    if (!this._socket || !this._connected) {
      return;
    }

    if (this._socket.hasListeners(eventName)) {
      this._socket.off(eventName);
    }

    this._socket.on(eventName, (data: any, metadata: any, ack: (d: any) => void) => {
      console.log(`Event ${eventName} received:`, { data, metadata });

      this._callEventHandlers(eventName, data, metadata);

      if (ack && typeof ack === 'function') {
        ack({ success: true });
      }
    });
  }

  private _callEventHandlers(eventName: string, data: any, metadata?: any): void {
    if (this._eventHandlers.has(eventName)) {
      const handlers = this._eventHandlers.get(eventName)!;
      handlers.forEach(handler => {
        try {
          handler(data, metadata);
        } catch (error) {
          console.error(`Error in handler for event ${eventName}:`, error);
        }
      });
    }
  }

  public setup(): void {
    if (this._socket && this._connected) {
      console.log('Socket already connected, skipping setup');
      return;
    }

    if (this._socket) {
      this.disconnect();
      console.log('Waiting for old socket to fully disconnect...');
    }

    console.log('Setting up new socket connection to:', this._url.origin);
    this._socket = io(this._url.origin, this._opts);

    this._socket.on('connect', () => {
      this._connecting = false;
      this._connected = true;
      this._alive = true;
      console.log('Socket connected successfully');

      this._registerAllEventListeners();
    });

    this._socket.on('disconnect', () => {
      this._connected = false;
      this._alive = false;
      console.log('Socket disconnected');
    });

    this._socket.on('connect_error', error => {
      console.error('Socket connection error:', error);
    });

    this._registerEventListener(StatusEvent.STATUS_CHANGED);

    this._socket.connect();
  }

  private _registerAllEventListeners(): void {
    for (const eventName of this._eventHandlers.keys()) {
      this._registerEventListener(eventName);
    }
  }

  public disconnect(): void {
    if (this._socket) {
      console.log('Disconnecting socket...');
      try {
        this._socket.disconnect();
        this._socket.removeAllListeners();
        this._socket = undefined;
        this._connected = false;
        this._alive = false;
        this._connecting = false;
        console.log('Socket disconnected successfully');
      } catch (error) {
        console.error('Error disconnecting socket:', error);
      }
    }
  }

  public emit(event: string, data: any, callback?: (response: any) => void): void {
    if (!this._socket || !this._connected) {
      console.error('Cannot emit event: socket not connected');
      if (callback) {
        callback({ success: false, error: 'Socket not connected' });
      }
      return;
    }

    console.log('Emitting event:', event, 'with data:', data);

    if (callback) {
      this._socket.emitWithAck(event, data).then(callback).catch(callback);
    } else {
      this._socket.emit(event, data);
    }
  }
}
