import { StatusEvent } from '@api/types/status.ts';
import { v7 as uuidv7 } from 'uuid';

export interface StatusMessage {
  type: string;
  status: string;
  reason?: string;
  timestamp: number;
  source: string;
  countTime? : number;
}

export class LocalBroadcaster {
  private readonly _channel: BroadcastChannel;
  private readonly _instanceId: string;
  private readonly _listeners: Map<string, Set<(message: StatusMessage) => void>> = new Map();

  constructor(channelName: string = 'voip-sdk-status') {
    this._instanceId = uuidv7();
    this._channel = new BroadcastChannel(channelName);
    this._channel.onmessage = this._handleMessage.bind(this);

    console.log(`LocalBroadcaster initialized with ID: ${this._instanceId}`);
  }

  private _handleMessage(event: MessageEvent<StatusMessage>): void {
    const message = event.data;

    if (message.source === this._instanceId) {
      console.log('Ignoring message from self');
      return;
    }

    console.log(`Received message from ${message.source}:`, message);

    const listeners = this._listeners.get(message.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('Error in status listener:', error);
        }
      });
    }
  }

  public subscribe(type: string, listener: (message: StatusMessage) => void): () => void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }

    const listeners = this._listeners.get(type)!;
    listeners.add(listener);

    console.log(`Subscribed to ${type} events`);

    return () => {
      if (this._listeners.has(type)) {
        const listeners = this._listeners.get(type)!;
        listeners.delete(listener);

        if (listeners.size === 0) {
          this._listeners.delete(type);
        }
      }
    };
  }

  public broadcastStatusChange(status: string, reason?: string, countTime?: number): void {
    const message: StatusMessage = {
      type: StatusEvent.STATUS_CHANGED,
      status,
      reason,
      timestamp: Date.now(),
      source: this._instanceId,
      countTime
    };

    console.log('Broadcasting status change:', message);
    this._channel.postMessage(message);
  }

  public close(): void {
    this._channel.close();
    this._listeners.clear();
    console.log('LocalBroadcaster closed');
  }
}
