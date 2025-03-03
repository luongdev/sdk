import { Invitation, Inviter, UserAgent, URI } from 'sip.js';
import type { CallDelegate } from '../types/call';
import { CallDirection } from '../types/call';
import { Media } from '../media';
import { Dialog, type DialogOptions } from './dialog';

export class CallHandler {
  private _currentDialog?: Dialog;
  private _delegate?: CallDelegate;
  private _userAgent?: UserAgent;
  private readonly _media: Media;
  private readonly _domain: string;

  constructor(media: Media, domain: string) {
    this._media = media;
    this._domain = domain;
  }

  setUserAgent(userAgent: UserAgent) {
    this._userAgent = userAgent;
  }

  setDelegate(delegate?: CallDelegate) {
    this._delegate = delegate;
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
          // Tự động xóa dialog khi cuộc gọi kết thúc
          this.clearCurrentDialog();
          // Chuyển tiếp sự kiện cho delegate gốc
          this._delegate?.callTerminated?.(code, cause);
        },
      },
    };

    const dialog = new Dialog(invitation, CallDirection.Inbound, options);
    this._currentDialog = dialog;
    this._delegate?.callCreated?.(dialog.actions);
  }

  async makeCall(target: string): Promise<void> {
    if (!this._userAgent) {
      throw new Error('UserAgent not set');
    }

    if (this._currentDialog) {
      throw new Error('Call in progress');
    }

    const targetUri = new URI('sip', target, this._domain);
    const inviterOptions: any = {
      sessionDescriptionHandlerOptions: {},
    };

    const localStream = this._media.local;
    if (localStream) {
      inviterOptions.sessionDescriptionHandlerOptions.tracks = localStream.getTracks();
    } else {
      inviterOptions.sessionDescriptionHandlerOptions.constraints = {
        audio: true,
        video: false,
      };
    }

    const inviter = new Inviter(this._userAgent, targetUri, inviterOptions);

    const options: DialogOptions = {
      domain: this._domain,
      media: this._media,
      delegate: {
        ...this._delegate,
        callTerminated: (code, cause) => {
          this.clearCurrentDialog();
          this._delegate?.callTerminated?.(code, cause);
        },
      },
    };

    const dialog = new Dialog(inviter, CallDirection.Outbound, options);
    this._currentDialog = dialog;
    this._delegate?.callCreated?.(dialog.actions);

    try {
      await inviter.invite();
    } catch (error) {
      this._currentDialog = undefined;
      throw error;
    }
  }

  clearCurrentDialog() {
    if (this._currentDialog?.isTerminated()) {
      this._currentDialog = undefined;
      console.log('Current dialog cleared');
    }
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

  resetState() {
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
}
