import type { Status, StatusDelegate } from '@api/types/status.ts';
import { StatusEvent } from '@api/types/status.ts';
import type { Config } from '@api/types/types.ts';
import { SocketClient } from '@api/socket-client.ts';
import { Broadcaster } from '@api/broadcaster.ts';
import { LocalBroadcaster } from '@api/local-broadcaster.ts';
import type { StatusMessage } from '@api/local-broadcaster.ts';
import { v7 as uuidv7 } from 'uuid';

export class StatusManager {
  private readonly _socketClient?: SocketClient;
  private readonly _broadcaster: Broadcaster;
  private readonly _localBroadcaster: LocalBroadcaster;
  private readonly _delegate?: StatusDelegate;
  private readonly _config: Config;

  private _currentStatus: Status = { status: 'OFFLINE' };
  private _pendingStatusChange: { id: string; status: string; reason?: string } | null = null;
  private _unsubscribeLocalEvents?: () => void;
  private _lastStatusTimestamp: number = 0;

  constructor(config: Config) {
    this._config = config;
    this._delegate = config.delegate;
    this._broadcaster = new Broadcaster();
    this._localBroadcaster = new LocalBroadcaster();

    this._setupLocalBroadcaster();

    if (config.nssUrl) {
      const nssUrl = new URL(config.nssUrl);
      this._socketClient = new SocketClient(nssUrl, config.appId, config.appName, this._broadcaster);

      this._setupBroadcaster();
    }
  }

  private _setupLocalBroadcaster() {
    this._unsubscribeLocalEvents = this._localBroadcaster.subscribe(
      StatusEvent.STATUS_CHANGED,
      (message: StatusMessage) => {
        console.log('Received status change from another tab:', message);

        if (message.timestamp <= this._lastStatusTimestamp) {
          console.log(
            `Ignoring outdated status message (timestamp ${message.timestamp} <= ${this._lastStatusTimestamp})`,
          );
          return;
        }

        this._lastStatusTimestamp = message.timestamp;

        this._currentStatus = {
          status: message.status,
          reason: message.reason,
        };

        this._delegate?.onStatus?.(message.status, message.reason);
      },
    );
  }

  private _setupBroadcaster() {
    this._broadcaster.addStateListener(state => {
      if (state.key === StatusEvent.STATUS_CHANGED) {
        const statusData = state.value as Status;
        console.log('Received status change from server:', statusData);

        const newTimestamp = statusData.timestamp || Date.now();

        if (
          this._pendingStatusChange &&
          this._pendingStatusChange.status === statusData.status &&
          this._pendingStatusChange.reason === statusData.reason
        ) {
          console.log('Received status change confirmation from server, skipping duplicate notification');

          this._lastStatusTimestamp = newTimestamp;
          this._currentStatus = statusData;
          this._localBroadcaster.broadcastStatusChange(statusData.status, statusData.reason);
          this._pendingStatusChange = null;
        } else {
          if (newTimestamp <= this._lastStatusTimestamp) {
            console.log(
              `Ignoring outdated status message from server (timestamp ${newTimestamp} <= ${this._lastStatusTimestamp})`,
            );
            return;
          }

          this._lastStatusTimestamp = newTimestamp;
          this._currentStatus = statusData;
          this._delegate?.onStatus?.(statusData.status, statusData.reason);
          this._localBroadcaster.broadcastStatusChange(statusData.status, statusData.reason);
        }
      }
    });
  }

  public connect(): void {
    if (this._socketClient) {
      this._socketClient.setup();
    }
  }

  public get currentStatus(): Status {
    return this._currentStatus;
  }

  public async changeStatus(status: string, reason?: string): Promise<boolean> {
    if (!this._config.nssUrl || !this._config.appId || !this._config.appName) {
      console.error('Missing required configuration for status change');
      return false;
    }

    try {
      if (!this._socketClient || !this._socketClient.connected) {
        console.error('Socket client not connected');
        return false;
      }

      const statusData = {
        extension: this._config.appId,
        domain: this._config.appName,
        statusName: status,
        reasonName: reason,
        changeTime: Date.now(),
      };

      const changeId = uuidv7();

      this._lastStatusTimestamp = Date.now();

      this._pendingStatusChange = {
        id: changeId,
        status,
        reason,
      };

      return new Promise(resolve => {
        const newStatus = { status, reason };
        this._currentStatus = newStatus;
        this._delegate?.onStatus?.(status, reason);

        this._localBroadcaster.broadcastStatusChange(status, reason);

        this._socketClient?.emit(StatusEvent.REQUEST_STATUS_CHANGE, statusData, response => {
          if (response && response.success) {
            console.log(`Status change to ${status} acknowledged by server`);
            resolve(true);
          } else {
            console.error(`Status change to ${status} rejected by server:`, response?.error || 'Unknown error');

            if (response && !response.success) {
              console.log('Server will send current status via STATUS_CHANGED event');
            }

            this._pendingStatusChange = null;
            resolve(false);
          }
        });

        setTimeout(() => {
          if (this._pendingStatusChange && this._pendingStatusChange.id === changeId) {
            console.log('Clearing pending status change due to timeout');
            this._pendingStatusChange = null;
          }
        }, 3000);
      });
    } catch (error) {
      console.error('Error changing status:', error);
      this._pendingStatusChange = null;
      return false;
    }
  }

  public dispose(): void {
    if (this._unsubscribeLocalEvents) {
      this._unsubscribeLocalEvents();
    }

    this._localBroadcaster.close();
  }
}
