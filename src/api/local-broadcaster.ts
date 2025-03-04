import { StatusEvent } from '@api/types/status.ts';
import { v7 as uuidv7 } from 'uuid';

/**
 * Định nghĩa cấu trúc dữ liệu cho thông điệp trạng thái
 */
export interface StatusMessage {
  type: string;
  status: string;
  reason?: string;
  timestamp: number;
  source: string;
}

/**
 * LocalBroadcaster sử dụng BroadcastChannel để thông báo thay đổi trạng thái
 * giữa các tab trong cùng một trình duyệt mà không cần qua server
 */
export class LocalBroadcaster {
  private readonly _channel: BroadcastChannel;
  private readonly _instanceId: string;
  private readonly _listeners: Map<string, Set<(message: StatusMessage) => void>> = new Map();

  /**
   * Khởi tạo LocalBroadcaster
   * @param channelName Tên kênh broadcast, mặc định là 'voip-sdk-status'
   */
  constructor(channelName: string = 'voip-sdk-status') {
    // Tạo ID duy nhất cho instance này để phân biệt giữa các tab sử dụng uuid v7
    this._instanceId = uuidv7();

    // Khởi tạo BroadcastChannel
    this._channel = new BroadcastChannel(channelName);

    // Thiết lập xử lý sự kiện nhận thông điệp
    this._channel.onmessage = this._handleMessage.bind(this);

    console.log(`LocalBroadcaster initialized with ID: ${this._instanceId}`);
  }

  /**
   * Xử lý thông điệp nhận được từ BroadcastChannel
   * @param event Sự kiện message
   */
  private _handleMessage(event: MessageEvent<StatusMessage>): void {
    const message = event.data;

    // Bỏ qua thông điệp từ chính instance này
    if (message.source === this._instanceId) {
      console.log('Ignoring message from self');
      return;
    }

    console.log(`Received message from ${message.source}:`, message);

    // Gọi các listener đã đăng ký cho loại thông điệp này
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

  /**
   * Đăng ký listener cho một loại thông điệp cụ thể
   * @param type Loại thông điệp
   * @param listener Hàm xử lý khi nhận được thông điệp
   * @returns Hàm để hủy đăng ký listener
   */
  public subscribe(type: string, listener: (message: StatusMessage) => void): () => void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }

    const listeners = this._listeners.get(type)!;
    listeners.add(listener);

    console.log(`Subscribed to ${type} events`);

    // Trả về hàm để hủy đăng ký
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

  /**
   * Phát thông điệp thay đổi trạng thái đến tất cả các tab khác
   * @param status Trạng thái mới
   * @param reason Lý do thay đổi trạng thái (tùy chọn)
   */
  public broadcastStatusChange(status: string, reason?: string): void {
    const message: StatusMessage = {
      type: StatusEvent.STATUS_CHANGED,
      status,
      reason,
      timestamp: Date.now(),
      source: this._instanceId,
    };

    console.log('Broadcasting status change:', message);
    this._channel.postMessage(message);
  }

  /**
   * Đóng kênh broadcast khi không cần thiết nữa
   */
  public close(): void {
    this._channel.close();
    this._listeners.clear();
    console.log('LocalBroadcaster closed');
  }
}
