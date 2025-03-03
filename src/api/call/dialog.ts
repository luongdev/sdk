import { Invitation, Inviter, URI } from 'sip.js';
import { SessionState } from 'sip.js/lib/api/session-state';
import { CallDirection, type CallDelegate, type CallActors } from '../types/call';
import { Media } from '../media';

export interface DialogOptions {
  domain: string;
  deviceId?: string;
  media: Media;
  delegate?: CallDelegate;
}

export class Dialog {
  private _direction: CallDirection;
  private _status: 'CREATED' | 'CONNECTED' | 'TERMINATED';
  private _delegate?: CallDelegate;
  private _session: Invitation | Inviter;
  private _opts: DialogOptions;
  private _hasSetupMedia = false;

  constructor(session: Invitation | Inviter, direction: CallDirection, opts: DialogOptions) {
    this._status = 'CREATED';
    this._session = session;
    this._direction = direction;
    this._opts = opts;
    this._delegate = opts.delegate;

    this._session.delegate = {
      ...this._session.delegate,
      onBye: () => {
        console.log('BYE received in Dialog');
        this._status = 'TERMINATED';
        this._cleanupMedia();
        this._delegate?.callTerminated?.(200, 'Call ended by remote party');
      },
    };

    this._bindSessionEvents();
  }

  private _bindSessionEvents() {
    this._session.stateChange.addListener((state: SessionState) => {
      switch (state) {
        case SessionState.Establishing:
          this._setupMedia();
          break;
        case SessionState.Established:
          this._status = 'CONNECTED';
          this._setupMedia();
          this._delegate?.callConnected?.();
          break;
        case SessionState.Terminated:
          this._status = 'TERMINATED';
          this._cleanupMedia();
          this._delegate?.callTerminated?.(200, 'Call ended');
          break;
      }
    });
  }

  private _setupMedia() {
    if (this._hasSetupMedia) return;

    const peerConnection = (this._session.sessionDescriptionHandler as any)?.peerConnection;
    if (!peerConnection) return;

    const remoteStream = new MediaStream();

    const existingReceivers = peerConnection.getReceivers();
    let hasExistingTracks = false;

    existingReceivers.forEach((receiver: RTCRtpReceiver) => {
      if (receiver.track) {
        remoteStream.addTrack(receiver.track);
        hasExistingTracks = true;
      }
    });

    peerConnection.ontrack = (e: RTCTrackEvent) => {
      if (e.track) {
        remoteStream.addTrack(e.track);

        if (!this._hasSetupMedia) {
          this._opts.media.withRemote(remoteStream).play();
          this._hasSetupMedia = true;
          console.log('Media setup on new track');
        }
      }
    };

    if (hasExistingTracks) {
      this._opts.media.withRemote(remoteStream).play();
      this._hasSetupMedia = true;
      console.log('Media setup with existing tracks');
    }
  }

  private _cleanupMedia() {
    this._opts.media.closeRemote();
    this._hasSetupMedia = false;

    const peerConnection = (this._session.sessionDescriptionHandler as any)?.peerConnection;
    if (peerConnection) {
      peerConnection.ontrack = null;
    }

    console.log('Media cleaned up');
  }

  get actions(): CallActors {
    return {
      terminator: async () => {
        if (this._status === 'CREATED') {
          if (this._direction === CallDirection.Inbound && this._session instanceof Invitation) {
            await this._session.reject({ statusCode: 486 });
          } else if (this._direction === CallDirection.Outbound && this._session instanceof Inviter) {
            await this._session.cancel();
          }
        } else if (this._status === 'CONNECTED') {
          await this._session.bye();
        }
      },
      answerer: async () => {
        if (this._direction !== CallDirection.Inbound || !(this._session instanceof Invitation)) {
          return;
        }

        const options: any = {
          sessionDescriptionHandlerOptions: {},
        };

        const localStream = this._opts.media.local;
        if (localStream) {
          options.sessionDescriptionHandlerOptions.tracks = localStream.getTracks();
        } else {
          options.sessionDescriptionHandlerOptions.constraints = {
            audio: true,
            video: false,
          };
        }

        await this._session.accept(options);
      },
      referer: async (target: string) => {
        if (this._status !== 'CONNECTED' || !this._opts?.domain) return;

        try {
          const targetUri = new URI('sip', target, this._opts.domain);
          await this._session.refer(targetUri);
        } catch (error) {
          console.error(`Failed to transfer call: ${error}`);
        }
      },
    };
  }

  isTerminated(): boolean {
    return this._status === 'TERMINATED';
  }
}
