
import * as base64 from 'base64-js'
import { IClock, IMemory, ICpu } from "../../shared/types"
import { Point, Size, Rect, PixelData } from "../../shared/types"
import { Machine, base64FromUint8 } from "../machine"
import { DisplayClock } from "../clock"
import { Cpu65xx } from "../cpu65xx"
import { Isa6502 } from "../isa65xx"
import { Maria, MariaReg } from "./maria"
import { Tia } from "./tia"
import { Pia } from "./pia"
import { createCart } from "./cart"
import { DisplayView } from "../../display/display_view"
import { ColorPattern, DisplayFormat, Bitmap } from "../../display/format"
import { TiaAudioChannel, PokeyAudio } from "./audio"
import { Cart } from "./cart"
import { hscRomImage } from "./hsc"
import { CoordinateInfo } from '../../display/display'
import { Tool } from '../../display/tools'

//------------------------------------------------------------------------------

export class AtariMachine extends Machine implements IMemory {

  public displayClock: AtariDisplayClock
  private _cpu: Cpu65xx
  public proMode: boolean
  public maria: Maria
  public tia: Tia
  private pia: Pia
  private cart?: Cart

  private audio0: TiaAudioChannel
  private audio1: TiaAudioChannel
  private pokeyAudio: PokeyAudio

  private ram: Uint8Array = new Uint8Array(0x1000)
  private inputs: number[] = new Array(6).fill(0xff)

  private hscRom: Uint8Array
  private hscSram: Uint8Array = new Uint8Array(0x0800).fill(0)
  private hscDirty: boolean = false

  constructor() {
    super()
    this._cpu = new Cpu65xx(new Isa6502(), this)
    this.proMode = true
    this.maria = new Maria(this)
    this.tia = new Tia(this)
    this.pia = new Pia()

    this.audio0 = new TiaAudioChannel()
    this.audio1 = new TiaAudioChannel()

    this.pokeyAudio = new PokeyAudio()

    this.hscRom = base64.toByteArray(hscRomImage.join(""))
    // if (fs.existsSync("hscsram.bin")) {
    //   this.hscSram = fs.readFileSync("hscsram.bin")
    // }

    // NOTE: this.displayClock must be created after this._cpu
    this.displayClock = new AtariDisplayClock(this)

    this.displayClock.on("start", () => {
      this.trimStates()
    })
  }

  public setCartImage(data: Uint8Array, startClock: boolean) {
    this.cart = createCart(data)
    this.proMode = this.cart.getMachineType() == "atari7800"
    this.reset(true)
    if (startClock) {
      this.displayClock.start()
    }
  }

  public setDiskCartImage(
      fullPath: string,
      dataBytes: Uint8Array,
      driveIndex?: number,
      onWrite?: (newDataBytes: Uint8Array) => void) {
    this.setCartImage(dataBytes, true)
  }

  public reset(hardReset: boolean): void {
    this.ram.fill(0)
    this.inputs.fill(0xff)    // *** don't reset difficulty switches ***
    this.audio0.reset()
    this.audio1.reset()
    this.pokeyAudio.reset()
    this.maria.reset()
    this.tia.reset()
    this.pia.reset()
    this.cpu.reset()
    this.clock.reset(hardReset)
    // this.displayGen.update(this._cpu.cycles, true)
  }

  public update(cycleCount: number): void {
    this.audio0.update(cycleCount)
    this.audio1.update(cycleCount)
    if (this.proMode) {
      this.pokeyAudio.update(cycleCount)        // *** maria cycles???
      // TODO: could do this less frequently
      if (this.hscDirty) {
        // fs.writeFileSync("hscsram.bin", this.hscSram)
        this.hscDirty = false
      }
    } else {
      // *** maybe have tia call pia.update? ***
      this.pia.update(cycleCount)
      this.tia.update(cycleCount)
    }
    // const newVblank = this.displayGen.update(cycleCount, forceRedraw)
    // if (newVblank) {
    //   this.snapState(this.displayGen.frameNumber)
    // }
  }

  public get clock(): IClock {
    return this.displayClock
  }

  public get cpu(): ICpu {
    return this._cpu
  }

  public get memory(): IMemory {
    return this
  }

  public setView(displayView: DisplayView) {
    this.displayClock.setView(displayView)
  }

  // NOTE: used by Maria
  public inVBlank(): boolean {
    return this.displayClock.inVBlank
  }

  public readConst(address: number): number {
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {
    // *** update first here? ***
    // if (cycleCount != 0) {
    //   this.update(cycleCount, false)
    // }

    // TODO: throw error if wrapping?
    address &= 0xffff

    if (cycleCount) {
      if (this.checkDataBreakpoints(address, 1)) {
        this.clock.stop("dataBreakpoint")
      }
    }

    if (this.proMode) {
      const page = address & 0xff00
      if (page >= 0x4000) {
        // TODO: optional pokey chip at 0x4000?
        return this.cart?.read(address, cycleCount) ?? 0xEE
      } else if (page >= 0x3000) {
        return this.hscRom[address - 0x3000]
      } else if (page >= 0x1800) {
        if (page < 0x2800) {
          return this.ram[address - 0x1800]
        } else {
          return this.ram[address - 0x2000]
        }
      } else if (page >= 0x1000) {
        return this.hscSram[address - 0x1000]
      } else if (page >= 0x0400) {
        if (address >= 0x0450 && address <= 0x045F) {
          return this.pokeyAudio.read(address - 0x0450, cycleCount)
        } else {
          return 0xEE
        }
      } else if (page >= 0x0200) {
        return this.pia.read(address, cycleCount)
      } else if ((address & ~0x0100) < 0x40) {
        return this.maria.read(address, cycleCount)
      } else {
        return this.ram[address + 0x0800]
      }
    } else {
      address &= 0x1fff
      if (address & 0x1000) {
        return this.cart?.read(address, cycleCount) ?? 0xEE
      } else if (address & 0x80) {
        if (address & 0x200) {
          return this.pia.read(address, cycleCount)
        } else {
          return this.ram[address & 0x7f]
        }
      } else {
        return this.tia.read(address, cycleCount)
      }
    }
  }

  public write(address: number, value: number, cycleCount: number): void {

    // *** update first here? ***
    // if (cycleCount != 0) {
    //   this.update(cycleCount, false)
    // }

    // TODO: throw error if wrapping?
    address &= 0xffff

    if (cycleCount) {
      if (this.checkDataBreakpoints(address, 2)) {
        this.clock.stop("dataBreakpoint")
      }
    }

    if (this.proMode) {
      const page = address & 0xff00
      if (page >= 0x4000) {
        // TODO: optional pokey chip at 0x4000?
        this.cart?.write(address, value, cycleCount)
      } else if (page >= 0x3000) {
        // ignore HSC ROM writes
      } else if (page >= 0x1800) {
        if (page < 0x2800) {
          this.ram[address - 0x1800] = value
        } else {
          this.ram[address - 0x2000] = value
        }
      } else if (page >= 0x1000) {
        this.hscSram[address - 0x1000] = value
        this.hscDirty = true
      } else if (page >= 0x0400) {
        if (address >= 0x0450 && address <= 0x045F) {
          this.pokeyAudio.write(address - 0x0450, value)
        }
      } else if (page >= 0x0200) {
        this.pia.write(address, value , cycleCount)
      } else if ((address & ~0x0100) < 0x40) {
        this.maria.write(address, value, cycleCount)
      } else {
        this.ram[address + 0x0800] = value
      }
    } else {
      address &= 0x1fff
      if (address & 0x1000) {
        this.cart?.write(address, value, cycleCount)
      } else if (address & 0x80) {
        if (address & 0x200) {
          this.pia.write(address, value, cycleCount)
        } else {
          this.ram[address & 0x7f] = value
        }
      } else {
        this.tia.write(address, value, cycleCount)
      }
    }
  }

  // *** call through to audio driver ***
  public writeTiaAudio(address: number, value: number) {
    // NOTE: update will have already happened
    switch (address) {
      case MariaReg.audc0:
        this.audio0.audc = value
        break
      case MariaReg.audc1:
        this.audio1.audc = value
        break
      case MariaReg.audf0:
        this.audio0.audf = value
        break
      case MariaReg.audf1:
        this.audio1.audf = value
        break
      case MariaReg.audv0:
        this.audio0.audv = value
        break
      case MariaReg.audv1:
        this.audio1.audv = value
        break
    }
  }

  public readRange(address: number, length: number): Uint8Array {
    if (this.cart) {
      return this.cart.readRange(address, length)
    }
    return new Uint8Array(length).fill(0xee)
  }

  public writeRange(address: number, data: Uint8Array | number[]): void {
    if ((address & 0xF000) || address < 0) {
      if (data instanceof Array) {
        data = new Uint8Array(data)
      }
      this.setCartImage(data, false)
    }
  }

  public get soundEnabled(): boolean {
    return this.audio0.isEnabled
  }

  public set soundEnabled(enabled: boolean) {
    this.audio0.isEnabled = enabled
    this.audio1.isEnabled = enabled
    this.pokeyAudio.isEnabled = enabled
  }

  // state handling

  public getState(): any {
    let state: any = {}
    state.proMode = this.proMode
    state.inputs = [...this.inputs]
    state.ramBytes = new Uint8Array(this.ram)
    if (this.cart) {
      state.cart = this.cart.getState()
    }
    state.displayClock = this.displayClock.getState()
    state.cpu = this._cpu.getStateCpu()
    state.maria = this.maria.getState()
    state.tia = this.tia.getState()
    state.pia = this.pia.getState()
    state.audio0 = this.audio0.getState()
    state.audio1 = this.audio1.getState()

    // TODO: get hscSram and hscDirty?
    return state
  }

  public async flattenState(state: any): Promise<void> {
    if (state.ramBytes) {
      state.ramString = await base64FromUint8(state.ramBytes)
      delete state.ramBytes
    }
    if (this.cart) {
      this.cart.flattenState(state.cart)
    }
    await this.displayClock.flattenState(state.displayClock)
    await this._cpu.flattenState(state.cpu)

    // TODO: flatten hscSram?
  }

  public setState(state: any): void {
    this.proMode = state.proMode
    this.inputs = [...state.inputs]
    if (state.ramString) {
      this.ram = base64.toByteArray(state.ramString)
    } else {
      this.ram = new Uint8Array(state.ramBytes)
    }
    if (this.cart && state.cart) {
      this.cart.setState(state.cart)
    }
    this.displayClock.setState(state.displayClock)
    this._cpu.setState(state.cpu)
    this.maria.setState(state.maria)
    this.tia.setState(state.tia)
    this.pia.setState(state.pia)
    this.audio0.setState(state.audio0)
    this.audio1.setState(state.audio1)

    // TODO: set hscSram and hscDirty?
  }

  // input handling

  public getSwitches(): number {
    return this.pia.getSwitches()
  }

  public setSwitches(switches: number) {
    this.pia.setSwitches(switches)
  }

  public getJoysticks(): number {
    return this.pia.getJoysticks()
  }

  public setJoysticks(joysticks: number) {
    this.pia.setJoysticks(joysticks)
  }

  public setInput(index: number, value: number) {
    // *** store in some registers?
    this.inputs[index] = value
  }

  public readInput(address: number): number {
    return this.inputs[(address & 0xF) - MariaReg.inpt0]
  }
}

//------------------------------------------------------------------------------

const AtariActiveLines = 25 + 192 + 26  // 243

class AtariDisplayClock extends DisplayClock {

  private atari: AtariMachine

  private dmaComplete: boolean = false
  private wasHalted: boolean = false

  private bitmap?: Bitmap
  private curPixels: Uint8Array = new Uint8Array(320 * AtariActiveLines)
  private prevPixels: Uint8Array = new Uint8Array(320 * AtariActiveLines)

  constructor(machine: AtariMachine) {
    // *** change cpuScale if not in proMode (to 6?) ***
    // *** how does this work with Tia generating vblank?
    // *** 243 changed to 242 because Joust expected exact timing of vblank
    //  *** after NMI on line 239
    super(machine, 454, 242/*243*/, 263, 60, 4)
    this.atari = machine

    machine.cpu.on("halt", (cycleCount: number): number => {
      return this.onHalt(cycleCount)
    })

    // TODO: clean up this hack that updates palette on stop
    this.on("stop", () => {
      if (this.bitmap && this.bitmap.format instanceof Atari2600Format) {
        this.bitmap.format.update()
        this.displayView?.prepareDisplay()
      }
    })
  }

  public reset(hardReset: boolean) {
    super.reset(hardReset)
    this.dmaComplete = false
    this.wasHalted = false
  }

  public getState(): any {
    let state: any = {}
    state.displayClock = super.getState()
    state.dmaComplete = this.dmaComplete
    state.wasHalted = this.wasHalted
    state.curPixels = new Uint8Array(this.curPixels)
    state.prevPixels = new Uint8Array(this.prevPixels)
    return state
  }

  public async flattenState(state: any) {
    // NOTE: super classes don't flattenState

    if (state.curPixels) {
      state.curPixelsString = await base64FromUint8(state.curPixels)
      delete state.curPixels
    }
    if (state.prevPixels) {
      state.prevPixelsString = await base64FromUint8(state.prevPixels)
      delete state.prevPixels
    }
  }

  public setState(state: any) {
    super.setState(state.displayClock)

    this.dmaComplete = state.dmaComplete
    this.wasHalted = state.wasHalted

    if (state.curPixelsString) {
      this.curPixels = base64.toByteArray(state.curPixelsString)
    } else {
      this.curPixels = new Uint8Array(state.curPixels)
    }

    if (state.prevPixelsString) {
      this.prevPixels = base64.toByteArray(state.prevPixelsString)
    } else {
      this.prevPixels = new Uint8Array(state.prevPixels)
    }

    // this.displayView?.update()    // ***
    this.updateDisplay(false)
  }

  // TODO: bother with adjusting CPU clock down on Tia access?
  protected advanceClock(): string {
    let stopReason = ""
    do {

      if (this.atari.proMode) {

        // give CPU chance to run at start of line before DMA begins
        //  7 cpu cycles - 2 cycles for min op duration
        let inHBlank = this.lineCycles <= (28 - 8)

        if (inHBlank ||
            this.inVBlank ||
            (this.dmaComplete && this.lineCycles <= 454)) {
          const cycleDelta = this.oneInstruction()
          this.lineCycles += cycleDelta
          inHBlank = this.lineCycles <= (28 - 8)
        }

        if (!this.dmaComplete && !this.inVBlank && (!inHBlank || this.wasHalted)) {
          const holdCycles = this.lineCycles

          const result = this.atari.maria.buildScanline(this.lineCycles, this.lineNumber == 0)
          const dstOffset = this.lineNumber * 320
          for (let i = 0; i < 320; i += 1) {
            this.curPixels[dstOffset + i] = result.scanline[i]
          }
          this.lineCycles = result.lineCycles
          this.clockCycles += this.lineCycles - holdCycles
          this.dmaComplete = true
          if (result.interrupt) {
            this.atari.cpu.raiseNMI()
          }
        }

        if (this.wasHalted && (this.dmaComplete || this.inVBlank)) {
          this.clockCycles += 454 - this.lineCycles
          this.lineCycles = 454
          this.wasHalted = false
        }

        const result = this.updateCycles()
        stopReason = result.stopReason
        if (result.newFrame) {

          // *** is this happening too late? after snapState()? ***
          this.atari.maria.onFrameEnd()

          // *** copy instead -- gray out on copy ***
          const prevPixels = this.prevPixels
          this.prevPixels = this.curPixels
          this.curPixels = prevPixels
        }
        if (result.newLine) {
          this.dmaComplete = false
        }

      } else {
        // *** 2600
        // this.pia.update(cycleCount)
        // this.tia.update(cycleCount)
      }

    } while (!stopReason)
    return stopReason
  }

  public onHalt(cycleCount: number): number {
    if (this.atari.proMode) {
      this.wasHalted = true
      return cycleCount
    } else {
      // *** convert from maria cycles to cpu cycles? ***
      return this.atari.tia.onHalt(cycleCount)
    }
  }

  protected override updateDisplay(partial: boolean) {
    if (!this.inVBlank) {

      this.readFrame(partial)

      this.displayView?.setFrame(this.bitmap!, undefined,
        (frame: Bitmap, altFrame?: Bitmap) => {
          this.writeFrame(frame)
        }
      )
    }
  }

  public readFrame(partial: boolean): Bitmap {
    // *** check current mode
      // *** rebuild bitmap if changed
    if (!this.bitmap) {
      const format = new Atari7800x320Format(this.atari)
      this.bitmap = format.createFrameBitmap()
    }

    const newLines = partial ? this.lineNumber : AtariActiveLines
    const downSample = this.bitmap.format.name != "7800x320"

    let srcOffset = 0
    let dstOffset = 0
    for (let y = 0; y < newLines; y += 1) {
      if (downSample) {
        for (let x = 0; x < 160; x += 1) {
          this.bitmap.data[dstOffset + x] = this.curPixels[srcOffset + x * 2]
        }
        dstOffset += 160
      } else {
        for (let x = 0; x < 320; x += 1) {
          this.bitmap.data[dstOffset + x] = this.curPixels[srcOffset + x]
        }
        dstOffset += 320
      }
      srcOffset += 320
    }
    // *** do gray out during copy back ***
    for (let y = newLines; y < AtariActiveLines; y += 1) {
      if (downSample) {
        for (let x = 0; x < 160; x += 1) {
          let pixel = this.prevPixels[srcOffset + x * 2]
          pixel &= 0x0f
          pixel ^= 0x04
          this.bitmap.data[dstOffset + x] = pixel
        }
        dstOffset += 160
      } else {
        for (let x = 0; x < 320; x += 1) {
          let pixel = this.prevPixels[srcOffset + x]
          pixel &= 0x0f
          pixel ^= 0x04
          this.bitmap.data[dstOffset + x] = pixel
        }
        dstOffset += 320
      }
      srcOffset += 320
    }
    return this.bitmap
  }

  public writeFrame(frame: Bitmap): void {
    if (this.bitmap) {
      let srcOffset = 0
      let dstOffset = 0
      if (this.bitmap.format.name != "7800x320") {
        for (let y = 0; y < frame.height; y += 1) {
          for (let x = 0; x < 160; x += 1) {
            const pixel = frame.data[srcOffset + x]
            this.curPixels[dstOffset + x * 2 + 0] = pixel
            this.curPixels[dstOffset + x * 2 + 1] = pixel
          }
          srcOffset += 160
          dstOffset += 320
        }
      } else {
        for (let y = 0; y < frame.height; y += 1) {
          for (let x = 0; x < 320; x += 1) {
            const pixel = frame.data[srcOffset + x]
            this.curPixels[dstOffset + x] = pixel
          }
          srcOffset += 320
          dstOffset += 320
        }
      }
    }
  }
}

//------------------------------------------------------------------------------

class AtariBitmap extends Bitmap {

  public constructor(src: Bitmap | Rect, format?: DisplayFormat) {
    super(src, format)
  }

  public encode(): PixelData {
    const dstByteWidth = this.width
    const data = new Uint8Array(this.height * dstByteWidth)
    const pixelData = new PixelData(this.format.name, this.bounds, dstByteWidth, data)
    pixelData.bytes = new Uint8Array(this.data)
    return pixelData
  }

  public decode(pixelData: PixelData): void {
    this.data = new Uint8Array(pixelData.bytes)
  }

  public togglePixel(pt: Point, foreColor: number, backColor: number, foreMatch?: boolean): boolean {
    if (pt.x < 0 || pt.y < 0 || pt.x >= this.width || pt.y >= this.height) {
      return false
    }
    const offset = pt.y * this.stride + pt.x
    const foreValue = this.format.getColorPattern(foreColor).values[0][0]
    const backValue = this.format.getColorPattern(backColor).values[0][0]
    if (foreMatch == undefined) {
      foreMatch = this.data[offset] == foreValue
    }
    this.data[offset] = foreMatch ? backValue : foreValue
    return foreMatch
  }
}

//------------------------------------------------------------------------------

export class Atari2600Format extends DisplayFormat {

  protected atari?: AtariMachine
  protected colorPatterns: ColorPattern[] = [{ values: [[0x00]] }]

  constructor(atari?: AtariMachine) {
    super()
    this.atari = atari
  }

  public update() {
    // ***
  }

  public get name(): string {
    return "2600"
  }

  public get frameSize(): Size {
    return { width: 160, height: AtariActiveLines }
  }

  public get displaySize(): Size {
    return { width: 640, height: 2 * AtariActiveLines }
  }

  public get pixelScale(): Point {
    return { x: 4, y: 2 }
  }

  public get alignmentX(): number {
    return 0
  }

  public get alignmentY(): number | number[] {
    return 0
  }

  public calcPixelWidth(byteWidth: number): number {
    return byteWidth
  }

  public calcByteWidth(pixelX: number, pixelWidth: number): number {
    return pixelWidth
  }

  public calcAddress(pixelX: number, pixelY: number, pageIndex: number): number {
    return 0
  }

  public calcByteColumn(pixelX: number): number {
    return pixelX
  }

  public createFramePixelData(): PixelData {
    return new PixelData(this.name, {x: 0, y: 0, ...this.frameSize}, this.frameSize.width)
  }

  public createBitmap(src: Bitmap | Rect): Bitmap {
    return new AtariBitmap(src, this)
  }

  public get patternCount(): number {
    return this.colorPatterns.length
  }

  public getColorValueRgb(index: number): number {
    const value = this.colorPatterns[index].values[0][0]
    return AtariPaletteNTSC[value]
  }

  public getColorPattern(patternIndex: number): ColorPattern {
    return this.colorPatterns[patternIndex]
  }

  public get altModes(): number {
    return 1
  }

  public colorize(srcBitmap: Bitmap, yTop: number, yBot: number, altMode: number, colorMain: Uint32Array, colorAlt: Uint32Array): void {
    let frameOffset = yTop * srcBitmap.stride
    let colorOffset = yTop * this.pixelScale.y / 2 * this.displaySize.width
    for (let y = yTop; y < yBot; y += 1) {
      let srcIndex = frameOffset
      let dstIndex = colorOffset
      for (let x = 0; x < srcBitmap.width; x += 1) {
        const color = AtariPaletteNTSC[srcBitmap.data[srcIndex++]]
        for (let i = 0; i < this.pixelScale.x; i += 1) {
          colorMain[dstIndex++] = color
        }
      }
      frameOffset += srcBitmap.stride
      colorOffset += this.displaySize.width
    }
  }

  public deinterleaveFrame(data: Uint8Array): PixelData {
    const pixelData = this.createFramePixelData()
    pixelData.bytes = new Uint8Array(data)
    return pixelData
  }
}

//------------------------------------------------------------------------------

// *** return "coordinate info" based on current hardware display list ***
// *** could return complex object that caller may know how to deal with ***

class Atari7800x160Format extends Atari2600Format {

  public update() {
    if (this.atari) {
      this.colorPatterns = []
      this.colorPatterns.push({ values: [[this.atari.maria.colorRegs[0]]], name: "BACKGRND" })
      // // *** TODO: support more than 320A mode
      // for (let i = 0; i < 8; i += 1) {
      //   const name = "P" + (i + 1) + "C2"
      //   this.colorPatterns.push({ values: [[atari.maria.colorRegs[i * 4 + 2]]], name })
      // }

      // *** rebuild alignment ***
    }
  }

  public get name(): string {
    return "7800x160"
  }

  public get alignmentX(): number {
    return 8
  }

  public get alignmentY(): number | number[] {
    return this.atari?.maria.getAlignmentY() ?? 8
  }

  public getDisplayInfo(coordInfo: CoordinateInfo, tool: Tool, defaultStr: string): string {
    return this.atari?.maria.getDisplayInfo(coordInfo, tool, defaultStr) ?? defaultStr
  }
}

//------------------------------------------------------------------------------

// *** TODO: consider folding 160 and 320 mode formats together

class Atari7800x320Format extends Atari7800x160Format {

  public update() {
    if (this.atari) {
      const maria = this.atari.maria

      this.colorPatterns = []
      this.colorPatterns.push({ values: [[maria.colorRegs[0]]], name: "BACKGRND" })

      if (maria.readMode == 3) {
        // 320A/C mode
        for (let i = 0; i < 8; i += 1) {
          const name = "P" + (i + 1) + "C2"
          this.colorPatterns.push({ values: [[maria.colorRegs[i * 4 + 2]]], name })
        }
      } else if (maria.readMode == 2) {
        // 320B/D mode
        this.colorPatterns.push({ values: [[maria.colorRegs[0 * 4 + 1]]], name: "P0C1*" })
        this.colorPatterns.push({ values: [[maria.colorRegs[0 * 4 + 2]]], name: "P0C2" })
        this.colorPatterns.push({ values: [[maria.colorRegs[0 * 4 + 3]]], name: "P0C3" })
        this.colorPatterns.push({ values: [[maria.colorRegs[4 * 4 + 1]]], name: "P4C1*" })
        this.colorPatterns.push({ values: [[maria.colorRegs[4 * 4 + 2]]], name: "P4C2" })
        this.colorPatterns.push({ values: [[maria.colorRegs[4 * 4 + 3]]], name: "P4C3" })
      } else {
        // TODO: other mode considerations?
      }

      // *** rebuild alignment ***
    }
  }

  public get name(): string {
    return "7800x320"
  }

  public get frameSize(): Size {
    return { width: 320, height: AtariActiveLines }
  }

  public get pixelScale(): Point {
    return { x: 2, y: 2 }
  }
}

//------------------------------------------------------------------------------

const NTSC_GREY = [
  0xFF000000, 0xFF111111, 0xFF222222, 0xFF333333,
  0xFF444444, 0xFF555555, 0xFF666666, 0xFF777777,
  0xFF888888, 0xFF999999, 0xFFAAAAAA, 0xFFBBBBBB,
  0xFFCCCCCC, 0xFFDDDDDD, 0xFFEEEEEE, 0xFFFFFFFF
]

const NTSC_GOLD = [
  0xFF00071A, 0xFF00182B, 0xFF00293C, 0xFF003A4D,
  0xFF004B5E, 0xFF005C6F, 0xFF006D80, 0xFF097E91,
  0xFF1A8FA2, 0xFF2BA0B3, 0xFF3CB1C4, 0xFF4DC2D5,
  0xFF5ED3E6, 0xFF6FE4F7, 0xFF83F5FF, 0xFF97F7FF
]

const NTSC_ORANGE = [
  0xFF000031, 0xFF000642, 0xFF001753, 0xFF002864,
  0xFF003975, 0xFF004A86, 0xFF0A5B97, 0xFF1B6CA8,
  0xFF2C7DB9, 0xFF3D8ECA, 0xFF4E9FDB, 0xFF5FB0EC,
  0xFF70C1FD, 0xFF85D2FF, 0xFF9CE3FF, 0xFFB2F4FF
]

const NTSC_RED_ORANGE = [
  0xFF00003E, 0xFF00004F, 0xFF000860, 0xFF001971,
  0xFF0D2A82, 0xFF1E3B93, 0xFF2F4CA4, 0xFF405DB5,
  0xFF516EC6, 0xFF627FD7, 0xFF7390E8, 0xFF83A1F9,
  0xFF98B2FF, 0xFFAEC3FF, 0xFFC4D4FF, 0xFFDAE5FF
]

const NTSC_PINK = [
  0xFF03003F, 0xFF0F0050, 0xFF1B0061, 0xFF2B0F72,
  0xFF3C2083, 0xFF4D3194, 0xFF5E42A5, 0xFF6F53B6,
  0xFF8064C7, 0xFF9175D8, 0xFFA286E9, 0xFFB397FA,
  0xFFC8A8FF, 0xFFDEB9FF, 0xFFEFCAFF, 0xFFF4DBFF
]

const NTSC_PURPLE = [
  0xFF350033, 0xFF410044, 0xFF4C0055, 0xFF5C0C66,
  0xFF6D1D77, 0xFF7E2E88, 0xFF8F3F99, 0xFFA050AA,
  0xFFB161BB, 0xFFC272CC, 0xFFD383DD, 0xFFE494EE,
  0xFFE4A5FF, 0xFFE9B6FF, 0xFFEEC7FF, 0xFFF3D8FF
]

const NTSC_PURPLE_BLUE = [
  0xFF5C001D, 0xFF68002E, 0xFF740040, 0xFF841051,
  0xFF952162, 0xFFA63273, 0xFFB74384, 0xFFC85495,
  0xFFD965A6, 0xFFEA76B7, 0xFFEB87C8, 0xFFEB98D9,
  0xFFECA9E9, 0xFFEBBAFB, 0xFFEFCBFF, 0xFFF4DCFF
]

const NTSC_BLUE1 = [
  0xFF710002, 0xFF7D0013, 0xFF8C0B24, 0xFF9D1C35,
  0xFFAE2D46, 0xFFBF3E57, 0xFFD04F68, 0xFFE16079,
  0xFFF2718A, 0xFFF7829B, 0xFFF793AC, 0xFFF7A4BD,
  0xFFF7B5CE, 0xFFF7C6DF, 0xFFF7D7F0, 0xFFF8E8FF
]

const NTSC_BLUE2 = [
  0xFF680000, 0xFF7C0A00, 0xFF901B08, 0xFFA12C19,
  0xFFB23D2A, 0xFFC34E3B, 0xFFD45F4C, 0xFFE5705D,
  0xFFF6816E, 0xFFFF927F, 0xFFFFA390, 0xFFFFB4A1,
  0xFFFFC5B2, 0xFFFFD6C3, 0xFFFFE7D4, 0xFFFFF8E5
]

const NTSC_LIGHT_BLUE = [
  0xFF4D0A00, 0xFF631B00, 0xFF792C00, 0xFF8F3D02,
  0xFFA04E13, 0xFFB15F24, 0xFFC27035, 0xFFD38146,
  0xFFE49257, 0xFFF5A368, 0xFFFFB479, 0xFFFFC58A,
  0xFFFFD69B, 0xFFFFE7AC, 0xFFFFF8BD, 0xFFFFFFCE
]

const NTSC_TURQUOISE = [
  0xFF261A00, 0xFF3C2B00, 0xFF523C00, 0xFF684D00,
  0xFF7C5E06, 0xFF8D6F17, 0xFF9E8028, 0xFFAF9139,
  0xFFC0A24A, 0xFFD1B35B, 0xFFE2C46C, 0xFFF3D57D,
  0xFFFFE68E, 0xFFFFF79F, 0xFFFFFFB0, 0xFFFFFFC1
]

const NTSC_GREEN_BLUE = [
  0xFF0B2400, 0xFF103500, 0xFF224600, 0xFF385700,
  0xFF4D6805, 0xFF5E7916, 0xFF6F8A27, 0xFF809B38,
  0xFF91AC49, 0xFFA2BD5A, 0xFFB3CE6B, 0xFFC4DF7C,
  0xFFD5F08D, 0xFFE5FF9E, 0xFFF1FFAF, 0xFFFDFFC0
]

const NTSC_GREEN = [
  0xFF0C2700, 0xFF113800, 0xFF164900, 0xFF1B5A00,
  0xFF1B6B10, 0xFF2C7C21, 0xFF3D8D32, 0xFF4E9E43,
  0xFF5FAF54, 0xFF70C065, 0xFF81D176, 0xFF92E287,
  0xFFA3F398, 0xFFB3FFA9, 0xFFBFFFBA, 0xFFCBFFCB
]

const NTSC_YELLOW_GREEN = [
  0xFF0A2300, 0xFF103400, 0xFF134504, 0xFF135615,
  0xFF136726, 0xFF137837, 0xFF148948, 0xFF259A59,
  0xFF36AB6A, 0xFF47BC7B, 0xFF58CD8C, 0xFF69DE9D,
  0xFF7AEFAE, 0xFF8BFFBF, 0xFF97FFD0, 0xFFA3FFE1
]

const NTSC_ORANGE_GREEN = [
  0xFF071700, 0xFF08280E, 0xFF08391F, 0xFF084A30,
  0xFF085B41, 0xFF086C52, 0xFF087D63, 0xFF0D8E74,
  0xFF1E9F85, 0xFF2FB096, 0xFF40C1A7, 0xFF51D2B8,
  0xFF62E3C9, 0xFF73F4DA, 0xFF82FFEB, 0xFF8EFFFC
]

const NTSC_LIGHT_ORANGE = [
  0xFF000719, 0xFF00182A, 0xFF00293B, 0xFF003A4C,
  0xFF004B5D, 0xFF005C6E, 0xFF006D7F, 0xFF097E90,
  0xFF1A8FA1, 0xFF2BA0B2, 0xFF3CB1C3, 0xFF4DC2D4,
  0xFF5ED3E5, 0xFF6FE4F6, 0xFF82F5FF, 0xFF96FFFF
]

const AtariPaletteNTSC = [
  ...NTSC_GREY,
  ...NTSC_GOLD,
  ...NTSC_ORANGE,
  ...NTSC_RED_ORANGE,
  ...NTSC_PINK,
  ...NTSC_PURPLE,
  ...NTSC_PURPLE_BLUE,
  ...NTSC_BLUE1,
  ...NTSC_BLUE2,
  ...NTSC_LIGHT_BLUE,
  ...NTSC_TURQUOISE,
  ...NTSC_GREEN_BLUE,
  ...NTSC_GREEN,
  ...NTSC_YELLOW_GREEN,
  ...NTSC_ORANGE_GREEN,
  ...NTSC_LIGHT_ORANGE
]

const AtariPalettePAL = [
  ...NTSC_GREY,
  ...NTSC_ORANGE_GREEN,
  ...NTSC_GOLD,
  ...NTSC_ORANGE,
  ...NTSC_RED_ORANGE,
  ...NTSC_PINK,
  ...NTSC_PURPLE,
  ...NTSC_PURPLE_BLUE,
  ...NTSC_BLUE1,
  ...NTSC_BLUE2,
  ...NTSC_LIGHT_BLUE,
  ...NTSC_TURQUOISE,
  ...NTSC_GREEN_BLUE,
  ...NTSC_GREEN,
  ...NTSC_YELLOW_GREEN,
  ...NTSC_ORANGE_GREEN
]

//------------------------------------------------------------------------------
