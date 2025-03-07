import { Invitation, Inviter, Session, URI, Web } from 'sip.js';
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

    // Không ghi đè onBye ở đây vì đã xử lý trong _bindSessionEvents
    this._bindSessionEvents();
  }

  private _bindSessionEvents() {
    this._session.stateChange.addListener((state: SessionState) => {
      try {
        switch (state) {
          case SessionState.Establishing:
            this._setupMedia();
            break;
          case SessionState.Established:
            this._status = 'CONNECTED';
            this._setupMedia();
            try {
              this._delegate?.callConnected?.();
            } catch (error) {
              console.error('Error in callConnected delegate:', error);
            }
            break;
          case SessionState.Terminated:
            this._status = 'TERMINATED';
            this._cleanupMedia();
            try {
              this._delegate?.callTerminated?.(200, 'Call ended');
            } catch (error) {
              console.error('Error in callTerminated delegate:', error);
            }
            break;
        }
      } catch (error) {
        console.error('Error handling session state change:', error);
        // Đảm bảo trạng thái TERMINATED được thiết lập nếu có lỗi
        if (state === SessionState.Terminated) {
          this._status = 'TERMINATED';
          this._cleanupMedia();
        }
      }
    });

    // Thêm xử lý sự kiện khi session bị hủy
    this._session.stateChange.addListener(newState => {
      if (newState === SessionState.Terminated) {
        console.log('Session terminated, ensuring dialog is marked as terminated');
        this._status = 'TERMINATED';
      }
    });

    // Thêm xử lý sự kiện onBye
    if (this._session.delegate) {
      const originalOnBye = this._session.delegate.onBye;
      this._session.delegate = {
        ...this._session.delegate,
        onBye: bye => {
          console.log('BYE received in Dialog - custom handler');
          this._status = 'TERMINATED';
          this._cleanupMedia();

          // Gọi handler gốc nếu có
          if (originalOnBye) {
            try {
              originalOnBye(bye);
            } catch (error) {
              console.error('Error in original onBye handler:', error);
            }
          }

          try {
            this._delegate?.callTerminated?.(200, 'Call ended by remote party');
          } catch (error) {
            console.error('Error in callTerminated delegate from onBye:', error);
          }
        },
      };
    }

    // Theo dõi ICE connection state
    const peerConnection = (this._session.sessionDescriptionHandler as any)?.peerConnection;
    if (peerConnection) {
      peerConnection.oniceconnectionstatechange = (event: Event) => {
        try {
          console.log('ICE connection state changed:', peerConnection.iceConnectionState);
          this._delegate?.rtc?.iceconnectionstatechange?.(event);

          // Xử lý lỗi kết nối ICE
          if (peerConnection.iceConnectionState === 'failed') {
            console.error('ICE connection failed');
            this._delegate?.rtc?.failed?.(new Error('ICE connection failed'));
          }
        } catch (error) {
          console.error('Error handling ICE connection state change:', error);
        }
      };
    }
  }

  private _setupMedia() {
    if (this._hasSetupMedia) return;

    try {
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
        try {
          if (e.track) {
            remoteStream.addTrack(e.track);

            if (!this._hasSetupMedia) {
              try {
                this._opts.media.withRemote(remoteStream).play();
                this._hasSetupMedia = true;
                console.log('Media setup on new track');
              } catch (error) {
                console.error('Failed to setup media:', error);
                try {
                  this._delegate?.rtc?.failed?.(error instanceof Error ? error : new Error(String(error)));
                } catch (delegateError) {
                  console.error('Error in rtc.failed delegate:', delegateError);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error handling ontrack event:', error);
        }
      };

      if (hasExistingTracks) {
        try {
          this._opts.media.withRemote(remoteStream).play();
          this._hasSetupMedia = true;
          console.log('Media setup with existing tracks');
        } catch (error) {
          console.error('Failed to setup media with existing tracks:', error);
          try {
            this._delegate?.rtc?.failed?.(error instanceof Error ? error : new Error(String(error)));
          } catch (delegateError) {
            console.error('Error in rtc.failed delegate:', delegateError);
          }
        }
      }
    } catch (error) {
      console.error('Error in _setupMedia:', error);
    }
  }

  private _cleanupMedia() {
    try {
      this._opts.media.closeRemote();
      this._hasSetupMedia = false;

      const peerConnection = (this._session.sessionDescriptionHandler as any)?.peerConnection;
      if (peerConnection) {
        peerConnection.ontrack = null;
      }

      console.log('Media cleaned up');
    } catch (error) {
      console.error('Error in _cleanupMedia:', error);
    }
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
      try {
        this._delegate?.rtc?.muted?.();
      } catch (error) {
        console.error('Error in rtc.muted delegate:', error);
      }

      console.log('Microphone muted');
    } catch (error) {
      console.error('Error muting microphone:', error);
      try {
        this._delegate?.rtc?.failed?.(error);
      } catch (delegateError) {
        console.error('Error in rtc.failed delegate:', delegateError);
      }
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
      try {
        this._delegate?.rtc?.unmuted?.();
      } catch (error) {
        console.error('Error in rtc.unmuted delegate:', error);
      }

      console.log('Microphone unmuted');
    } catch (error) {
      console.error('Error unmuting microphone:', error);
      try {
        this._delegate?.rtc?.failed?.(error);
      } catch (delegateError) {
        console.error('Error in rtc.failed delegate:', delegateError);
      }
    }
  }

  async handleHold(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      (session as Session).invite({ sessionDescriptionHandlerModifiers: [Web.holdModifier] });

      try {
        this._delegate?.rtc?.hold?.();
      } catch (error) {
        console.error('Error in rtc.hold delegate:', error);
      }

      console.log('Call placed on hold');
    } catch (error) {
      console.error('Error placing call on hold:', error);
      try {
        this._delegate?.rtc?.failed?.(error);
      } catch (delegateError) {
        console.error('Error in rtc.failed delegate:', delegateError);
      }
    }
  }

  async handleUnhold(): Promise<void> {
    try {
      const session = this._session;
      if (!session) return;

      (session as Session).invite({ sessionDescriptionHandlerModifiers: [] });

      try {
        this._delegate?.rtc?.unhold?.();
      } catch (error) {
        console.error('Error in rtc.unhold delegate:', error);
      }

      console.log('Call resumed from hold');
    } catch (error) {
      console.error('Error resuming call from hold:', error);
      try {
        this._delegate?.rtc?.failed?.(error);
      } catch (delegateError) {
        console.error('Error in rtc.failed delegate:', delegateError);
      }
    }
  }

  get actions(): CallActors {
    return {
      terminator: async () => {
        try {
          if (this._status === 'CREATED') {
            if (this._direction === CallDirection.Inbound && this._session instanceof Invitation) {
              await this._session.reject({ statusCode: 486 });
            } else if (this._direction === CallDirection.Outbound && this._session instanceof Inviter) {
              await this._session.cancel();
            }
          } else if (this._status === 'CONNECTED') {
            await this._session.bye();
          }
        } catch (error) {
          console.error('Error in terminator action:', error);
        } finally {
          // Đảm bảo trạng thái được cập nhật thành TERMINATED
          this._status = 'TERMINATED';
          this._cleanupMedia();
        }
      },
      answerer: async () => {
        try {
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
        } catch (error) {
          console.error('Error in answerer action:', error);
          // Đảm bảo trạng thái được cập nhật thành TERMINATED nếu có lỗi
          this._status = 'TERMINATED';
          this._cleanupMedia();
        }
      },
      referer: async (target: string) => {
        try {
          if (this._status !== 'CONNECTED' || !this._opts?.domain) return;

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
