import VoiceSDK from '@api/voice-sdk.ts';

export {};
declare global {
  interface Window {
    VoiceSDK: VoiceSDK;
  }
}
