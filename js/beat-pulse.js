// js/beat-pulse.js
import { audioContextManager } from './audio-context.js';
import { visualizerSettings } from './storage.js';

export class BeatPulseManager {
    constructor() {
        this.card = null;
        this.overlay = null;
        this.audio = null;
        this.animationId = null;
        this.isRunning = false;
        this.dataArray = null;
        this.currentScale = 1.0;
        this.targetScale = 1.0;
        this.energyAverage = 0.22;
        this.lastBeatTime = 0;
        this.kick = 0;
    }

    start(cardElement, overlayElement, audioElement) {
        // Skip audio beat pulsing on TV devices to preserve low-power CPU/GPU
        if (typeof document !== 'undefined' && document.body?.classList.contains('is-tv-device')) {
            return;
        }

        this.card = cardElement || document.getElementById('fullscreen-artwork-card');
        this.overlay = overlayElement || document.getElementById('fullscreen-cover-overlay');
        const effectiveAudio =
            audioElement ||
            window.player?.activeElement ||
            this.audio ||
            document.querySelector('audio');
        this.audio = effectiveAudio;

        if (effectiveAudio) {
            if (!audioContextManager.isReady()) {
                audioContextManager.init(effectiveAudio);
            } else {
                audioContextManager.changeSource(effectiveAudio);
            }
            if (audioContextManager.getAudioContext()?.state === 'suspended') {
                void audioContextManager.resume();
            }
        }

        if (!this.card) return;

        if (this.isRunning) return;
        this.isRunning = true;
        this.loop();
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.card) {
            this.card.style.transform = '';
            this.card.style.boxShadow = '';
            this.card.classList.remove('beat-pulse-fallback');
        }
    }

    loop = () => {
        if (!this.isRunning) return;

        if (!visualizerSettings.isBeatPulseEnabled()) {
            if (this.card) {
                this.card.style.transform = 'scale(1)';
                this.card.style.boxShadow = '';
                this.card.classList.remove('beat-pulse-fallback');
            }
            this.animationId = requestAnimationFrame(this.loop);
            return;
        }

        const currentAudio = window.player?.activeElement || this.audio;
        if (currentAudio && currentAudio !== this.audio) {
            this.audio = currentAudio;
            if (audioContextManager.isReady()) {
                audioContextManager.changeSource(currentAudio);
            }
        }

        // Check if overlay is closed or paused
        if (
            !this.overlay ||
            this.overlay.style.display === 'none' ||
            this.overlay.classList.contains('fullscreen-paused') ||
            (this.audio && this.audio.paused)
        ) {
            if (this.card) {
                this.card.style.transform = 'scale(1)';
                this.card.style.boxShadow = '';
                this.card.classList.remove('beat-pulse-fallback');
            }
            this.animationId = requestAnimationFrame(this.loop);
            return;
        }

        let analyser = audioContextManager.getAnalyser();
        let audioCtx = audioContextManager.getAudioContext();

        if (
            (!audioCtx || !analyser || audioCtx.state === 'suspended') &&
            this.audio &&
            !this.audio.paused
        ) {
            if (!audioContextManager.isReady()) {
                audioContextManager.init(this.audio);
            }
            void audioContextManager.resume();
            analyser = audioContextManager.getAnalyser();
            audioCtx = audioContextManager.getAudioContext();
        }

        if (analyser && audioCtx && audioCtx.state === 'running') {
            if (!this.dataArray || this.dataArray.length !== analyser.frequencyBinCount) {
                this.dataArray = new Uint8Array(analyser.frequencyBinCount);
            }

            analyser.getByteFrequencyData(this.dataArray);

            // Sub-bass and bass: sample bins 1 to 8 (approx 30Hz - 180Hz)
            const sampleBins = Math.min(8, this.dataArray.length);
            let bassMax = 0;
            for (let i = 1; i <= sampleBins; i++) {
                const val = this.dataArray[i] || 0;
                if (val > bassMax) bassMax = val;
            }

            const rawBass = bassMax / 255; // 0.0 to 1.0
            const now = performance.now();

            // Detect beat kick: bass energy above running average
            this.energyAverage = this.energyAverage * 0.94 + rawBass * 0.06;

            const isKick = rawBass > this.energyAverage * 1.22 && rawBass > 0.25 && now - this.lastBeatTime > 150;

            if (isKick) {
                this.kick = Math.min(1.0, (rawBass - 0.22) * 1.6);
                this.lastBeatTime = now;
            } else {
                this.kick *= 0.88; // decay
            }

            // Calculate scale: 1.0 to ~1.045 (clean 1:1 rectangle pulse)
            this.targetScale = 1.0 + Math.pow(this.kick, 1.35) * 0.045;

            // Smooth interpolation
            this.currentScale = this.currentScale + (this.targetScale - this.currentScale) * 0.35;

            const glow = (this.kick * 30).toFixed(1);
            const alpha = (this.kick * 0.28).toFixed(2);

            this.card.style.transform = `scale(${this.currentScale.toFixed(4)})`;
            if (this.kick > 0.08) {
                this.card.style.boxShadow = `0 24px 60px rgba(0, 0, 0, 0.45), 0 0 ${glow}px rgba(255, 255, 255, ${alpha})`;
            } else {
                this.card.style.boxShadow = '';
            }
            this.card.classList.remove('beat-pulse-fallback');
        } else {
            // Analyser not available or cross-origin: use CSS fallback pulse
            this.card.classList.add('beat-pulse-fallback');
            this.card.style.transform = '';
            this.card.style.boxShadow = '';
        }

        this.animationId = requestAnimationFrame(this.loop);
    };
}

export const beatPulseManager = new BeatPulseManager();
