(function () {
  class AudioEngine {
    constructor(keys, audioElements) {
      this.keys = keys;
      this.decks = {};
      this.masterContext = null;
      this.analysisContext = null;
      this.masterGain = null;
      this.masterFilter = null;
      this.limiter = null;
      this.masterAnalyser = null;
      this.recordDestination = null;
      this.headphoneDestination = null;
      this.masterOutputId = "";
      this.headphoneOutputId = "";
      this.masterVolume = 1;
      this.masterFx = { mode: "off", amount: 1 };
      this.monitorContext = null;
      this.monitorCueGain = null;
      this.monitorMasterGain = null;
      this.monitorSources = new Map();
      this.headphoneVolume = 1;
      this.headphoneMix = 0;
      this.cuedDecks = new Set();
      this.samplerSources = new Map();

      keys.forEach((key) => {
        this.decks[key] = {
          audio: audioElements[key],
          context: null,
          output: null,
          cueOutput: null,
          cueGain: null,
          masterSource: null,
          channelGain: null,
          filters: null,
          stemGains: [],
          stems: [true, true, true],
          effectFilter: null,
          delayWet: null,
          analyser: null,
          monitorSource: null
        };
      });
    }

    getAudioContextConstructor() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio is not supported by this browser.");
      return AudioContext;
    }

    ensureDeck(key) {
      const deck = this.decks[key];
      if (deck.context) {
        if (deck.context.state === "suspended") {
          deck.context.resume().catch((error) => console.error("Could not resume deck audio:", error));
        }
        if (this.masterContext && this.masterContext.state === "suspended") {
          this.masterContext.resume().catch((error) => console.error("Could not resume the master audio bus:", error));
        }
        return;
      }

      const AudioContext = this.getAudioContextConstructor();
      const context = new AudioContext();
      const source = context.createMediaElementSource(deck.audio);
      const filters = [context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter()];
      filters[0].type = "lowshelf";
      filters[0].frequency.value = 250;
      filters[1].type = "peaking";
      filters[1].frequency.value = 1000;
      filters[1].Q.value = 0.8;
      filters[2].type = "highshelf";
      filters[2].frequency.value = 4000;

      const effectFilter = context.createBiquadFilter();
      effectFilter.type = "allpass";
      effectFilter.frequency.value = 22000;
      const stemFilters = [context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter()];
      stemFilters[0].type = "lowpass";
      stemFilters[0].frequency.value = 240;
      stemFilters[1].type = "bandpass";
      stemFilters[1].frequency.value = 1150;
      stemFilters[1].Q.value = 0.62;
      stemFilters[2].type = "highpass";
      stemFilters[2].frequency.value = 2600;
      const stemGains = stemFilters.map(() => context.createGain());
      const channelGain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const output = context.createMediaStreamDestination();
      const cueGain = context.createGain();
      cueGain.gain.value = 0;
      const cueOutput = context.createMediaStreamDestination();
      const delay = context.createDelay(1);
      const delayWet = context.createGain();
      const feedback = context.createGain();
      delay.delayTime.value = 0.28;
      feedback.gain.value = 0.24;
      delayWet.gain.value = 0;

      source.connect(filters[0]);
      filters[0].connect(filters[1]);
      filters[1].connect(filters[2]);
      filters[2].connect(effectFilter);
      stemFilters.forEach((filter, index) => {
        effectFilter.connect(filter);
        filter.connect(stemGains[index]);
        stemGains[index].connect(channelGain);
      });
      stemGains.forEach((stemGain) => stemGain.connect(cueGain));
      cueGain.connect(cueOutput);
      effectFilter.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(channelGain);
      delayWet.connect(cueGain);
      delay.connect(feedback);
      feedback.connect(delay);
      channelGain.connect(analyser);
      analyser.connect(output);

      deck.context = context;
      deck.output = output;
      deck.cueOutput = cueOutput;
      deck.cueGain = cueGain;
      deck.channelGain = channelGain;
      deck.filters = filters;
      deck.stemGains = stemGains;
      deck.effectFilter = effectFilter;
      deck.delayWet = delayWet;
      deck.analyser = analyser;

      this.ensureMaster();
      context.resume().catch((error) => console.error("Could not start the deck audio context:", error));
      this.masterContext.resume().catch((error) => console.error("Could not start the master audio context:", error));
      this.connectMasterDeck(key);
      if (this.monitorContext) this.connectMonitorDeck(key);
      this.setStems(key, deck.stems);
      this.setEffect(key, "off", 0.5);
      this.setMasterEffect(this.masterFx.mode, this.masterFx.amount);
      this.setChannelMix(key, 0.82, 0.82, 1, 0.5);
      if (this.cuedDecks.has(key)) deck.cueGain.gain.value = 1;
    }

    ensureMaster() {
      if (this.masterContext) return;
      const AudioContext = this.getAudioContextConstructor();
      const context = new AudioContext();
      const masterGain = context.createGain();
      const masterFilter = context.createBiquadFilter();
      masterFilter.type = "allpass";
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const recordDestination = context.createMediaStreamDestination();
      const headphoneDestination = context.createMediaStreamDestination();

      masterGain.connect(masterFilter);
      masterFilter.connect(limiter);
      limiter.connect(analyser);
      analyser.connect(context.destination);
      limiter.connect(recordDestination);
      limiter.connect(headphoneDestination);

      this.masterContext = context;
      this.masterGain = masterGain;
      this.masterFilter = masterFilter;
      this.limiter = limiter;
      this.masterAnalyser = analyser;
      this.recordDestination = recordDestination;
      this.headphoneDestination = headphoneDestination;
      masterGain.gain.value = this.masterVolume;
      this.setMasterEffect(this.masterFx.mode, this.masterFx.amount);
      if (this.monitorContext) this.connectMonitorMaster();
    }

    connectMasterDeck(key) {
      const deck = this.decks[key];
      if (!deck.output || deck.masterSource) return;
      const source = this.masterContext.createMediaStreamSource(deck.output.stream);
      source.connect(this.masterGain);
      deck.masterSource = source;
    }

    ensureMonitor() {
      if (!this.masterContext) this.ensureMaster();
      if (!this.monitorContext) {
        const AudioContext = this.getAudioContextConstructor();
        const context = new AudioContext();
        const cueGain = context.createGain();
        const masterGain = context.createGain();
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        cueGain.connect(limiter);
        masterGain.connect(limiter);
        limiter.connect(context.destination);
        this.monitorContext = context;
        this.monitorCueGain = cueGain;
        this.monitorMasterGain = masterGain;
        this.connectMonitorMaster();
        this.keys.forEach((key) => this.connectMonitorDeck(key));
      }
      if (this.monitorContext.state === "suspended") {
        this.monitorContext.resume().catch((error) => console.error("Could not start the headphone monitor:", error));
      }
      if (this.headphoneOutputId && typeof this.monitorContext.setSinkId === "function") {
        this.monitorContext.setSinkId(this.headphoneOutputId).catch((error) => {
          console.error("Could not restore the headphone output device:", error);
        });
      }
      this.updateMonitorMix();
    }

    connectMonitorDeck(key) {
      const deck = this.decks[key];
      if (!deck.cueOutput || deck.monitorSource) return;
      deck.monitorSource = this.monitorContext.createMediaStreamSource(deck.cueOutput.stream);
      deck.monitorSource.connect(this.monitorCueGain);
    }

    connectMonitorMaster() {
      if (!this.monitorContext || !this.headphoneDestination || this.monitorSources.has("master")) return;
      const source = this.monitorContext.createMediaStreamSource(this.headphoneDestination.stream);
      source.connect(this.monitorMasterGain);
      this.monitorSources.set("master", source);
    }

    updateMonitorMix() {
      if (!this.monitorContext) return;
      const now = this.monitorContext.currentTime;
      const cueActive = this.cuedDecks.size > 0;
      this.monitorCueGain.gain.setTargetAtTime(
        this.headphoneVolume * (cueActive ? 1 - this.headphoneMix : 0),
        now,
        0.02
      );
      this.monitorMasterGain.gain.setTargetAtTime(
        this.headphoneVolume * this.headphoneMix,
        now,
        0.02
      );
    }

    setCue(key, enabled) {
      if (enabled) {
        this.cuedDecks.add(key);
        this.ensureMonitor();
      } else {
        this.cuedDecks.delete(key);
        if (this.monitorContext) this.updateMonitorMix();
      }
    }

    setHeadphoneMix(mix) {
      this.headphoneMix = Math.min(1, Math.max(0, mix));
      this.updateMonitorMix();
    }

    setHeadphoneVolume(volume) {
      this.headphoneVolume = Math.min(1, Math.max(0, volume));
      this.updateMonitorMix();
    }

    setChannelMix(key, volume, fader, gain, crossfader) {
      const deck = this.decks[key];
      if (!deck.channelGain) return;
      const crossfade = {
        a: 1 - crossfader,
        b: crossfader,
        c: 1 - crossfader,
        d: crossfader
      };
      const normalization = 1 / Math.sqrt(
        this.keys.reduce((sum, item) => sum + crossfade[item] ** 2, 0)
      );
      deck.channelGain.gain.setTargetAtTime(
        volume * fader * gain * crossfade[key] * normalization,
        deck.context.currentTime,
        0.02
      );
    }

    setMasterVolume(volume) {
      this.masterVolume = Math.min(1, Math.max(0, volume));
      if (this.masterGain && this.masterContext) {
        this.masterGain.gain.setTargetAtTime(this.masterVolume, this.masterContext.currentTime, 0.02);
      }
    }

    async decodeSamplerSample(data) {
      this.ensureMaster();
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return this.masterContext.decodeAudioData(buffer);
    }

    async analyzeWaveform(file, bucketCount = 512) {
      if (!file || typeof file.arrayBuffer !== "function") {
        throw new Error("The selected audio file cannot be analyzed.");
      }
      if (!Number.isInteger(bucketCount) || bucketCount < 1 || bucketCount > 4096) {
        throw new Error("Invalid waveform resolution.");
      }

      const data = await file.arrayBuffer();
      const AudioContext = this.getAudioContextConstructor();
      this.analysisContext ||= new AudioContext();
      const audioBuffer = await this.analysisContext.decodeAudioData(data);
      if (audioBuffer.length < 1 || audioBuffer.numberOfChannels < 1) {
        throw new Error("The audio file contains no samples.");
      }

      const peakCount = Math.min(bucketCount, audioBuffer.length);
      const peaks = new Float32Array(peakCount);
      const channelData = Array.from(
        { length: audioBuffer.numberOfChannels },
        (_, channel) => audioBuffer.getChannelData(channel)
      );
      for (let bucket = 0; bucket < peakCount; bucket++) {
        const start = Math.floor(bucket * audioBuffer.length / peakCount);
        const end = Math.max(start + 1, Math.floor((bucket + 1) * audioBuffer.length / peakCount));
        let peak = 0;
        for (const samples of channelData) {
          for (let index = start; index < Math.min(end, audioBuffer.length); index++) {
            peak = Math.max(peak, Math.abs(samples[index]));
          }
        }
        peaks[bucket] = peak;
      }

      const envelopeRate = 40;
      const envelopeFrameSize = Math.max(1, Math.round(audioBuffer.sampleRate / envelopeRate));
      const envelope = [];
      for (let start = 0; start < audioBuffer.length; start += envelopeFrameSize) {
        const end = Math.min(audioBuffer.length, start + envelopeFrameSize);
        let energy = 0;
        let sampleCount = 0;
        for (const samples of channelData) {
          for (let index = start; index < end; index++) {
            energy += samples[index] * samples[index];
            sampleCount++;
          }
        }
        envelope.push(Math.sqrt(energy / Math.max(1, sampleCount)));
      }

      const onset = new Float32Array(envelope.length);
      let maximumOnset = 0;
      for (let index = 1; index < envelope.length; index++) {
        const value = Math.max(0, envelope[index] - envelope[index - 1]);
        onset[index] = value;
        maximumOnset = Math.max(maximumOnset, value);
      }
      let bpm = null;
      let beatOffsetSeconds = 0;
      if (maximumOnset > 0) {
        const minimumLag = Math.ceil(60 * envelopeRate / 180);
        const maximumLag = Math.min(Math.floor(60 * envelopeRate / 60), Math.floor(onset.length / 3));
        const tempoScores = [];
        const correlationAtLag = (lag) => {
          let score = 0;
          let leftEnergy = 0;
          let rightEnergy = 0;
          for (let index = lag; index < onset.length; index++) {
            const left = onset[index];
            const right = onset[index - lag];
            score += left * right;
            leftEnergy += left * left;
            rightEnergy += right * right;
          }
          return score / (Math.sqrt(leftEnergy * rightEnergy) || 1);
        };
        for (let lag = minimumLag; lag <= maximumLag; lag++) {
          const score = correlationAtLag(lag) + 0.5 * correlationAtLag(lag * 2);
          tempoScores.push({ lag, score });
        }
        const strongestScore = tempoScores.reduce((best, candidate) => Math.max(best, candidate.score), 0);
        const commonTempoCandidate = tempoScores
          .filter((candidate) => {
            const candidateBpm = 60 * envelopeRate / candidate.lag;
            return candidateBpm >= 90 && candidateBpm <= 150;
          })
          .reduce((best, candidate) => candidate.score > (best?.score ?? -1) ? candidate : best, null);
        const bestLag = commonTempoCandidate && commonTempoCandidate.score >= strongestScore * 0.6
          ? commonTempoCandidate.lag
          : tempoScores.find((candidate) => candidate.score === strongestScore)?.lag || 0;
        if (bestLag > 0 && strongestScore > 0) {
          const selectedIndex = tempoScores.findIndex((candidate) => candidate.lag === bestLag);
          let adjustedLag = bestLag;
          if (selectedIndex > 0 && selectedIndex < tempoScores.length - 1) {
            const previous = tempoScores[selectedIndex - 1].score;
            const selected = tempoScores[selectedIndex].score;
            const next = tempoScores[selectedIndex + 1].score;
            const curvature = previous - 2 * selected + next;
            if (curvature < 0) adjustedLag += Math.max(-0.5, Math.min(0.5, 0.5 * (previous - next) / curvature));
          }
          bpm = Math.round(60 * envelopeRate / adjustedLag * 10) / 10;
          let bestPhaseScore = -1;
          for (let phase = 0; phase < bestLag; phase++) {
            let phaseScore = 0;
            for (let index = phase; index < onset.length; index += bestLag) phaseScore += onset[index];
            if (phaseScore > bestPhaseScore) {
              bestPhaseScore = phaseScore;
              beatOffsetSeconds = phase / envelopeRate;
            }
          }
        }
      }

      const key = await this.analyzeMusicalKey(audioBuffer, channelData);
      return { peaks, bpm, key, beatOffsetSeconds, durationSeconds: audioBuffer.duration };
    }

    async analyzeMusicalKey(audioBuffer, channelData) {
      const targetRate = 11025;
      const sampleCount = Math.max(1, Math.floor(audioBuffer.length * targetRate / audioBuffer.sampleRate));
      const mono = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index++) {
        const start = Math.floor(index * audioBuffer.sampleRate / targetRate);
        const end = Math.min(
          audioBuffer.length,
          Math.max(start + 1, Math.floor((index + 1) * audioBuffer.sampleRate / targetRate))
        );
        let sample = 0;
        for (const channel of channelData) {
          for (let sourceIndex = start; sourceIndex < end; sourceIndex++) sample += channel[sourceIndex];
        }
        mono[index] = sample / ((end - start) * channelData.length);
      }
      if (mono.length < targetRate * 0.75) return null;

      const fftSize = 8192;
      const hopSize = 4096;
      const real = new Float64Array(fftSize);
      const imaginary = new Float64Array(fftSize);
      const chroma = new Float64Array(12);
      const frames = Math.max(1, Math.floor(Math.max(0, mono.length - fftSize) / hopSize) + 1);

      for (let frame = 0; frame < frames; frame++) {
        const start = Math.min(frame * hopSize, Math.max(0, mono.length - fftSize));
        for (let index = 0; index < fftSize; index++) {
          const sample = mono[start + index] || 0;
          real[index] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (fftSize - 1)));
          imaginary[index] = 0;
        }
        this.fft(real, imaginary);
        for (let bin = 1; bin < fftSize / 2; bin++) {
          const frequency = bin * targetRate / fftSize;
          if (frequency < 55 || frequency > 2200) continue;
          const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
          const pitchClass = (midi % 12 + 12) % 12;
          const magnitude = Math.hypot(real[bin], imaginary[bin]);
          chroma[pitchClass] += magnitude / Math.sqrt(frequency);
        }
        if (frame > 0 && frame % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const templates = {
        major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
        minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
      };
      const keyNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
      const chromaMean = chroma.reduce((sum, value) => sum + value, 0) / chroma.length;
      const centeredChroma = chroma.map((value) => value - chromaMean);
      const chromaNorm = Math.sqrt(centeredChroma.reduce((sum, value) => sum + value * value, 0));
      if (chromaNorm < 1e-9) return null;

      let bestScore = -Infinity;
      let bestKey = null;
      for (let tonic = 0; tonic < 12; tonic++) {
        for (const mode of ["major", "minor"]) {
          const template = templates[mode];
          const templateMean = template.reduce((sum, value) => sum + value, 0) / template.length;
          let score = 0;
          let templateNormSquared = 0;
          for (let note = 0; note < 12; note++) {
            const centeredTemplate = template[(note - tonic + 12) % 12] - templateMean;
            score += centeredChroma[note] * centeredTemplate;
            templateNormSquared += centeredTemplate * centeredTemplate;
          }
          score /= chromaNorm * Math.sqrt(templateNormSquared);
          if (score > bestScore) {
            bestScore = score;
            bestKey = `${keyNames[tonic]} ${mode === "major" ? "major" : "minor"}`;
          }
        }
      }
      return bestKey;
    }

    fft(real, imaginary) {
      const length = real.length;
      for (let index = 1, reversed = 0; index < length; index++) {
        let bit = length >> 1;
        while (reversed & bit) {
          reversed ^= bit;
          bit >>= 1;
        }
        reversed ^= bit;
        if (index < reversed) {
          [real[index], real[reversed]] = [real[reversed], real[index]];
          [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
        }
      }

      for (let size = 2; size <= length; size <<= 1) {
        const angle = -2 * Math.PI / size;
        const stepReal = Math.cos(angle);
        const stepImaginary = Math.sin(angle);
        for (let start = 0; start < length; start += size) {
          let weightReal = 1;
          let weightImaginary = 0;
          const halfSize = size >> 1;
          for (let offset = 0; offset < halfSize; offset++) {
            const evenIndex = start + offset;
            const oddIndex = evenIndex + halfSize;
            const oddReal = real[oddIndex] * weightReal - imaginary[oddIndex] * weightImaginary;
            const oddImaginary = real[oddIndex] * weightImaginary + imaginary[oddIndex] * weightReal;
            real[oddIndex] = real[evenIndex] - oddReal;
            imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
            real[evenIndex] += oddReal;
            imaginary[evenIndex] += oddImaginary;
            const nextWeightReal = weightReal * stepReal - weightImaginary * stepImaginary;
            weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
            weightReal = nextWeightReal;
          }
        }
      }
    }

    async playSamplerPad(index, buffer, loop, volume, onEnded) {
      if (!buffer) throw new Error("Load an audio sample into this pad first.");
      this.ensureMaster();
      if (this.masterContext.state === "suspended") await this.masterContext.resume();
      this.stopSamplerPad(index);
      const source = this.masterContext.createBufferSource();
      const gain = this.masterContext.createGain();
      source.buffer = buffer;
      source.loop = Boolean(loop);
      gain.gain.value = Math.min(1, Math.max(0, volume));
      source.connect(gain);
      gain.connect(this.masterGain);
      this.samplerSources.set(index, { source, gain });
      source.onended = () => {
        if (this.samplerSources.get(index)?.source !== source) return;
        this.samplerSources.delete(index);
        if (onEnded) onEnded();
      };
      source.start();
    }

    stopSamplerPad(index) {
      const active = this.samplerSources.get(index);
      if (!active) return;
      this.samplerSources.delete(index);
      const now = this.masterContext.currentTime;
      active.gain.gain.cancelScheduledValues(now);
      active.gain.gain.setTargetAtTime(0, now, 0.008);
      try {
        active.source.stop(now + 0.04);
      } catch (error) {
        if (error.name !== "InvalidStateError") throw error;
      }
    }

    isSamplerPadPlaying(index) {
      return this.samplerSources.has(index);
    }

    setSamplerPadVolume(index, volume) {
      const active = this.samplerSources.get(index);
      if (!active || !this.masterContext) return;
      active.gain.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), this.masterContext.currentTime, 0.015);
    }

    setEQ(key, values) {
      const deck = this.decks[key];
      if (!deck.filters) return;
      ["low", "mid", "hi"].forEach((band, index) => {
        deck.filters[index].gain.setTargetAtTime(values[band], deck.context.currentTime, 0.02);
      });
    }

    setEffect(key, mode, amount) {
      const deck = this.decks[key];
      if (!deck.effectFilter) return;
      const normalized = Math.min(1, Math.max(0, amount));
      deck.effectFilter.type = mode === "off" || mode === "echo" ? "allpass" : mode;
      const frequency = mode === "highpass" ? 40 + normalized * 7000 : 22000 - normalized * 21000;
      deck.effectFilter.frequency.setTargetAtTime(frequency, deck.context.currentTime, 0.025);
      deck.delayWet.gain.setTargetAtTime(mode === "echo" ? normalized * 0.65 : 0, deck.context.currentTime, 0.025);
    }

    setStems(key, enabled) {
      const deck = this.decks[key];
      deck.stems = enabled.slice();
      if (!deck.context) return;
      deck.stemGains.forEach((gain, index) => {
        gain.gain.setTargetAtTime(enabled[index] ? 1 : 0, deck.context.currentTime, 0.015);
      });
    }

    setMasterEffect(mode, amount) {
      this.masterFx = { mode, amount: Math.min(1, Math.max(0, amount)) };
      if (!this.masterFilter || !this.masterContext) return;
      this.masterFilter.type = mode === "off" ? "allpass" : mode;
      const frequency = mode === "highpass" ? 30 + amount * 12000 : 20000 - amount * 19000;
      this.masterFilter.frequency.setTargetAtTime(frequency, this.masterContext.currentTime, 0.03);
    }

    async setMasterOutput(deviceId) {
      this.masterOutputId = deviceId;
      if (deviceId && !this.masterContext) this.ensureMaster();
      if (!this.masterContext) return;
      if (typeof this.masterContext.setSinkId !== "function") {
        throw new Error("This audio engine does not support selecting the master output device.");
      }
      await this.masterContext.setSinkId(deviceId);
    }

    async setHeadphoneOutput(deviceId) {
      this.headphoneOutputId = deviceId;
      if (!this.monitorContext) {
        if (!deviceId) return;
        this.ensureMonitor();
      }
      if (typeof this.monitorContext.setSinkId !== "function") {
        throw new Error("This audio engine does not support selecting the headphone output device.");
      }
      await this.monitorContext.setSinkId(deviceId);
    }

    getDeckLevel(key) {
      return this.getLevel(this.decks[key].analyser);
    }

    getMasterLevel() {
      return this.getLevel(this.masterAnalyser);
    }

    getLevel(analyser) {
      if (!analyser) return 0;
      const samples = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(samples);
      let squareSum = 0;
      for (const sample of samples) {
        const normalized = (sample - 128) / 128;
        squareSum += normalized * normalized;
      }
      return Math.min(1, Math.sqrt(squareSum / samples.length) * 2.5);
    }
  }

  window.SirKevinAudioEngine = AudioEngine;
})();
