import type { Config, User } from '@api/types/types.ts';
import type { ConnectOptions } from '@api/types/connections.ts';
import { UA, URI, Utils, WebSocketInterface } from 'jssip';
import type { CallDelegate, CallOptions } from '@api/types/call.ts';
import type {
  EndEvent,
  IncomingAckEvent,
  IncomingEvent,
  OutgoingAckEvent,
  OutgoingEvent,
  RTCSession,
} from 'jssip/lib/RTCSession';

class Dialog {
  status: 'CREATED' | 'CONNECTED' | 'TERMINATED';
  delegate?: CallDelegate;
  session: RTCSession;
  remoteMedia: MediaStream;

  constructor(session: RTCSession, delegate?: CallDelegate) {
    this.session = session;
    this.delegate = delegate;
    this.status = 'CREATED';
    this.remoteMedia = new MediaStream();
  }

  remoteStream(): MediaStream {
    this.session?.connection?.getReceivers()?.forEach(receiver => {
      if (receiver.track) this.remoteMedia.addTrack(receiver.track);
    });

    return this.remoteMedia;
  }

  toggleMute() {
    if (this.session.isMuted()) {
      this.session.unmute();
    } else {
      this.session.mute();
    }
  }

  toggleHold() {
    if (this.session.isOnHold()) {
      this.session.unhold();
    } else {
      this.session.hold();
    }
  }
}

export default class VoiceSDK {
  private static _instance: VoiceSDK;

  private readonly _config: Config;

  private readonly _uaGateways: string[];
  private _ua?: UA;

  private readonly _timeout = 10000;

  private _dialog?: Dialog;
  private _localMedia?: MediaStream;
  private readonly _audio: HTMLAudioElement;

  get isConnected(): boolean {
    return !!this._ua?.isConnected();
  }

  get isRegistered(): boolean {
    return !!this._ua?.isRegistered();
  }

  private constructor(cfg: Config) {
    this._config = cfg;

    const { baseUrl, gateways } = cfg || {};

    if (!baseUrl) {
      this._config.baseUrl = 'https://connect.omicx.vn';
    }

    this._uaGateways = gateways.filter(g => g.startsWith('wss://') || g.startsWith('ws://')) ?? [];
    if (!this._uaGateways.length) {
      throw new Error('Missing required gateways');
    }

    this._audio = new Audio();
  }

  public static async init(cfg: Config, cb?: (instance: VoiceSDK) => void) {
    if (VoiceSDK._instance) return;

    const instance = new VoiceSDK(cfg);
    instance._localMedia = await navigator.mediaDevices.getUserMedia({
      video: false,
      preferCurrentTab: true,
      audio: cfg.deviceId?.length ? { deviceId: cfg.deviceId } : true,
    });

    VoiceSDK._instance = instance;
    if (cb) {
      await Promise.resolve().then(() => cb(instance));
    }
  }

  private async _connect(user: User, opts?: ConnectOptions): Promise<boolean> {
    if (!this._config) {
      throw new Error('Missing required configuration');
    }
    if (this.isConnected) return this.isConnected;

    this._config.delegate = this._config.delegate || {};
    if (opts?.delegate?.onConnect) {
      this._config.delegate.onConnect = opts.delegate.onConnect;
    }
    if (opts?.delegate?.onDisconnect) {
      this._config.delegate.onDisconnect = opts.delegate.onDisconnect;
    }

    this._ua = await this._setup(user);
    if (!this._ua) {
      throw new Error(`Failed to setup VoiceSDK`);
    }

    return this.isConnected;
  }

  public async login(user: User) {
    const connected = await this._connect(user);
    if (!connected) throw new Error('Failed to connect to gateway(s)');

    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Register timeout'));
      }, this._timeout);

      this._ua?.on('registered', () => {
        clearTimeout(timeout);
        resolve(true);
      });

      this._ua?.on('registrationFailed', () => {
        reject(new Error('Register failed'));
      });

      this._ua?.register();
    });
  }

  public disconnect() {
    if (!this._ua || !this.isConnected) return;

    if (this._dialog?.session) {
      this._dialog.session.terminate();
    }

    this._ua.unregister();
    this._ua.stop();
  }

  public async makeCall(dest: string, opts?: CallOptions): Promise<{ id: string; hangup: (cause?: string) => void }> {
    if (!this._ua || !this.isConnected || !this.isRegistered) {
      throw new Error('SDK not ready for make call');
    }

    const targetUri = new URI('sip', dest, this._config.appName);

    const extraHeaders: string[] = [];
    if (opts?.did?.length) extraHeaders.push(`X-Dialed-Number: ${opts.did}`);

    if (opts?.extraVariables) {
      Object.entries(opts.extraVariables).forEach(([key, value]) => {
        if (!key?.length || !value?.length) return;

        const header = `X-${key}: ${value}`;
        if (header.length > 50) {
          console.warn(`Header ${key} is too long, max length is 50 characters`);
        }

        extraHeaders.push(header);
      });
    }

    const callOpts: any = {
      extraHeaders,
      sessionTimersExpires: 120,
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      },
    };
    if (this._localMedia) {
      callOpts.mediaStream = this._localMedia;
    } else {
      callOpts.mediaConstraints = {
        audio: this._config.deviceId?.length ? { deviceId: this._config.deviceId } : true,
        video: false,
      };
    }

    const globalCallId = Utils.newUUID();
    this._ua.once('newRTCSession', e => {
      const { session, request, originator } = e;

      this._dialog = new Dialog(session, opts?.delegate ?? this._config.delegate);
      const isOutbound = originator === 'local';
      if (isOutbound) {
        (request as any).setHeader('call-id', globalCallId);
      }

      if (opts?.delegate?.rtc) {
        Object.entries(opts.delegate.rtc).forEach(([event, handler]) => session.once(event, handler));
      }

      this._dialog.delegate?.callCreated?.(request.from?.uri?.user, request.to?.uri?.user, {
        id: globalCallId,
        direction: isOutbound ? 'outbound' : 'inbound',
      });
    });

    const s = this._ua.call(targetUri.toString(), { ...callOpts });

    return {
      id: globalCallId,
      hangup: (cause?: string) => s.terminate({ cause }),
    };
  }

  public mute() {
    if (!this._dialog?.session) return;

    const { audio } = this._dialog.session.isMuted();
    if (!audio) {
      return this._dialog?.session.mute();
    }
  }

  public unmute() {
    if (!this._dialog?.session) return;

    const { audio } = this._dialog.session.isMuted();
    if (audio) {
      return this._dialog?.session.unmute();
    }
  }

  public hold() {
    if (!this._dialog?.session) return;

    const { local } = this._dialog.session.isOnHold();
    if (!local) {
      return this._dialog?.session.hold();
    }
  }

  public unhold() {
    if (!this._dialog?.session) return;

    const { local } = this._dialog.session.isOnHold();
    if (local) {
      return this._dialog?.session.unhold();
    }
  }

  private async _setup(user: User): Promise<UA> {
    const uriStr = new URI('sip', user.extension, this._config.appName, undefined, { transport: 'ws' }).toString();
    const ua = new UA({
      sockets: this._uaGateways.map(g => new WebSocketInterface(g)),
      uri: uriStr,
      contact_uri: uriStr,
      display_name: user.username,
      password: user.password,
      user_agent: 'Voice-SDK',
      register: false,
      register_expires: this._timeout / 1000,
    });

    return new Promise((resolve, reject) => {
      let timeout: number;

      const onConnect = this._config.delegate?.onConnect;
      const onDisconnect = this._config.delegate?.onDisconnect;

      ua.on('connecting', () => {
        timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, this._timeout);
      });

      ua.on('connected', () => {
        Promise.resolve()
          .then(() => clearTimeout(timeout))
          .then(onConnect)
          .catch(console.error);

        Promise.resolve()
          .then(() => {
            ua.on('newRTCSession', (e: any) => {
              const { session, originator } = e || {};
              if (!session || !originator?.length) return;

              if (!this._dialog) this._dialog = new Dialog(session, this._config.delegate);

              session.on('accepted', this.onSessionAccepted.bind(this));
              session.on('confirmed', this.onSessionConfirmed.bind(this));
              session.on('failed', this.onSessionEnded.bind(this));
              session.on('ended', this.onSessionEnded.bind(this));
              session.on('progress', this.onSessionProgress.bind(this));

              // if ('remote' === originator) {
              //   this._incomingCall();
              // } else {
              //   this._outgoingCall();
              // }
            });
          })
          .catch(console.error);
        resolve(ua);
      });

      ua.on('disconnected', ({ error, code, reason }) => {
        Promise.resolve()
          .then(() => clearTimeout(timeout))
          .then(() => onDisconnect?.(error, code, reason))
          .catch(console.error);
      });

      ua.start();
    });
  }

  // private async _incomingCall() {
  //   console.log('Incoming call');
  // }
  //
  // private async _outgoingCall() {
  //   console.log('Outgoing call');
  // }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionAccepted(_event: IncomingEvent | OutgoingEvent) {
    // console.debug('UA[onSessionAccepted]: ', event);

    if (!this._dialog) return;

    if ('CREATED' === this._dialog.status) {
      this._dialog.status = 'CONNECTED';
      Promise.resolve().then(() => this._dialog?.delegate?.callConnected?.());
    }

    this._audio.srcObject = this._dialog.remoteStream();
    this._audio.play().catch(console.error);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionProgress(_event: IncomingEvent | OutgoingEvent) {
    // console.debug('UA[onSessionProgress]: ', event);
    // const call = useCallStore();
    // call.status = CallStatus.S_RINGING;

    if (!this._dialog) return;
  }

  private async onSessionConfirmed(event: IncomingAckEvent | OutgoingAckEvent) {
    console.debug('UA[onSessionConfirmed]: ', event);
    // const call = useCallStore();

    // if (CallStatus.S_ANSWERED !== call.status) {
    //   call.status = CallStatus.S_ANSWERED;
    //   call.answerTime = Date.now();
    // }

    if (!this._dialog) return;

    if ('CREATED' === this._dialog.status) {
      this._dialog.status = 'CONNECTED';
      Promise.resolve().then(() => this._dialog?.delegate?.callConnected?.());
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionEnded(_event: EndEvent) {
    // console.debug(`UA[onSessionEnded] ${event.cause}: `, event);
    // if ('Terminated' !== event.cause) {
    // } else {
    // }

    if (!this._dialog) return;

    this._dialog.status = 'TERMINATED';
    Promise.resolve().then(() => this._dialog?.delegate?.callTerminated?.());
  }
}

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoiceSDK;
}
