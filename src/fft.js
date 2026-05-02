// src/fft.js

export class FFT {
  constructor(size) {
    this.size = size;
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new Error("FFT size must be a power of 2");
    }

    this.real = new Float32Array(size);
    this.imag = new Float32Array(size);
    this.reverseTable = new Uint32Array(size);

    let limit = 1;
    let bit = size >> 1;
    while (limit < size) {
      for (let i = 0; i < limit; i++) {
        this.reverseTable[i + limit] = this.reverseTable[i] + bit;
      }
      limit = limit << 1;
      bit = bit >> 1;
    }
  }

  forward(realInput) {
    const n = this.size;
    
    // bit reversal
    for (let i = 0; i < n; i++) {
      this.real[i] = realInput[this.reverseTable[i]];
      this.imag[i] = 0;
    }

    // Cooley-Tukey decimation-in-time
    let halfSize = 1;
    while (halfSize < n) {
      const phaseShiftStepReal = Math.cos(-Math.PI / halfSize);
      const phaseShiftStepImag = Math.sin(-Math.PI / halfSize);
      let currentPhaseShiftReal = 1;
      let currentPhaseShiftImag = 0;

      for (let fftStep = 0; fftStep < halfSize; fftStep++) {
        for (let i = fftStep; i < n; i += 2 * halfSize) {
          const off = i + halfSize;
          const tr = (currentPhaseShiftReal * this.real[off]) - (currentPhaseShiftImag * this.imag[off]);
          const ti = (currentPhaseShiftReal * this.imag[off]) + (currentPhaseShiftImag * this.real[off]);
          this.real[off] = this.real[i] - tr;
          this.imag[off] = this.imag[i] - ti;
          this.real[i] += tr;
          this.imag[i] += ti;
        }
        const tmpReal = currentPhaseShiftReal;
        currentPhaseShiftReal = (tmpReal * phaseShiftStepReal) - (currentPhaseShiftImag * phaseShiftStepImag);
        currentPhaseShiftImag = (tmpReal * phaseShiftStepImag) + (currentPhaseShiftImag * phaseShiftStepReal);
      }
      halfSize = halfSize << 1;
    }
    
    // Calculate magnitudes (only first half due to Nyquist)
    const magnitudes = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      // Normalize by N
      magnitudes[i] = Math.sqrt(this.real[i] * this.real[i] + this.imag[i] * this.imag[i]) / n;
    }
    return magnitudes;
  }
}

export function applyHanningWindow(buffer) {
  const n = buffer.length;
  for (let i = 0; i < n; i++) {
    buffer[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
}
