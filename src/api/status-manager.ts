import type { Status, StatusDelegate } from '@api/types/status.ts';
import { StatusEvent } from '@api/types/status.ts';
import type { Config } from '@api/types/types.ts';
import { SocketClient } from '@api/socket-client.ts';
import { LocalBroadcaster } from '@api/local-broadcaster.ts';
import type { StatusMessage } from '@api/local-broadcaster.ts';
import { v7 as uuidv7 } from 'uuid';

export class StatusManager {
  private readonly _socketClient?: SocketClient;
  private readonly _localBroadcaster: LocalBroadcaster;
  private readonly _delegate?: StatusDelegate;
  private readonly _config: Config;

  private _currentStatus: Status = { status: 'OFFLINE' };
  private _pendingStatusChange: { id: string; status: string; reason?: string } | null = null;
  private _unsubscribeLocalEvents?: () => void;
  private _unsubscribeSocketEvents?: () => void;
  private _lastStatusTimestamp: number = 0;

  constructor(config: Config) {
    this._config = config;
    this._delegate = config.delegate;
    this._localBroadcaster = new LocalBroadcaster();

    this._setupLocalBroadcaster();

    if (config.nssUrl) {
      const nssUrl = new URL(config.nssUrl);
      this._socketClient = new SocketClient(nssUrl, config.appId, config.appName);
      this._setupSocketEventHandlers();
    }
  }

  /**
   * Thiết lập các event handler cho socket client
   */
  private _setupSocketEventHandlers(): void {
    if (!this._socketClient) return;

    // Hủy đăng ký handler cũ nếu có
    if (this._unsubscribeSocketEvents) {
      this._unsubscribeSocketEvents();
    }

    // Đăng ký handler cho sự kiện STATUS_CHANGED
    this._unsubscribeSocketEvents = this._socketClient.addEventHandler(
      StatusEvent.STATUS_CHANGED,
      (data: any, metadata: any) => {
        console.log('Status changed event received from server:', { data, metadata });

        // Kiểm tra timestamp để tránh xử lý sự kiện cũ
        if (data.timestamp && data.timestamp <= this._lastStatusTimestamp) {
          console.log(`Ignoring outdated status message (timestamp ${data.timestamp} <= ${this._lastStatusTimestamp})`);
          return;
        }

        // Cập nhật timestamp mới nhất
        if (data.timestamp) {
          this._lastStatusTimestamp = data.timestamp;
        } else {
          this._lastStatusTimestamp = Date.now();
        }

        // Cập nhật trạng thái hiện tại
        const status = data.status || data.statusName;
        const reason = data.reason || data.reasonName;

        this._currentStatus = {
          status,
          reason,
        };

        // Thông báo cho delegate
        if (this._delegate?.statusChanged) {
          this._delegate.statusChanged(status, reason);
        }

        // Broadcast cho các tab khác
        this._localBroadcaster.broadcastStatusChange(status, reason);
      },
    );
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

        if (this._delegate?.statusChanged) {
          this._delegate.statusChanged(message.status, message.reason);
        }
      },
    );
  }

  public connect(): void {
    if (this._socketClient) {
      console.log('StatusManager: Connecting socket client');
      this._socketClient.setup();

      // Đảm bảo event handlers được thiết lập sau khi kết nối
      this._setupSocketEventHandlers();
    } else {
      console.warn('StatusManager: No socket client available to connect');
    }
  }

  public get currentStatus(): Status {
    return this._currentStatus;
  }

  public get browserId(): string | undefined {
    return this._socketClient?.browserId;
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

        if (this._delegate?.statusChanged) {
          this._delegate.statusChanged(status, reason);
        }

        this._localBroadcaster.broadcastStatusChange(status, reason);

        this._socketClient?.emit(StatusEvent.REQUEST_STATUS_CHANGE, statusData, response => {
          if (response instanceof Error) {
            console.error(`Status change to ${status} rejected by server:`, response.message);
            resolve(false);
            return;
          }

          if (response?.success) {
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

    if (this._unsubscribeSocketEvents) {
      this._unsubscribeSocketEvents();
    }

    if (this._socketClient) {
      this._socketClient.disconnect();
    }

    this._localBroadcaster.close();
  }
}
