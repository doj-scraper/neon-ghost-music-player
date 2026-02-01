class MeterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bypass", defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this._sampleRate = sampleRate;
    this._momentaryWindow = Math.max(1, Math.floor(this._sampleRate * 0.4));
    this._shortWindow = Math.max(1, Math.floor(this._sampleRate * 3.0));
    this._momentaryBuffer = new Float32Array(this._momentaryWindow);
    this._shortBuffer = new Float32Array(this._shortWindow);
    this._momentaryIndex = 0;
    this._shortIndex = 0;
    this._momentarySum = 0;
    this._shortSum = 0;
    this._integratedSum = 0;
    this._integratedCount = 0;
    this._frameCounter = 0;
    this._lastReport = 0;
  }

  _calcLufs(ms) {
    if (ms <= 0) return -120;
    return -0.691 + 10 * Math.log10(ms);
  }

  process(inputs, outputs, parameters) {
    const bypass = parameters.bypass?.[0] ?? 0;
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) {
      return true;
    }

    const channels = input.length;
    const samples = input[0].length;

    let peak = 0;
    let sumSquares = 0;
    let sumL = 0;
    let sumR = 0;
    let sumLL = 0;
    let sumRR = 0;

    for (let i = 0; i < samples; i += 1) {
      let frameSum = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        const sample = input[ch][i] || 0;
        frameSum += sample * sample;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        if (output[ch]) output[ch][i] = bypass ? input[ch][i] : input[ch][i];
      }

      const frameMs = frameSum / channels;
      sumSquares += frameMs;

      this._momentarySum -= this._momentaryBuffer[this._momentaryIndex] || 0;
      this._momentaryBuffer[this._momentaryIndex] = frameMs;
      this._momentarySum += frameMs;
      this._momentaryIndex = (this._momentaryIndex + 1) % this._momentaryWindow;

      this._shortSum -= this._shortBuffer[this._shortIndex] || 0;
      this._shortBuffer[this._shortIndex] = frameMs;
      this._shortSum += frameMs;
      this._shortIndex = (this._shortIndex + 1) % this._shortWindow;

      this._integratedSum += frameMs;
      this._integratedCount += 1;

      if (channels > 1) {
        const l = input[0][i] || 0;
        const r = input[1][i] || 0;
        sumL += l * r;
        sumLL += l * l;
        sumRR += r * r;
        sumR += 1;
      }
    }

    this._frameCounter += samples;
    const rms = Math.sqrt(sumSquares / samples);

    if (this._frameCounter - this._lastReport >= this._sampleRate * 0.05) {
      this._lastReport = this._frameCounter;
      const momentaryMs = this._momentarySum / this._momentaryWindow;
      const shortMs = this._shortSum / this._shortWindow;
      const integratedMs = this._integratedCount > 0 ? this._integratedSum / this._integratedCount : 0;

      let correlation = 0;
      if (channels > 1 && sumLL > 0 && sumRR > 0) {
        correlation = sumL / Math.sqrt(sumLL * sumRR);
      }

      this.port.postMessage({
        peak,
        rms,
        lufsMomentary: this._calcLufs(momentaryMs),
        lufsShort: this._calcLufs(shortMs),
        lufsIntegrated: this._calcLufs(integratedMs),
        correlation,
      });
    }

    return true;
  }
}

registerProcessor("meter-processor", MeterProcessor);
