
import * as base64 from 'base64-js'

//------------------------------------------------------------------------------

abstract class AudioChannel {

  protected readonly audioFreq: number
  protected readonly samplesPerFrame: number

  protected _isEnabled = false
  protected audioCtx?: AudioContext

  protected prevCycleCount!: number

  private outSamples?: number[]
  private curBufferSize!: number
  private partialSampleSize!: number

  private lastBufferPushMs!: number
  private nextBufferStart!: number

  constructor(audioFreq: number) {
    this.audioFreq = audioFreq
    this.samplesPerFrame = audioFreq / 60
  }

  public reset() {
    this.prevCycleCount = 0
    this.outSamples = undefined
    this.curBufferSize = 0
    this.partialSampleSize = 0
    this.lastBufferPushMs = 0
    this.nextBufferStart = 0
  }

  public get isEnabled(): boolean {
    return this._isEnabled
  }

  public set isEnabled(toEnable: boolean) {
    if (toEnable != this._isEnabled) {
      this._isEnabled = toEnable
      if (toEnable) {
        if (!this.audioCtx) {
          this.audioCtx = new AudioContext()
        }
        this.reset()
        this.audioCtx.resume()
      } else {
        this.audioCtx!.suspend()
      }
    }
  }

  protected pushOutSample(outSample: number) {
    if (this.outSamples == undefined) {
      const frameSize = this.samplesPerFrame + this.partialSampleSize
      this.curBufferSize = Math.floor(frameSize)
      this.partialSampleSize = frameSize - this.curBufferSize
      this.outSamples = []
    }

    this.outSamples!.push(outSample)
    if (this.outSamples!.length == this.curBufferSize) {

      // if buffer push got delayed too much, push some silence to get ahead again
      // TODO: is two frames worth the right amount?
      const framesAhead = 2
      if (Date.now() - this.lastBufferPushMs >= 1000 / 60 * framesAhead ||
          this.nextBufferStart < this.audioCtx!.currentTime) {
        const bufferSize = Math.floor(this.samplesPerFrame * framesAhead)
        const audioBuffer = this.audioCtx!.createBuffer(1, bufferSize, Math.floor(this.audioFreq))
        const source = this.audioCtx!.createBufferSource()
        source.buffer = audioBuffer
        source.connect(this.audioCtx!.destination)
        this.nextBufferStart = this.audioCtx!.currentTime
        source.start(this.nextBufferStart)
        this.nextBufferStart += audioBuffer.duration
      }

      const audioBuffer = this.audioCtx!.createBuffer(1, this.outSamples!.length, Math.floor(this.audioFreq))
      audioBuffer.getChannelData(0).set(this.outSamples!)
      const source = this.audioCtx!.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioCtx!.destination)
      source.start(this.nextBufferStart)
      this.nextBufferStart += audioBuffer.duration
      this.lastBufferPushMs = Date.now()

      this.outSamples = undefined
    }
  }

  public getState(): any {
    return {}
  }

  public flattenState(state: any) {
  }

  public setState(state: any) {
  }
}

//------------------------------------------------------------------------------

const AppleFreq = 17030 * 60    // 1021800
const AppleFilterScale = 20

class AppleAudioChannel extends AudioChannel {

  private inSamples!: number[]
  private speakerLevel!: number
  private lastToggleCycle!: number

  constructor() {
    super(AppleFreq / AppleFilterScale)   // 51090Hz, 851.5
    this.reset()
  }

  public reset() {
    super.reset()

    this.inSamples = []
    this.speakerLevel = -1
    this.lastToggleCycle = 0
  }

  public toggle(cycleCount: number) {
    if (this._isEnabled) {
      this.update(cycleCount)
      this.speakerLevel = -this.speakerLevel
      this.lastToggleCycle = cycleCount
    }
  }

  public update(machineCycleCount: number) {
    if (this._isEnabled) {

      // check for decay to silence after last toggle
      let inSample = this.speakerLevel
      if (machineCycleCount - this.lastToggleCycle >= AppleFreq / 1000 * 12) {
        inSample = 0
      }

      let newSamples = machineCycleCount - this.prevCycleCount
      this.prevCycleCount = machineCycleCount

      while (--newSamples >= 0) {

        this.inSamples.push(inSample)

        // crudely box filter samples down from 1.0218Mhz to ~51Khz
        if (this.inSamples.length == AppleFilterScale) {
          let outSample = 0
          for (let i = 0; i < AppleFilterScale; i += 1) {
            outSample += this.inSamples[i]
          }
          this.inSamples = []
          outSample /= AppleFilterScale
          this.pushOutSample(outSample)
        }
      }
    }
  }
}

//------------------------------------------------------------------------------

// Maria clock: 7.16Mhz
// Tia audio:   3.1403Khz (3.58Mhz (Maria / 2) / 114)

const MariaFreq = 7160000

export class TiaAudioChannel extends AudioChannel {

  private static waveforms: Uint8Array[] = []

  private audioControl!: number
  private audioFrequency!: number
  private audioVolume!: number

  private sampleIndex!: number
  private sampleCount!: number
  private sampleValue!: number

  constructor() {
    super(MariaFreq / 2 / 114)     // 31403.51Hz, 523.39

    if (TiaAudioChannel.waveforms.length == 0) {
      for (const waveform of tiaAudioWaveforms) {
        TiaAudioChannel.waveforms.push(base64.toByteArray(waveform))
      }
    }
    this.reset()
  }

  public reset() {
    super.reset()

    this.audioControl = 0
    this.audioFrequency = 0
    this.audioVolume = 0
    this.sampleIndex = 0
    this.sampleCount = 0
    this.sampleValue = 0
  }

  public update(machineCycleCount: number) {
    if (this._isEnabled) {

      const audCycleCount = Math.floor(machineCycleCount / this.audioFreq)
      let newSamples = audCycleCount - this.prevCycleCount
      this.prevCycleCount = audCycleCount

      while (--newSamples >= 0) {

        if (this.sampleCount == 0) {
          const waveform = TiaAudioChannel.waveforms[this.audioControl]
          if (++this.sampleIndex == waveform.length) {
            this.sampleIndex = 0
            if (waveform.length == 1) {
              this.sampleValue = 0
            }
          }
          this.sampleCount = waveform[this.sampleIndex] << this.audioFrequency
          this.sampleValue = -this.sampleValue
        }

        this.sampleCount -= 1
        this.pushOutSample(this.sampleValue * this.audioVolume)
      }
    }
  }

  public set audc(value: number) {
    value &= 0xF
    if (value != this.audioControl) {
      this.audioControl = value
      this.sampleIndex = 0
      this.sampleCount = 0
      this.sampleValue = 1
    }
  }

  public set audf(value: number) {
    this.audioFrequency = value & 0xF
  }

  public set audv(value: number) {
    this.audioVolume = (value & 0xF) / 15
  }
}

// https://forums.atariage.com/topic/328014-questions-about-reading-tia-schematics/
//  search for "TIA Audio Waveforms"

const tiaAudioWaveforms = [
  "AQ==",
  "BAMBAgIBAQE=",
  "PiwSHx8NEg0+MQ0fHxINEg==",
  "DAUBAgUCAQEMBgECBQECAQoG" +
    "AwICBAECBgoBBAIBBAEGCgIE" +
    "AgEBBAUJAwMEAQEBCAUFBQQB" +
    "AQEIBAIIAwMBAQcEAgcFAQMB" +
    "BwQBBAgCAQMEBwEDBwMCAQYG" +
    "AgIEBQMCBgYBAwMCBQMHAwQD" +
    "AgICBQkDAQUDAQICCwUBBQMB" +
    "AQI=",
  "AQE=",
  "AQE=",
  "DRI=",
  "BAECAQECAgUDAgEDAQEBAQ==",
  "CQUEAQUDAQEDAgICAQUBAgEB" +
    "AQIDAQIBAQMEAgUCAgECAwEB" +
    "AQEBAgEDAwMCAQIBAQEBAQMD" +
    "AQICAwEDAQgBBAEDAgQBAgMC" +
    "AQEBAQEBAgQCAQQBAQICAQMC" +
    "AQMBAQEEAQEBAQIBAQIGAQIC" +
    "AQIBAgEBAgEGAgECAgEBAQEC" +
    "AgICBwIDAgIBAQEDAgEBAgEB" +
    "BwEBAwEBAgMDAQEBAgIBAQIC" +
    "BAMFAQMBAQUCAQEBAgECAQMB" +
    "AgUBAQIBAQEFAQEBAQEBAQEG" +
    "AQEBAgEBAQEEAgEBAwEDBgMC" +
    "AwEBAgECBAEBAQMBAQEBAwEC" +
    "AQQCAgMEAQEEAQIBAgICAQEE" +
    "AwEEBA==",
  "BQMCAQMBAQEBBAECAQECAg==",
  "DRI=",
  "AQ==",
  "AwM=",
  "AwM=",
  "LDE=",
  "CgYDBgQJBgUGBAUKBQMHBA=="
]

//------------------------------------------------------------------------------

// TODO: PokeyAudioChannel
