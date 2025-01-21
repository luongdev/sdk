import type { Config, User, SdkResult } from '@api/types/types.ts';
import type { ConnectOptions } from '@api/types/connections.ts';
import { UA, URI, Utils, WebSocketInterface, C } from 'jssip';
import type { CallActors, CallDelegate, CallOptions } from '@api/types/call.ts';
import type {
  EndEvent,
  IncomingAckEvent,
  IncomingEvent,
  OutgoingAckEvent,
  OutgoingEvent,
  RTCSession,
} from 'jssip/lib/RTCSession';
import type { IncomingRTCSessionEvent, OutgoingRTCSessionEvent } from 'jssip/lib/UA';

type DialogOptions = {
  domain: string;
  deviceId?: string;
  localMedia?: MediaStream;
  delegate?: CallDelegate;
};

class Dialog {
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

const DID_HEADER = 'X-DID';
const DIRECTION_HEADER = 'X-DIR';

export default class VoiceSDK {
  private static _instance: VoiceSDK;

  private readonly _config: Config;

  private readonly _uaGateways: string[];
  private _ua?: UA;

  private readonly _timeout = 10000;

  private _dialog?: Dialog;
  private _localMedia?: MediaStream;

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

  public async login(user: User): Promise<SdkResult> {
    const connected = await this._connect(user);
    if (!connected) {
      return {
        success: false,
        error: `Failed to connect to gateway(s): ${this._uaGateways.join(', ')}`,
      };
    }

    return new Promise<SdkResult>(resolve => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: `Registration timeout after ${this._timeout}ms` });
      }, this._timeout);

      this._ua?.on('registered', () => {
        clearTimeout(timeout);
        resolve({ success: true });
      });

      this._ua?.on('registrationFailed', e => {
        resolve({
          success: false,
          error: `Registration failed: ${e.cause}`,
        });
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

  public async makeCall(dest: string, opts?: CallOptions): Promise<SdkResult> {
    const result = { success: false } as SdkResult;

    if (!dest?.length) {
      result.error = 'Invalid destination';
      return result;
    }

    if (this._dialog && !this._dialog.isTerminated()) {
      result.error = 'Call already in progress';
      return result;
    }

    if (!this._ua || !this.isConnected || !this.isRegistered) {
      result.error = 'SDK not ready for make call';
      return result;
    }

    const targetUri = new URI('sip', dest, this._config.appName);

    const extraHeaders: string[] = [];
    if (opts?.did?.length) extraHeaders.push(`${DID_HEADER}: ${opts.did}`);

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
    this._ua.prependOnceListener('newRTCSession', e => {
      const { request, originator } = e;

      const sipInbound = originator === 'remote';
      if (!sipInbound) (request as any).setHeader('call-id', globalCallId);

      this._onSession(e, opts);
    });

    this._ua.call(targetUri.toString(), { ...callOpts });

    result.success = true;
    result.data = { id: globalCallId, actions: this._dialog?.actions };

    return result;
  }

  public hangup(cause?: string) {
    if (!this._dialog?.session) return;

    this._dialog.session.terminate({ cause });
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

      // eslint-disable-next-line
      // @ts-expect-error
      ua.on('newTransaction', ({ transaction }) => {
        const request = transaction.request || { method: '', cseq: 0 };
        const { method, cseq } = request;
        if (!method?.length || !cseq) return;

        if (method === 'REGISTER' && cseq === 1) {
          (request as any)?.setHeader('call-id', Utils.newUUID());
        }
      });

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
          .then(() => ua.on('newRTCSession', this._onSession.bind(this)))
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

  private _onSession(e: IncomingRTCSessionEvent | OutgoingRTCSessionEvent, opts?: CallOptions) {
    const { session, request, originator } = e || {};
    if (!session || !originator?.length) {
      console.error('UA[_onSession]: Invalid session', e);
      return;
    }

    const sipInbound = originator === 'remote';
    const directionHeader = request?.getHeader(DIRECTION_HEADER);
    const inbound = sipInbound && 'outbound' !== directionHeader;
    const callId = request?.getHeader('call-id') || Utils.newUUID();
    const caller = request?.from?.uri?.user ?? 'Unknown';
    const callee = request?.to?.uri?.user ?? 'Unknown';

    if (sipInbound) {
      if (this._dialog && !this._dialog.isTerminated()) {
        console.warn(`UA[_onSession]: Call already in progress: ${this._dialog.id}`);
        return this._dialog?.session?.terminate({
          status_code: 486,
          cause: C.causes.BUSY,
          reason_phrase: 'CALL_IN_PROGRESS',
        });
      }
    }

    if (!this._dialog || this._dialog.isTerminated()) {
      const finalDelegate = {
        rtc: opts?.delegate?.rtc ?? this._config.delegate?.rtc,
        callCreated: opts?.delegate?.callCreated ?? this._config.delegate?.callCreated,
        callConnected: opts?.delegate?.callConnected ?? this._config.delegate?.callConnected,
        callTerminated: opts?.delegate?.callTerminated ?? this._config.delegate?.callTerminated,
      } as CallDelegate;

      this._dialog = new Dialog(session, sipInbound, {
        domain: this._config.appName,
        deviceId: this._config.deviceId,
        localMedia: this._localMedia,
        delegate: finalDelegate,
      });
      this._dialog.id = callId;
      if (finalDelegate?.rtc) {
        Object.entries(finalDelegate?.rtc).forEach(([event, handler]) => session.addListener(event, handler));
      }
      finalDelegate?.callCreated?.(this._dialog.actions, { id: callId, inbound, caller, callee });

      session.on('accepted', this.onSessionAccepted.bind(this));
      session.on('confirmed', this.onSessionConfirmed.bind(this));
      session.on('failed', this.onSessionEnded.bind(this));
      session.on('ended', this.onSessionEnded.bind(this));
      session.on('progress', this.onSessionProgress.bind(this));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionAccepted(_event: IncomingEvent | OutgoingEvent) {
    if (!this._dialog) return;

    if ('CREATED' === this._dialog.status) {
      this._dialog.status = 'CONNECTED';
      Promise.resolve().then(() => this._dialog?.delegate?.callConnected?.());

      const audio = new Audio();
      audio.srcObject = this._dialog.remoteStream();
      audio.play().catch(console.error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionProgress(_event: IncomingEvent | OutgoingEvent) {
    // call.status = CallStatus.S_RINGING;

    if (!this._dialog) return;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionConfirmed(_event: IncomingAckEvent | OutgoingAckEvent) {
    if (!this._dialog) return;

    if ('CREATED' === this._dialog.status) {
      this._dialog.status = 'CONNECTED';
      Promise.resolve().then(() => this._dialog?.delegate?.callConnected?.());
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async onSessionEnded(_event: EndEvent) {
    if (!this._dialog || this._dialog.isTerminated()) {
      return;
    }

    this._dialog.status = 'TERMINATED';
    Promise.resolve()
      .then(() => this._dialog?.delegate?.callTerminated?.())
      .then(() => delete this._dialog)
      .catch(console.error);
  }
}

if (window.VoiceSDK === undefined || !window.VoiceSDK) {
  window.VoiceSDK = VoiceSDK;
}
