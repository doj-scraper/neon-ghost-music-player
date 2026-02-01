class LimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "threshold", defaultValue: -6, minValue: -24, maxValue: 0 },
      { name: "ceiling", defaultValue: -0.1, minValue: -6, maxValue: 0 },
      { name: "release", defaultValue: 120, minValue: 10, maxValue: 1000 },
      { name: "softClip", defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this._env = 1;
    this._sampleRate = sampleRate;
  }

  _dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  _softClip(sample, ceiling) {
    const c = Math.max(0.0001, ceiling);
    return Math.tanh(sample / c) * c;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const thresholdDb = parameters.threshold;
    const ceilingDb = parameters.ceiling;
    const releaseMs = parameters.release;
    const softClip = parameters.softClip;
    const bypass = parameters.bypass;

    const channels = input.length;
    const samples = input[0].length;

    for (let i = 0; i < samples; i += 1) {
      const threshold = this._dbToGain(thresholdDb.length > 1 ? thresholdDb[i] : thresholdDb[0]);
      const ceiling = this._dbToGain(ceilingDb.length > 1 ? ceilingDb[i] : ceilingDb[0]);
      const release = releaseMs.length > 1 ? releaseMs[i] : releaseMs[0];
      const bypassVal = bypass.length > 1 ? bypass[i] : bypass[0];
      const soft = softClip.length > 1 ? softClip[i] : softClip[0];

      let peak = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        const abs = Math.abs(input[ch][i] || 0);
        if (abs > peak) peak = abs;
      }

      let targetGain = 1;
      if (peak > threshold && peak > 0) {
        targetGain = threshold / peak;
      }

      const releaseCoeff = Math.exp(-1 / (this._sampleRate * (release / 1000)));
      if (targetGain < this._env) {
        this._env = targetGain;
      } else {
        this._env = this._env + (targetGain - this._env) * (1 - releaseCoeff);
      }

      for (let ch = 0; ch < channels; ch += 1) {
        const sample = input[ch][i] || 0;
        let out = bypassVal > 0.5 ? sample : sample * this._env;
        if (Math.abs(out) > ceiling) {
          out = Math.sign(out) * ceiling;
        }
        if (soft > 0.5) {
          out = this._softClip(out, ceiling);
        }
        if (output[ch]) output[ch][i] = out;
      }
    }

    return true;
  }
}

registerProcessor("limiter-processor", LimiterProcessor);
