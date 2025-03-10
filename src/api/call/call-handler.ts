import { Invitation, Inviter, type InviterInviteOptions } from 'sip.js';
import type { CallDelegate, CallOptions } from '../types/call';
import { CallDirection } from '../types/call';
import { Media } from '../media';
import { Dialog, type DialogOptions } from './dialog';
import type { SipProvider, CallSessionObserver } from '../types/sip';
import { createSafeCallDelegate } from '../utils/safe-delegate';

export class CallHandler implements CallSessionObserver {
  private _currentDialog?: Dialog;
  private _delegate?: CallDelegate;
  private readonly _media: Media;
  private readonly _domain: string;
  private readonly _sipProvider: SipProvider;

  constructor(media: Media, domain: string, sipProvider: SipProvider) {
    this._media = media;
    this._domain = domain;
    this._sipProvider = sipProvider;

    this._sipProvider.addCallSessionObserver(this);
  }

  setDelegate(delegate?: CallDelegate) {
    // Bảo vệ delegate bằng cách bọc nó trong một wrapper an toàn
    this._delegate = delegate ? createSafeCallDelegate(delegate) : undefined;
    console.log('Set delegate with safe wrapper');
  }

  handleIncomingCall(invitation: Invitation): void {
    this.handleIncoming(invitation);
  }

  handleOutgoingCall(inviter: Inviter, params?: Record<string, string>, delegate?: CallDelegate): void {
    this.handleOutgoing(inviter, params, delegate);
  }

  handleIncoming(invitation: Invitation): void {
    if (this._currentDialog) {
      invitation.reject({ statusCode: 486 });
      return;
    }

    const options: DialogOptions = {
      domain: this._domain,
      media: this._media,
      delegate: {
        ...this._delegate,
        callTerminated: (code, cause) => {
          try {
            // Gọi callTerminated của delegate gốc nếu có
            this._delegate?.callTerminated?.(code, cause);
          } catch (error) {
            console.error('Error in callTerminated delegate:', error);
          } finally {
            // Luôn gọi clearCurrentDialog để dọn dẹp
            this.clearCurrentDialog();
          }
        },
      },
    };

    const dialog = new Dialog(invitation, CallDirection.Inbound, options);
    this._currentDialog = dialog;

    // Tạo thông tin về cuộc gọi đến
    const callInfo = this._extractCallInfo(invitation);
    const callParams = {
      // Nếu không có direction trong callInfo, sử dụng giá trị mặc định
      direction: callInfo.direction || CallDirection.Inbound,
      incoming: true,
      ...callInfo,
    };

    // Gọi delegate với thông tin cuộc gọi trong try-catch
    try {
      this._delegate?.callCreated?.(dialog.actions, callParams);
    } catch (error) {
      console.error('Error in callCreated delegate for incoming call:', error);
    }
  }

  handleOutgoing(inviter: Inviter, params?: Record<string, string>, delegate?: CallDelegate): void {
    if (this._currentDialog) {
      console.warn('Call in progress, cannot handle outgoing call');
      return;
    }

    const inviteOptions = this._buildInviteOptions();
    const dialogOptions: DialogOptions = {
      domain: this._domain,
      media: this._media,
      delegate: {
        ...(delegate ? createSafeCallDelegate(delegate) : this._delegate),
        callTerminated: (code, cause) => {
          try {
            // Gọi callTerminated của delegate thích hợp
            if (delegate) {
              delegate.callTerminated?.(code, cause);
            } else {
              this._delegate?.callTerminated?.(code, cause);
            }
          } catch (error) {
            console.error('Error in callTerminated delegate:', error);
          } finally {
            // Luôn gọi clearCurrentDialog để dọn dẹp
            this.clearCurrentDialog();
          }
        },
      },
    };

    const dialog = new Dialog(inviter, CallDirection.Outbound, dialogOptions);
    this._currentDialog = dialog;

    // Tạo thông tin về cuộc gọi đi
    const callInfo = this._extractCallInfo(inviter);
    const callParams = {
      direction: callInfo.direction || CallDirection.Outbound,
      incoming: false,
      ...callInfo,
      ...params,
    };

    // Gọi delegate với thông tin cuộc gọi trong try-catch
    try {
      if (delegate?.callCreated) {
        delegate.callCreated(dialog.actions, callParams);
      } else {
        this._delegate?.callCreated?.(dialog.actions, callParams);
      }
    } catch (error) {
      console.error('Error in callCreated delegate for outgoing call:', error);
    }

    // Tiếp tục với invite
    inviter.invite(inviteOptions).catch(error => {
      console.error('Error starting outgoing call:', error);
      this._currentDialog = undefined;
    });
  }

  private _buildInviteOptions(): InviterInviteOptions {
    const options: any = {
      sessionDescriptionHandlerOptions: {},
    };

    if (this._media.local) {
      options.sessionDescriptionHandlerOptions.tracks = this._media.local
        .getTracks()
        .filter(track => track.kind === 'audio');
    } else {
      options.sessionDescriptionHandlerOptions.constraints = {
        audio: true,
        video: false,
      };
    }
    return options;
  }

  async makeCall(target: string, options?: CallOptions): Promise<void> {
    if (!this._sipProvider.isReady()) {
      throw new Error('SIP connection not ready');
    }

    if (this._currentDialog) {
      throw new Error('Call in progress');
    }

    try {
      // Tạo cuộc gọi với options
      this._sipProvider.createOutgoingCall(target, options);
    } catch (error) {
      console.error('Error creating outgoing call:', error);
      throw error;
    }
  }

  clearCurrentDialog() {
    // Xóa dialog hiện tại bất kể trạng thái
    this._currentDialog = undefined;
    console.log('Current dialog cleared');
  }

  async endCurrentCall(): Promise<boolean> {
    if (!this._currentDialog) {
      return false;
    }

    try {
      await this._currentDialog.actions.terminator();
      return true;
    } catch (error) {
      console.error('Error ending call:', error);
      this._currentDialog = undefined;
      return false;
    }
  }

  async muteCall(): Promise<boolean> {
    if (!this._currentDialog || this._currentDialog.isTerminated()) {
      console.warn('No active call to mute');
      return false;
    }

    try {
      await this._currentDialog.handleMute();
      return true;
    } catch (error) {
      console.error('Error muting call:', error);
      return false;
    }
  }

  async unmuteCall(): Promise<boolean> {
    if (!this._currentDialog || this._currentDialog.isTerminated()) {
      console.warn('No active call to unmute');
      return false;
    }

    try {
      await this._currentDialog.handleUnmute();
      return true;
    } catch (error) {
      console.error('Error unmuting call:', error);
      return false;
    }
  }

  async holdCall(): Promise<boolean> {
    if (!this._currentDialog || this._currentDialog.isTerminated()) {
      console.warn('No active call to hold');
      return false;
    }

    try {
      await this._currentDialog.handleHold();
      return true;
    } catch (error) {
      console.error('Error holding call:', error);
      return false;
    }
  }

  async unholdCall(): Promise<boolean> {
    if (!this._currentDialog || this._currentDialog.isTerminated()) {
      console.warn('No active call to unhold');
      return false;
    }

    try {
      await this._currentDialog.handleUnhold();
      return true;
    } catch (error) {
      console.error('Error unholding call:', error);
      return false;
    }
  }

  async transferCall(target: string): Promise<boolean> {
    if (!this._currentDialog || this._currentDialog.isTerminated()) {
      console.warn('No active call to transfer');
      return false;
    }

    try {
      await this._currentDialog.actions.referer(target);
      return true;
    } catch (error) {
      console.error('Error transferring call:', error);
      return false;
    }
  }

  resetState(): void {
    if (this._currentDialog) {
      this.endCurrentCall().catch(console.error);
    }

    this._currentDialog = undefined;
    this._media.reset();
    console.log('Call handler state reset');
  }

  get hasActiveCall(): boolean {
    return !!this._currentDialog && !this._currentDialog.isTerminated();
  }

  // Phương thức trích xuất thông tin cuộc gọi từ session (invitation hoặc inviter)
  private _extractCallInfo(session: Invitation | Inviter): Record<string, any> {
    try {
      const result: Record<string, any> = {
        timestamp: Date.now(),
      };

      // Lấy thông tin từ request
      if (session.request) {
        const request = session.request;

        // Lấy caller (from)
        if (request.from && request.from.uri) {
          result.caller = request.from.uri.user || 'Unknown';
          result.callerDisplayName = request.from.displayName || '';
          result.callerUri = request.from.uri.toString();
        }

        // Lấy callee (to)
        if (request.to && request.to.uri) {
          result.callee = request.to.uri.user || 'Unknown';
          result.calleeDisplayName = request.to.displayName || '';
          result.calleeUri = request.to.uri.toString();
        }

        // Lấy các header bắt đầu bằng X-
        const headers = request.headers;
        if (headers) {
          Object.keys(headers).forEach(headerName => {
            if (headerName.startsWith('X-')) {
              // Bỏ 'X-' và thêm vào params
              const paramName = headerName.substring(2).toLowerCase();
              const headerValue = headers[headerName];
              if (Array.isArray(headerValue) && headerValue.length > 0) {
                result[paramName] = headerValue[0];
              } else if (typeof headerValue === 'string') {
                result[paramName] = headerValue;
              }
            }
          });

          // Kiểm tra header X-Direction hoặc X-Call-Direction
          if (headers['X-Direction'] && Array.isArray(headers['X-Direction']) && headers['X-Direction'].length > 0) {
            result.direction = headers['X-Direction'][0];
          } else if (
            headers['X-Call-Direction'] &&
            Array.isArray(headers['X-Call-Direction']) &&
            headers['X-Call-Direction'].length > 0
          ) {
            result.direction = headers['X-Call-Direction'][0];
          }
        }

        // Lấy Call-ID
        if (request.callId) {
          result.callId = request.callId;
        }
      }

      // Lấy thông tin từ các thuộc tính khác của session
      if (session instanceof Invitation) {
        result.from = this._extractCallerInfo(session);

        // Thêm thông tin về session
        if ((session as any).remoteIdentity) {
          const remoteIdentity = (session as any).remoteIdentity;
          if (remoteIdentity.displayName) {
            result.remoteDisplayName = remoteIdentity.displayName;
          }
        }

        // Nếu chưa có direction, đặt là inbound
        if (!result.direction) {
          result.direction = CallDirection.Inbound;
        }
      } else {
        result.to = this._extractTargetInfo(session);

        // Nếu chưa có direction, đặt là outbound
        if (!result.direction) {
          result.direction = CallDirection.Outbound;
        }
      }

      return result;
    } catch (error) {
      console.error('Error extracting call info:', error);
      return {
        caller: 'Unknown',
        callee: 'Unknown',
        timestamp: Date.now(),
      };
    }
  }

  // Phương thức trích xuất thông tin người gọi từ invitation
  private _extractCallerInfo(invitation: Invitation): string {
    try {
      // Sử dụng các thuộc tính public của Invitation
      if (invitation.request && invitation.request.from) {
        const fromUri = invitation.request.from.uri;
        if (fromUri && typeof fromUri.user === 'string') {
          return fromUri.user;
        }
      }

      // Thử lấy từ các thuộc tính khác
      const remoteIdentity = (invitation as any).remoteIdentity;
      if (remoteIdentity && remoteIdentity.uri && remoteIdentity.uri.user) {
        return remoteIdentity.uri.user;
      }

      return 'Unknown Caller';
    } catch (error) {
      console.error('Error extracting caller info:', error);
      return 'Unknown Caller';
    }
  }

  // Phương thức trích xuất thông tin người nhận từ inviter
  private _extractTargetInfo(inviter: Inviter): string {
    try {
      // Sử dụng các thuộc tính public của Inviter
      if (inviter.request && inviter.request.to) {
        const toUri = inviter.request.to.uri;
        if (toUri && typeof toUri.user === 'string') {
          return toUri.user;
        }
      }

      // Thử lấy từ các thuộc tính khác
      const requestURI = (inviter as any).requestURI;
      if (requestURI && requestURI.user) {
        return requestURI.user;
      }

      // Nếu không thể trích xuất, trả về giá trị mặc định
      return 'Unknown Target';
    } catch (error) {
      console.error('Error extracting target info:', error);
      return 'Unknown Target';
    }
  }
}
