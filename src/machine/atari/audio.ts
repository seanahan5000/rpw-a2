
import * as base64 from 'base64-js'
// import { POKEY } from './pokey'

// *** state save/restore ***

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

    this.outSamples.push(outSample)
    if (this.outSamples.length == this.curBufferSize) {

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

      const audioBuffer = this.audioCtx!.createBuffer(1, this.outSamples.length, Math.floor(this.audioFreq))
      audioBuffer.getChannelData(0).set(this.outSamples)
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
    // ***
    return {}
  }

  // public flattenState(state: any) {
  // }

  public setState(state: any) {
    // ***
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

  public getState(): any {
    // ***
    return {}
  }

  // public flattenState(state: any) {
  // }

  public setState(state: any) {
    // ***
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

// master freq: 14318181
// maria freq:   7159090 (master / 2) (454 scanline cycles is in this clock)
// tia freq:     3579545 (master / 4) (226 scanline cycles is in this clock)
// cpu26 freq:   1193182 (master / 12) (tia / 3)
// cpu78 freq:   1789772 (master / 8) (maria / 4)
// pokey freq:   1789772 (master / 8) (maria / 4)

// adjusted values
// maria freq:   7164120 (454 * 263 * 60)
// tia freq:     3582060 (maria / 2)
// cpu26 freq:   1194020 (tia / 3)
// cpu78 freq:   1791030 (maria / 4)
// pokey freq:   1791030 (maria / 4)

//------------------------------------------------------------------------------

export enum TiaReg {
  audc0 = 0x15,     // 0x15 - AUDIO CONTROL CHANNEL 0     WO
  audc1,            // 0x16 - AUDIO CONTROL CHANNEL 1     WO
  audf0,            // 0x17 - AUDIO FREQUENCY CHANNEL 0   WO
  audf1,            // 0x18 - AUDIO FREQUENCY CHANNEL 1   WO
  audv0,            // 0x19 - AUDIO VOLUME CHANNEL 0      WO
  audv1,            // 0x1A - AUDIO VOLUME CHANNEL 1      WO
}

const tiaDownsample = 32
const tiaFreq = 3582060
const tiaAudioFreq = Math.floor(tiaFreq / 3 / tiaDownsample)  // 37313.125
const tiaScale = tiaDownsample / 2 / 255

export class TiaAudio extends AudioChannel {

  private audf: number[] = Array(2)
  private audc: number[] = Array(2)
  private audv: number[] = Array(2)
  private runningSample = 0
  private runningCount = 0

  constructor() {
    super(tiaAudioFreq)
  }

  public reset() {
    super.reset()

    this.audf.fill(0)
    this.audc.fill(0)
    this.audv.fill(0)
    this.runningSample = 0
    this.runningCount = 0
  }

  public getState(): any {
    // ***
    return {}
  }

  // public flattenState(state: any) {
  // }

  public setState(state: any) {
    // ***
  }

  public update(mariaCycles: number) {
    // *** extra div 3? ***
    const tiaCycles = mariaCycles >> 1
    // ***

    let sample = 0

    // *** add each channels portion

    this.runningSample += sample
    this.runningCount += 1
    if (this.runningCount == PokeyFilterScale) {
      const outSample = this.runningSample / tiaScale
      this.pushOutSample(outSample)
      this.runningSample = 0
      this.runningCount = 0
    }
  }

  public write(address: number, value: number) {
    switch (address) {
      case TiaReg.audc0:
        this.audc[0] = value
        break
      case TiaReg.audc1:
        this.audc[1] = value
        break
      case TiaReg.audf0:
        this.audf[0] = value
        break
      case TiaReg.audf1:
        this.audf[1] = value
        break
      case TiaReg.audv0:
        this.audv[0] = value
        break
      case TiaReg.audv1:
        this.audv[1] = value
        break
    }
  }

  public readConst(address: number): number {
    return this.read(address)
  }

  public read(address: number): number {
    switch (address) {
      case TiaReg.audc0:
        return this.audc[0]
      case TiaReg.audc1:
        return this.audc[1]
      case TiaReg.audf0:
        return this.audf[0]
      case TiaReg.audf1:
        return this.audf[1]
      case TiaReg.audv0:
        return this.audv[0]
      case TiaReg.audv1:
        return this.audv[1]
    }
    return 0xee
  }
}

//------------------------------------------------------------------------------

export enum PokeyWReg {
  audf1       = 0x00,
  audc1       = 0x01,
  audf2       = 0x02,
  audc2       = 0x03,
  audf3       = 0x04,
  audc3       = 0x05,
  audf4       = 0x06,
  audc4       = 0x07,
  audctl      = 0x08,
  stimer      = 0x09,
  skres       = 0x0A,
  potgo       = 0x0B,
  serout      = 0x0D,
  irqen       = 0x0E,
  skctl       = 0x0F,
}

export enum PokeyRReg {
  pot0        = 0x00,
  pot1        = 0x01,
  pot2        = 0x02,
  pot3        = 0x03,
  pot4        = 0x04,
  pot5        = 0x05,
  pot6        = 0x06,
  pot7        = 0x07,
  allpot      = 0x08,
  kbcode      = 0x09,
  random      = 0x0A,
  serin       = 0x0D,
  irqst       = 0x0E,
  skstat      = 0x0F,
}

export enum SkCtlMask {
  TWO_TONE    = 0x08,
  RESET       = 0x03,
}

export enum AudCtlMask {
  POLY9       = 0x80,
  CH1_HICLK   = 0x40,
  CH3_HICLK   = 0x20,
  CH12_JOINED = 0x10,
  CH34_JOINED = 0x08,
  CH1_FILTER  = 0x04,
  CH2_FILTER  = 0x02,
  CLOCK_15KHZ = 0x01,
}

export enum AudcMask {
  NOTPOLY5    = 0x80,
  POLY4       = 0x40,
  PURE        = 0x20,
  VOLUME_ONLY = 0x10,
  VOLUME_MASK = 0x0F,
}

const DIV_64  = 28      // *** divisor for 1.78979 MHz clock to 63.9211 KHz
const DIV_15  = 114     // *** divisor for 1.78979 MHz clock to 15.6999 KHz

const CLK_1   = 0
const CLK_28  = 1
const CLK_114 = 2

const PCHAN1  = 0
const PCHAN2  = 1
const PCHAN3  = 2
const PCHAN4  = 3

const PokeyFilterScale = 36//32    // *** maybe 36? ***
const PokeyFreq = 1791030
const pokeyAudioFreq = Math.floor(PokeyFreq / PokeyFilterScale) // 55969.6875

export class PokeyAudio extends AudioChannel {

  private lastPokeyCycles = 0

  private skctl = 0
  private audctl = 0
  private audf: number[] = Array(4)
  private audc: number[] = Array(4)

  private clockCount: number[] = Array(4)
  private divCount: number[] = Array(4)
  private borrowCount: number[] = Array(4)
  private filter: number[] = Array(4)
  private output: number[] = Array(4)

  private poly4: number[] = Array(0x0f)
  private poly5: number[] = Array(0x01f)
  private poly9: number[] = Array(0x1ff)
  private poly17: number[] = Array(0x1ffff)
  private p4Counter = 0
  private p5Counter = 0
  private p9Counter = 0
  private p17Counter = 0

  private runningSample = 0
  private runningCount = 0

  constructor() {
    super(pokeyAudioFreq)
    this.initPoly()
  }

  public reset() {
    super.reset()

    this.lastPokeyCycles = -1

    this.skctl = 0
    this.audctl = 0
    this.audf.fill(0)
    this.audc.fill(0)

    this.clockCount.fill(0)
    this.divCount.fill(0)
    this.borrowCount.fill(0)
    this.filter = [1, 1, 0, 0]
    this.output.fill(0)

    this.p4Counter = 0
    this.p5Counter = 0
    this.p9Counter = 0
    this.p17Counter = 0

    this.runningSample = 0
    this.runningCount = 0
  }

  public getState(): any {
    // ***
    return {}
  }

  // public flattenState(state: any) {
  // }

  public setState(state: any) {
    // ***
  }

  public update(mariaCycles: number) {

    // TODO: figure out why this goes negative if mariaCycles gets too large
    // const pokeyCycles = mariaCycles >> 2
    const pokeyCycles = Math.floor(mariaCycles / 4)

    if (this.lastPokeyCycles < 0) {
      this.lastPokeyCycles = pokeyCycles
      return
    }

    let pcount = pokeyCycles - this.lastPokeyCycles
    this.lastPokeyCycles = pokeyCycles

    while (--pcount >= 0) {

      if (this.skctl & SkCtlMask.RESET) {

        if (++this.p4Counter == 0x0f) {
          this.p4Counter = 0
        }
        if (++this.p5Counter == 0x01f) {
          this.p5Counter = 0
        }
        if (++this.p9Counter == 0x01ff) {
          this.p9Counter = 0
        }
        if (++this.p17Counter == 0x01ffff) {
          this.p17Counter = 0
        }

        const triggered = [true, false, false]

        if (++this.clockCount[CLK_28] >= DIV_64) {
          this.clockCount[CLK_28] = 0
          triggered[CLK_28] = true
        }
        if (++this.clockCount[CLK_114] >= DIV_15) {
          this.clockCount[CLK_114] = 0
          triggered[CLK_114] = true
        }

        const baseClock = (this.audctl & AudCtlMask.CLOCK_15KHZ) ? CLK_114 : CLK_28

        if (this.audctl & AudCtlMask.CH1_HICLK) {
          if (this.audctl & AudCtlMask.CH12_JOINED) {
            this.incChannel(PCHAN1, 7)
          } else {
            this.incChannel(PCHAN1, 4)
          }
        } else if (triggered[baseClock]) {
          this.incChannel(PCHAN1, 1)
        }

        if (this.audctl & AudCtlMask.CH3_HICLK) {
          if (this.audctl & AudCtlMask.CH34_JOINED) {
            this.incChannel(PCHAN3, 7)
          } else {
            this.incChannel(PCHAN3, 4)
          }
        } else if (triggered[baseClock]) {
          this.incChannel(PCHAN3, 1)
        }

        if (triggered[baseClock]) {
          if (!(this.audctl & AudCtlMask.CH12_JOINED)) {
            this.incChannel(PCHAN2, 1)
          }
          if (!(this.audctl & AudCtlMask.CH34_JOINED)) {
            this.incChannel(PCHAN4, 1)
          }
        }
      }

      if (this.checkBorrow(PCHAN3)) {
        if (this.audctl & AudCtlMask.CH34_JOINED) {
          this.incChannel(PCHAN4, 1)
        } else {
          this.resetChannel(PCHAN3)
        }
        this.processChannel(PCHAN3)
        if (this.audctl & AudCtlMask.CH1_FILTER) {
          this.filter[PCHAN1] = this.output[PCHAN1]
        } else {
          this.filter[PCHAN1] = 1
        }
      }

      if (this.checkBorrow(PCHAN4)) {
        if (this.audctl & AudCtlMask.CH34_JOINED) {
          this.resetChannel(PCHAN3)
        }
        this.resetChannel(PCHAN4)
        this.processChannel(PCHAN4)
        if (this.audctl & AudCtlMask.CH2_FILTER) {
          this.filter[PCHAN2] = this.output[PCHAN2]
        } else {
          this.filter[PCHAN2] = 1
        }
      }

      if (this.skctl & SkCtlMask.TWO_TONE && this.borrowCount[PCHAN2] == 1) {
        this.resetChannel(PCHAN1)
      }

      if (this.checkBorrow(PCHAN1)) {
        if (this.audctl & AudCtlMask.CH12_JOINED) {
          this.incChannel(PCHAN2, 1)
        } else {
          this.resetChannel(PCHAN1)
        }
        this.processChannel(PCHAN1)
      }

      if (this.checkBorrow(PCHAN2)) {
        if (this.audctl & AudCtlMask.CH12_JOINED) {
          this.resetChannel(PCHAN1)
        }
        this.resetChannel(PCHAN2)
        this.processChannel(PCHAN2)
      }

      // NOTE: need to at least advance poly counters
      //  even if sound is disabled
      if (!this._isEnabled) {
        continue
      }

      let sample = 0
      for (let i = 0; i < 4; i += 1) {
        if ((this.output[i] ^ this.filter[i]) || (this.audc[i] & AudcMask.VOLUME_ONLY)) {
          sample += (this.audc[i] & AudcMask.VOLUME_MASK) << 2  // *** 3 when joined?
        }
      }
      this.runningSample += sample
      this.runningCount += 1
      if (this.runningCount == PokeyFilterScale) {
        const outSample = this.runningSample / PokeyFilterScale / 255
        this.pushOutSample(outSample)
        this.runningSample = 0
        this.runningCount = 0
      }
    }
  }

  private incChannel(channel: number, cycles: number) {
    this.divCount[channel] = (this.divCount[channel] + 1) & 0xff
    if (this.divCount[channel] == 0 && this.borrowCount[channel] == 0) {
      this.borrowCount[channel] = cycles
    }
  }

  private checkBorrow(channel: number): boolean {
    if (this.borrowCount[channel] > 0) {
      this.borrowCount[channel] -= 1
      return this.borrowCount[channel] == 0
    }
    return false
  }

  private resetChannel(channel: number) {
    this.divCount[channel] = this.audf[channel] ^ 0xff
    this.borrowCount[channel] = 0
  }

  private processChannel(channel: number) {
    if ((this.audc[channel] & AudcMask.NOTPOLY5) || (this.poly5[this.p5Counter] & 1)) {
      if (this.audc[channel] & AudcMask.PURE) {
        this.output[channel] ^= 1
      } else if (this.audc[channel] & AudcMask.POLY4) {
        this.output[channel] = this.poly4[this.p4Counter] & 1
      } else if (this.audctl & AudCtlMask.POLY9) {
        this.output[channel] = this.poly9[this.p9Counter] & 1
      } else {
        this.output[channel] = this.poly17[this.p17Counter] & 1
      }
    }
  }

  public write(address: number, value: number) {

    switch (address) {
      case PokeyWReg.audf1:    // 0x00
        this.audf[0] = value
        break
      case PokeyWReg.audc1:    // 0x01
        this.audc[0] = value
        break
      case PokeyWReg.audf2:    // 0x02
        this.audf[1] = value
        break
      case PokeyWReg.audc2:    // 0x03
        this.audc[1] = value
        break
      case PokeyWReg.audf3:    // 0x04
        this.audf[2] = value
        break
      case PokeyWReg.audc3:    // 0x05
        this.audc[2] = value
        break
      case PokeyWReg.audf4:    // 0x06
        this.audf[3] = value
        break
      case PokeyWReg.audc4:    // 0x07
        this.audc[3] = value
        break

      case PokeyWReg.audctl:   // 0x08
        this.audctl = value
        break

      case PokeyWReg.stimer:   // 0x09
      case PokeyWReg.skres:    // 0x0A
      case PokeyWReg.potgo:    // 0x0B
      case PokeyWReg.serout:   // 0x0D
      case PokeyWReg.irqen:    // 0x0E
        break

      case PokeyWReg.skctl:    // 0x0F
        this.skctl = value
        break
    }
  }

  public readConst(address: number): number {
    switch (address) {
      case PokeyWReg.audf1:    // 0x00
        return this.audf[0]
      case PokeyWReg.audc1:    // 0x01
        return this.audc[0]
      case PokeyWReg.audf2:    // 0x02
        return this.audf[1]
      case PokeyWReg.audc2:    // 0x03
        return this.audc[1]
      case PokeyWReg.audf3:    // 0x04
        return this.audf[2]
      case PokeyWReg.audc3:    // 0x05
        return this.audc[2]
      case PokeyWReg.audf4:    // 0x06
        return this.audf[3]
      case PokeyWReg.audc4:    // 0x07
        return this.audc[3]

      case PokeyWReg.audctl:   // 0x08
        return this.audctl

      case PokeyRReg.random:   // 0x0A
        return this.getRandom()

      case PokeyWReg.skctl:    // 0x0F
        return this.skctl
    }
    return 0xEE
  }

  public read(address: number, cycleCount: number): number {
    switch (address) {
      case PokeyRReg.pot0:     // 0x00
      case PokeyRReg.pot1:     // 0x01
      case PokeyRReg.pot2:     // 0x02
      case PokeyRReg.pot3:     // 0x03
      case PokeyRReg.pot4:     // 0x04
      case PokeyRReg.pot5:     // 0x05
      case PokeyRReg.pot6:     // 0x06
      case PokeyRReg.pot7:     // 0x07
      case PokeyRReg.allpot:   // 0x08
      case PokeyRReg.kbcode:   // 0x09
        break

      case PokeyRReg.random:   // 0x0A
        return this.getRandom()

      case PokeyRReg.serin:    // 0x0D
      case PokeyRReg.irqst:    // 0x0E
      case PokeyRReg.skstat:   // 0x0F
        break
    }
    return 0xEE
  }

  // *** docs say returned value should be inverted from poly? ***
  private getRandom(): number {
    if (this.skctl & SkCtlMask.RESET) {
      if (this.audctl & AudCtlMask.POLY9) {
        return this.poly9[this.p9Counter] & 0xff
      } else {
        return (this.poly17[this.p17Counter] >> 8) & 0xff
      }
    } else {
      return 0xFF
    }
  }

  private initPoly() {
    // poly 4
    {
      const mask = (1 << 4) - 1
      let lfsr = 0
      for (let i = 0; i < mask; i++) {
        lfsr = (lfsr << 1) | (~((lfsr >> 2) ^ (lfsr >> 3)) & 1)
        this.poly4[i] = lfsr & mask
      }
    }
    // poly 5
    {
      const mask = (1 << 5) - 1
      let lfsr = 0
      for (let i = 0; i < mask; i++) {
        lfsr = (lfsr << 1) | (~((lfsr >> 2) ^ (lfsr >> 4)) & 1)
        this.poly5[i] = lfsr & mask
      }
    }
    // poly 9
    {
      const mask = (1 << 9) - 1
      let lfsr = mask
      for (let i = 0; i < mask; i++) {
        const bin = ((lfsr >> 0) & 1) ^ ((lfsr >> 5) & 1)
        lfsr = lfsr >> 1
        lfsr = (bin << 8) | lfsr
        this.poly9[i] = lfsr
      }
    }
    // poly 17
    {
      const mask = (1 << 17) - 1
      let lfsr = mask
      for (let i = 0; i < mask; i++) {
        const bin8 = ((lfsr >> 8) & 1) ^ ((lfsr >> 13) & 1)
        const bin = (lfsr & 1)
        lfsr = lfsr >> 1
        lfsr = (lfsr & 0xff7f) | (bin8 << 7)
        lfsr = (bin << 16) | lfsr
        this.poly17[i] = lfsr
      }
    }
  }
}

//------------------------------------------------------------------------------

// Maria clock: 7.16Mhz
// CPU fast: Maria / 4 = 1.791030Mhz      //***1.79Mhz
// CPU slow/Tia: Maria / 6 = 1.194020Mhz  //***1.19333Mhz

const MariaFreq = 7164120   //***7160000

export class TiaAudioChannel extends AudioChannel {

  private static waveforms: Uint8Array[] = []

  private audioControl!: number
  private audioFrequency!: number
  private audioVolume!: number

  private sampleIndex!: number
  private sampleCount!: number
  private sampleValue!: number

  constructor() {
    // 263 * 60 * 2 = 31560
    super(MariaFreq / 6 / 31)     // *** 49750.83, 829.18 samples per frame    //***49722.22Hz, 828.70 samples per frame

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

      const tiaCycleCount = Math.floor(machineCycleCount / 6 / 31)

      let newSamples = tiaCycleCount - this.prevCycleCount
      this.prevCycleCount = tiaCycleCount

      while (--newSamples >= 0) {

        if (this.sampleCount == 0) {
          const waveform = TiaAudioChannel.waveforms[this.audioControl]
          if (++this.sampleIndex == waveform.length) {
            this.sampleIndex = 0
            if (waveform.length == 1) {
              this.sampleValue = 0
            }
          }
          this.sampleCount = waveform[this.sampleIndex] * (this.audioFrequency + 1)
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
      // this.sampleCount = 0
      if (this.sampleValue == 0) {
        this.sampleValue = 1
      }
    }
  }

  public set audf(value: number) {
    this.audioFrequency = value & 0x1F
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
