import { Invitation, Inviter } from 'sip.js';
import type { CallDelegate } from '../types/call';
import { CallDirection } from '../types/call';
import { Media } from '../media';
import { Dialog, type DialogOptions } from './dialog';
import type { SipProvider, CallSessionObserver } from '../types/sip';

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
    this._delegate = delegate;
  }

  handleIncomingCall(invitation: Invitation): void {
    this.handleIncoming(invitation);
  }

  handleOutgoingCall(inviter: Inviter): void {
    this.handleOutgoing(inviter);
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
          this.clearCurrentDialog();
          this._delegate?.callTerminated?.(code, cause);
        },
      },
    };

    const dialog = new Dialog(invitation, CallDirection.Inbound, options);
    this._currentDialog = dialog;
    this._delegate?.callCreated?.(dialog.actions);
  }

  handleOutgoing(inviter: Inviter): void {
    if (this._currentDialog) {
      console.warn('Call in progress, cannot handle outgoing call');
      return;
    }

    const options: any = {
      sessionDescriptionHandlerOptions: {},
    };

    if (this._media.local) {
      options.sessionDescriptionHandlerOptions.tracks = this._media.local.getTracks();
    } else {
      options.sessionDescriptionHandlerOptions.constraints = {
        audio: true,
        video: false,
      };
    }

    const dialogOptions: DialogOptions = {
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

    const dialog = new Dialog(inviter, CallDirection.Outbound, dialogOptions);
    this._currentDialog = dialog;
    this._delegate?.callCreated?.(dialog.actions);

    inviter.invite(options).catch(error => {
      console.error('Error starting outgoing call:', error);
      this._currentDialog = undefined;
    });
  }

  async makeCall(target: string): Promise<void> {
    if (!this._sipProvider.isReady()) {
      throw new Error('SIP connection not ready');
    }

    if (this._currentDialog) {
      throw new Error('Call in progress');
    }

    try {
      this._sipProvider.createOutgoingCall(target);
    } catch (error) {
      console.error('Error creating outgoing call:', error);
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
