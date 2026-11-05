class ScannerSoundEngine {
  private context: AudioContext | null = null;
  isUnlocked = false;

  unlockAudio() {
    try {
      const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return false;
      this.context ??= new AudioCtor();
      if (this.context.state === 'suspended') void this.context.resume();
      this.tone(1050, 0.045, 'sine', 0, 0.12);
      this.isUnlocked = true;
      return true;
    } catch { return false; }
  }

  private tone(frequency: number, duration: number, type: OscillatorType, offset = 0, volume = 0.3) {
    if (!this.context) return;
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    const start = this.context.currentTime + offset;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  playCheckInSuccess() { this.tone(1200, 0.1, 'triangle', 0, 0.34); }
  playCheckOutSuccess() {
    this.tone(1000, 0.09, 'triangle', 0, 0.3);
    this.tone(1500, 0.12, 'triangle', 0.11, 0.34);
  }
  playError() {
    this.tone(250, 0.35, 'sawtooth', 0, 0.3);
    if (typeof navigator !== 'undefined') navigator.vibrate?.(200);
  }
}

export const soundEngine = new ScannerSoundEngine();
