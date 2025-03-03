export class Media {
  private _localStream?: MediaStream;
  private _remoteStream?: MediaStream;
  private _audioElement?: HTMLAudioElement;

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
      this._remoteStream.getTracks().forEach(t => {
        t.stop();
        this._remoteStream?.removeTrack(t);
      });
      this._remoteStream = undefined;
    }

    if (this._audioElement) {
      this._audioElement.pause();
      this._audioElement.srcObject = null;
      this._audioElement = undefined;
    }

    console.log('Remote media resources cleaned up');
  }

  play(stream?: MediaStream) {
    stream = stream || this._remoteStream;

    if (stream) {
      if (this._audioElement) {
        this._audioElement.pause();
        this._audioElement.srcObject = null;
      }

      this._audioElement = new Audio();
      this._audioElement.autoplay = true;
      this._audioElement.srcObject = stream;

      const playPromise = this._audioElement.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('Audio playback started successfully');
          })
          .catch(error => {
            console.error('Audio playback failed:', error);
            setTimeout(() => {
              if (this._audioElement) {
                this._audioElement.play().catch(console.error);
              }
            }, 1000);
          });
      }
    }
  }

  reset() {
    this.closeLocal();
    this.closeRemote();
    console.log('All media resources reset');
  }
}
