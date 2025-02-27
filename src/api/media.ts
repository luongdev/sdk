export class Media {
  private _localStream?: MediaStream;
  private _remoteStream?: MediaStream;

  constructor() {}

  get local(): MediaStream | undefined {
    return this._localStream;
  }

  get remote(): MediaStream | undefined {
    return this._remoteStream;
  }

  async requestLocal(deviceId?: string): Promise<MediaStream> {
    const ms = await navigator.mediaDevices.getUserMedia({
      video: false,
      preferCurrentTab: true,
      audio: deviceId?.length ? { deviceId } : true,
    });

    this._localStream = ms;

    return ms;
  }

  withRemote(stream: MediaStream): Media {
    this._remoteStream = stream;
    return this;
  }

  closeLocal() {
    if (this._localStream) {
      this._localStream.getTracks().forEach(t => t.stop());
      this._localStream = undefined;
    }
  }

  closeRemote() {
    if (this._remoteStream) {
      this._remoteStream.getTracks().forEach(t => t.stop());
      this._remoteStream = undefined;
    }
  }

  play(stream?: MediaStream) {
    stream = stream || this._remoteStream;

    if (stream) {
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play().catch(console.error);
    }
  }
}
