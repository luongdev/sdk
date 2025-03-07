import { Invitation, Inviter, URI, Web } from 'sip.js';
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

    // Theo dõi ICE connection state
    const peerConnection = (this._session.sessionDescriptionHandler as any)?.peerConnection;
    if (peerConnection) {
      peerConnection.oniceconnectionstatechange = (event: Event) => {
        console.log('ICE connection state changed:', peerConnection.iceConnectionState);
        this._delegate?.rtc?.iceconnectionstatechange?.(event);

        // Xử lý lỗi kết nối ICE
        if (peerConnection.iceConnectionState === 'failed') {
          console.error('ICE connection failed');
          this._delegate?.rtc?.failed?.(new Error('ICE connection failed'));
        }
      };
    }
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
          try {
            this._opts.media.withRemote(remoteStream).play();
            this._hasSetupMedia = true;
            console.log('Media setup on new track');
          } catch (error) {
            console.error('Failed to setup media:', error);
            this._delegate?.rtc?.failed?.(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
    };

    if (hasExistingTracks) {
      try {
        this._opts.media.withRemote(remoteStream).play();
        this._hasSetupMedia = true;
        console.log('Media setup with existing tracks');
      } catch (error) {
        console.error('Failed to setup media with existing tracks:', error);
        this._delegate?.rtc?.failed?.(error instanceof Error ? error : new Error(String(error)));
      }
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

  async handleMute(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      const peerConnection = (session.sessionDescriptionHandler as any)?.peerConnection;
      if (!peerConnection) return;

      const senders = peerConnection.getSenders();
      if (!senders.length) return;

      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = false;
        }
      });

      // Gọi sự kiện muted
      this._delegate?.rtc?.muted?.();

      console.log('Microphone muted');
    } catch (error) {
      console.error('Error muting microphone:', error);
      this._delegate?.rtc?.failed?.(error);
    }
  }

  async handleUnmute(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      const peerConnection = (session.sessionDescriptionHandler as any)?.peerConnection;
      if (!peerConnection) return;

      const senders = peerConnection.getSenders();
      if (!senders.length) return;

      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = true;
        }
      });

      // Gọi sự kiện unmuted
      this._delegate?.rtc?.unmuted?.();

      console.log('Microphone unmuted');
    } catch (error) {
      console.error('Error unmuting microphone:', error);
      this._delegate?.rtc?.failed?.(error);
    }
  }

  async handleHold(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      const peerConnection = (session.sessionDescriptionHandler as any)?.peerConnection;
      peerConnection?.getSenders()?.forEach((sender: RTCRtpSender) => {
        if (sender.track) sender.track.enabled = false;
      });

      console.log('Senders:', peerConnection?.getSenders());
      peerConnection?.getReceivers()?.forEach((receiver: RTCRtpReceiver) => {
        if (receiver.track) receiver.track.enabled = false;
      });

      // Gọi sự kiện hold
      this._delegate?.rtc?.hold?.();

      console.log('Call placed on hold');
    } catch (error) {
      console.error('Error placing call on hold:', error);
      this._delegate?.rtc?.failed?.(error);
    }
  }

  async handleUnhold(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      const peerConnection = (session.sessionDescriptionHandler as any)?.peerConnection;
      peerConnection?.getSenders()?.forEach((sender: RTCRtpSender) => {
        if (sender.track) {
          sender.track.enabled = true;
        }
      });
      peerConnection?.getReceivers()?.forEach((receiver: RTCRtpReceiver) => {
        if (receiver.track) {
          receiver.track.enabled = true;
        }
      });

      // Gọi sự kiện unhold
      this._delegate?.rtc?.unhold?.();

      console.log('Call resumed from hold');
    } catch (error) {
      console.error('Error resuming call from hold:', error);
      this._delegate?.rtc?.failed?.(error);
    }
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
          options.sessionDescriptionHandlerOptions.tracks = localStream
            .getTracks()
            .filter(track => track.kind === 'audio');
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
