import type { Config, User } from '@api/types/types.ts';
import type { ConnectOptions } from '@api/types/connections.ts';
import { UA, URI, Utils, WebSocketInterface } from 'jssip';
import type { CallOptions } from '@api/types/call.ts';
import type {
  EndEvent,
  IncomingAckEvent,
  IncomingEvent,
  OutgoingAckEvent,
  OutgoingEvent,
  RTCSession,
} from 'jssip/lib/RTCSession';

export default class VoiceSDK {
  private static _instance: VoiceSDK;

  private readonly _config: Config;

  private readonly _uaGateways: string[];
  private _ua?: UA;

  private readonly _timeout = 10000;

  private _session?: RTCSession;
  private _localMedia?: MediaStream;
  private readonly _remoteMedia: MediaStream;
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

    this._remoteMedia = new MediaStream();
    this._audio = new Audio();
    this._audio.srcObject = this._remoteMedia;
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

    this._ua.unregister();
    this._ua.stop();
  }

  public async makeCall(dest: string, opts: CallOptions): Promise<string> {
    if (!this._ua || !this.isConnected || !this.isRegistered) {
      throw new Error('SDK not ready for make call');
    }

    const { extraVariables } = opts;
    const targetUri = new URI('sip', dest, this._config.appName);

    const extraHeaders: string[] = [];
    if (opts.did?.length) extraHeaders.push(`X-Dialed-Number: ${opts.did}`);

    if (extraVariables) {
      Object.entries(extraVariables).forEach(([key, value]) => {
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
    this._ua.once(
      'newRTCSession',
      e => e.originator === 'local' && (e.request as any).setHeader('call-id', globalCallId),
    );

    this._ua.call(targetUri.toString(), { ...callOpts, eventHandlers: {} });

    return globalCallId;
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

              this._session = session;

              session.on('accepted', this.onSessionAccepted.bind(this));
              session.on('confirmed', this.onSessionConfirmed.bind(this));
              session.on('failed', this.onSessionEnded.bind(this));
              session.on('ended', this.onSessionEnded.bind(this));
              session.on('progress', this.onSessionProgress.bind(this));

              if ('remote' === originator) {
                this._incomingCall(session);
              } else {
                this._outgoingCall(session);
              }
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

  // private async _fetchExtension(username: string): Promise<User> {
  //   try {
  //     const data = await fetch(`${this._config.baseUrl}/api/v2/user/${username}?c=${this._config.appId}`, {
  //       method: 'GET',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         Origin: window.location.origin,
  //       },
  //     }).then(res => res.json());
  //
  //     return {
  //       username: data.username,
  //       extension: data.extension,
  //       password: data.password,
  //     };
  //   } catch (e) {
  //     console.error(new Error(`Failed to fetch extension for ${username}`), e);
  //     throw e;
  //   }
  // }

  private async _incomingCall(session: RTCSession) {
    console.log('Incoming call', session);
  }

  private async _outgoingCall(session: RTCSession) {
    console.log('Outgoing call', session);
  }

  private async onSessionAccepted(event: IncomingEvent | OutgoingEvent) {
    // call.status = CallStatus.S_ANSWERED;
    // call.answerTime = Date.now();
    // const { remote } = await audio.start();

    console.debug('UA[onSessionAccepted]: ', event);

    this._session?.connection?.getReceivers()?.forEach(receiver => {
      if (receiver.track) this._remoteMedia?.addTrack(receiver.track);
    });

    this._audio.play().catch(console.error);
  }

  private async onSessionProgress(event: IncomingEvent | OutgoingEvent) {
    console.debug('UA[onSessionProgress]: ', event);
    // const call = useCallStore();
    // call.status = CallStatus.S_RINGING;
  }

  private async onSessionConfirmed(event: IncomingAckEvent | OutgoingAckEvent) {
    console.debug('UA[onSessionConfirmed]: ', event);
    // const call = useCallStore();

    // if (CallStatus.S_ANSWERED !== call.status) {
    //   call.status = CallStatus.S_ANSWERED;
    //   call.answerTime = Date.now();
    // }
  }

  private async onSessionEnded(event: EndEvent) {
    console.debug(`UA[onSessionEnded] ${event.cause}: `, event);
    // const call = useCallStore();
    //
    // if ('Terminated' !== event.cause) {
    //   call.error = event.cause;
    //   call.status = CallStatus.S_ERROR;
    // } else {
    //   call.status = CallStatus.S_TERMINATED;
    // }

    this._closeRemoteTracks();
  }

  private _closeRemoteTracks() {
    this._remoteMedia?.getTracks()?.forEach(track => track.stop());
  }
}

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoiceSDK;
}
