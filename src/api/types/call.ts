import type { RTCSession, RTCSessionEventMap } from 'jssip/lib/RTCSession';
import { C } from 'jssip';

export type Terminator = (cause?: string) => void;
export type Answerer = () => void;
export type Referer = (target: string, opts?: any) => void;

export type CallActors = {
  terminator: Terminator;
  answerer: Answerer;
  referer: Referer;
};

export type CallCreatedListener = (actors: CallActors, params?: Record<string, unknown>) => void;
export type CallConnectedListener = () => void;
export type CallTerminatedListener = (code: number, cause?: string) => void;

export interface CallDelegate {
  callCreated?: CallCreatedListener;
  callConnected?: CallConnectedListener;
  callTerminated?: CallTerminatedListener;

  rtc?: RTCSessionEventMap;
}

export type CallOptions = {
  did?: string;
  delegate?: CallDelegate;
  extraVariables?: Record<string, string>;
};

export type DialogOptions = {
  domain: string;
  deviceId?: string;
  localMedia?: MediaStream;
  delegate?: CallDelegate;
};

export class Dialog {
  id: string;
  sipInbound: boolean;
  status: 'CREATED' | 'CONNECTED' | 'TERMINATED';
  delegate?: CallDelegate;
  session: RTCSession;
  remoteMedia: MediaStream;

  opts?: DialogOptions;
  actions: CallActors;

  constructor(session: RTCSession, sipInbound: boolean, opts?: DialogOptions) {
    this.id = '';
    this.status = 'CREATED';
    this.session = session;
    this.sipInbound = sipInbound;
    this.opts = opts;
    this.delegate = opts?.delegate;
    this.remoteMedia = new MediaStream();

    this.actions = {
      terminator: (cause?: string) => {
        if (this.status === 'CREATED') {
          return this.session.terminate(
            this.sipInbound
              ? { cause: C.causes.REJECTED, status_code: 486 }
              : { cause: C.causes.CANCELED, status_code: 487 },
          );
        } else if (this.status === 'CONNECTED') {
          return this.session.terminate({ cause: C.causes.BYE, status_code: 200, reason_phrase: cause });
        }
      },
      answerer: () => {
        const callOpts: any = { rtcAnswerConstraints: { offerToReceiveAudio: true, offerToReceiveVideo: false } };
        if (this.opts?.localMedia) {
          callOpts.mediaStream = this.opts?.localMedia;
        } else {
          callOpts.mediaConstraints = {
            audio: this.opts?.deviceId?.length ? { deviceId: this.opts?.deviceId } : true,
            video: false,
          };
        }

        return this.sipInbound ? this.session.answer(callOpts) : undefined;
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      referer: (target: string, _opts?: any) => {
        if ('CONNECTED' !== this.status) return undefined;

        return new Promise(resolve => {
          this.session.refer(target, {
            eventHandlers: {
              requestSucceeded: () => resolve({ success: true }),
              requestFailed: (cause: any) => resolve({ success: false, error: `Failed to transfer call: ${cause}` }),
            },
          });
        });
      },
    };
  }

  isTerminated(): boolean {
    return 'TERMINATED' === this.status?.toUpperCase();
  }

  remoteStream(): MediaStream {
    if (this.remoteMedia?.getTracks()?.length) return this.remoteMedia;

    this.session?.connection?.getReceivers()?.forEach(receiver => {
      if (receiver.track) this.remoteMedia.addTrack(receiver.track);
    });

    this.session.once('ended', () => this._closeRemoteStream.bind(this));
    this.session.once('failed', () => this._closeRemoteStream.bind(this));

    return this.remoteMedia;
  }

  private _closeRemoteStream() {
    this.remoteMedia.getTracks()?.forEach(track => {
      track.stop();
      this.remoteMedia.removeTrack(track);
    });
  }
}
