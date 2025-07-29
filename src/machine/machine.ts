
import * as base64 from 'base64-js'
import { HiresInterleave, TextLoresInterleave } from "../display/tables"
import { formatMap } from "../display/display"
import { Text40Format } from "../display/text"
import { DiskImage } from "../filesys/disk_image"
import { IMachine, IClock, IMachineDevice, IMachineDisplay, IMachineInput, IMachineMemory } from "../shared/types"
import { Joystick, PixelData } from "../shared/types"
import { Clock } from "./clock"
import { Cpu65xx } from "./cpu65xx"
import { Isa6502 } from "./isa65xx"
import { IMachineCpu } from "../shared/types"
import { a2pApplesoft, a2pMonitor, a2eMonitor, a2e80Col_C100, a2e80Col_C800 } from "./roms"

export enum Apple {
  II   = 0,
  IIp  = 1,
  IIe  = 2,
  IIee = 3,
  IIc  = 4,
  IIcp = 5
}

// Reference material
//  https://archive.org/details/Apple_IIc_Technical_Reference_Manual
//  http://www.lazilong.com/apple_II/bbros/ascii.jpg

// To enable audio in Chrome, click on info icon next to URL, choose
//  Site Settings, Privacy and Security, Sound, Allow, and then refresh the page.

//------------------------------------------------------------------------------

function uint8ToBase64(uint8: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([uint8])
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = <string>reader.result
      // Remove 'data:application/octet-stream;base64,'
      const base64 = dataUrl.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

//------------------------------------------------------------------------------

// TODO: handle a modified disk image getting replaced
//  (close old image before opening new one)

// *** rename FileDiskImage to AppleDiskImage? ***

export class FileDiskImage extends DiskImage {

  public fileName: string

  constructor(
      fileName: string,
      data: Uint8Array,
      isReadOnly = false) {
    const n = fileName.lastIndexOf(".")
    const suffix = n > 0 ? fileName.substring(n + 1).toLowerCase() : ""
    super(suffix, data, isReadOnly)
    this.fileName = fileName
  }

  public static fromState(state: any): FileDiskImage {
    let dataBytes: Uint8Array
    if (state.dataString) {
      dataBytes = base64.toByteArray(state.dataString)
    } else {
      dataBytes = new Uint8Array(state.dataBytes)
    }
    const diskImage = new FileDiskImage(
      state.fileName,
      dataBytes,
      state.writeProtected
    )
    return diskImage
  }

  public getStateDiskImage(): any {
    let state: any = {}
    state.fileName = this.fileName
    state.dataBytes = new Uint8Array(this.fullData)
    state.writeProtected = this.isReadOnly
    return state
  }

  public async flattenState(state: any) {
    if (state.dataBytes) {
      // state.dataString = base64.fromByteArray(state.dataBytes)
      state.dataString = await uint8ToBase64(state.dataBytes)
      delete state.dataBytes
    }
  }

  public override commitChanges() {
    if (this.workingData) {
      super.commitChanges()
      if (!this.isReadOnly) {
        // fs.writeFileSync(this.path, this.fullData)
        // TODO: or directly to file handle?
      }
    }
  }
}

//------------------------------------------------------------------------------
// MARK: Machine

const CyclesPerScanline = 65
const NTSCScanLines = 262
const NTCSActiveCycles = 192 * CyclesPerScanline
const CyclesPerFrame = CyclesPerScanline * NTSCScanLines  // 17030
const FramesPerSecond = 60
const CyclesPerSecond = CyclesPerFrame * FramesPerSecond

export class Machine implements IMachine, IMachineInput, IMachineDisplay, IMachineMemory {

  private ram: Uint8Array
  private rom: Uint8Array

  private type: Apple
  private _clock: Clock
  public _cpu: Cpu65xx    // TODO: fix public access for RegisterView
  private isa6502: Isa6502    // TODO: get rid of
  private slots: IMachineDevice[]

  public disk2Card: Disk2Card
  public speaker: SpeakerDevice
  public display: DisplayGenerator

  // language card settings
  private highRamWrite = false
  private highRamRead = false
  private highRamBank = 1
  private lastHighRamAccess = 0

  // aux memory settings
  private altZpOffset = 0
  private auxReadOffset = 0
  private auxWriteOffset = 0
  private intCXRom = 0
  private intC8Rom = 0
  private slotC3Rom = 0
  private altCharSet = 0

  // display settings
  private store80Mode = 0
  private column80Mode = 0
  private textMode = 1
  private page2 = 0
  private mixedGraphics = 0
  private hiresGraphics = 0
  private doubleGraphics = 0
  private visibleDisplayPage = 0
  private activeDisplayPage = 0

  // input settings
  private keyLatch = 0
  private paddleButtons: boolean[]
  private paddleValues: number[]
  private paddleTimes: number[]

  // state recording
  private curStateIndex: number = 0
  private states: any[] = []

  // *** require a type?
  constructor(type?: Apple) {

    this.type = type ?? Apple.IIe
    this.ram = new Uint8Array(0x10000 * 2).fill(0xEE)
    this.rom = new Uint8Array(0x4000).fill(0xEE) // 0xC000 - 0xFFFF

    // TODO: different version for //e enhanced or greater
    const applesoft = base64.toByteArray(a2pApplesoft.join(""))
    this.rom.set(applesoft, 0xD000 - 0xC000)

    if (this.type <= Apple.IIp) {
      const monitor = base64.toByteArray(a2pMonitor.join(""))
      this.rom.set(monitor, 0xF800 - 0xC000)

      const format = <Text40Format>formatMap.get("text40")
      format.setFontVariant("a2p")    // *** JSON case? else? ***

    } else if (this.type == Apple.IIe) {
      const monitor = base64.toByteArray(a2eMonitor.join(""))
      this.rom.set(monitor, 0xF800 - 0xC000)

      const eightyColC1 = base64.toByteArray(a2e80Col_C100.join(""))
      this.rom.set(eightyColC1, 0xC100 - 0xC000)

      const eightyColC8 = base64.toByteArray(a2e80Col_C800.join(""))
      this.rom.set(eightyColC8, 0xC800 - 0xC000)
    } else {
      // TODO: other types later
      throw new Error(`Unsupported machine variant "${this.type}"`)
    }

    this.paddleButtons = new Array(3).fill(false)
    this.paddleValues = new Array(4).fill(0)
    this.paddleTimes = new Array(4).fill(0)

    // TODO: choose ISA based on Apple type
    this.isa6502 = new Isa6502()
    this._cpu = new Cpu65xx(this.isa6502, this)
    // NOTE: this._clock must be created after this._cpu
    this._clock = new Clock(this, CyclesPerSecond, FramesPerSecond)

    this.speaker = new SpeakerDevice()
    this.display = new DisplayGenerator()

    this.slots = new Array(8)
    this.disk2Card = new Disk2Card()
    this.slots[6] = this.disk2Card

    this._clock.on("start", () => {
      this.trimStates()
    })
  }

  //--------------------------------------------------------
  // MARK: State
  //--------------------------------------------------------

  public snapState(frameNumber: number) {
    console.time("snapState")
    this.trimStates()
    this.states.push(this.getState())
    this.curStateIndex += 1
    console.timeEnd("snapState")
  }

  public getStateInfo() {
    return {
      index: this.curStateIndex,
      count: this.states.length
    }
  }

  private trimStates() {
    if (this.curStateIndex < this.states.length) {
      this.states = this.states.slice(0, this.curStateIndex)
    }
    if (this.states.length >= 60) {
      this.states.shift()
      this.curStateIndex -= 1
    }
  }

  public advanceState(forward: boolean, toEnd: boolean): boolean {
    let changed = false
    if (forward) {
      if (this.curStateIndex < this.states.length) {
        if (toEnd) {
          this.curStateIndex = this.states.length
          this.setState(this.states[this.curStateIndex - 1])
        } else {
          this.setState(this.states[this.curStateIndex++])
        }
        changed = true
      }
    } else {
      if (this.curStateIndex > 0) {
        if (this.curStateIndex == this.states.length) {
          const lastState = this.states[this.states.length - 1]
          if (lastState.cpu.cycles != this._cpu.cycles) {
            this.states.push(this.getState())
            this.curStateIndex += 1
          }
        }
        if (toEnd) {
          this.curStateIndex = 0
          this.setState(this.states[this.curStateIndex])
        } else {
          this.setState(this.states[--this.curStateIndex])
        }
        changed = true
      }
    }
    return changed
  }

  public getState(): any {
    let state: any = {}
    state.type = this.type
    state.ramBytes = new Uint8Array(this.ram)

    state.highRamWrite = this.highRamWrite
    state.highRamRead = this.highRamRead
    state.highRamBank = this.highRamBank
    state.lastHighRamAccess = this.lastHighRamAccess

    state.altZpOffset = this.altZpOffset
    state.auxReadOffset = this.auxReadOffset
    state.auxWriteOffset = this.auxWriteOffset
    state.intCXRom = this.intCXRom
    state.intC8Rom = this.intC8Rom
    state.slotC3Rom = this.slotC3Rom
    state.altCharSet = this.altCharSet

    state.store80Mode = this.store80Mode
    state.column80Mode = this.column80Mode
    state.textMode = this.textMode
    state.page2 = this.page2
    state.mixedGraphics = this.mixedGraphics
    state.hiresGraphics = this.hiresGraphics
    state.doubleGraphics = this.doubleGraphics
    state.visibleDisplayPage = this.visibleDisplayPage
    state.activeDisplayPage = this.activeDisplayPage

    state.keyLatch = this.keyLatch
    state.paddleButtons = [...this.paddleButtons]
    state.paddleValues = [...this.paddleValues]
    state.paddleTimes = [...this.paddleTimes]

    state.cpu = this._cpu.getStateCpu()
    state.speaker = this.speaker.getStateSpeaker()
    state.display = this.display.getStateDisplay()
    state.disk2Card = this.disk2Card.getStateDisk2Card()
    return state
  }

  public async flattenState(state: any) {
    if (state.ramBytes) {
      // state.ramString = base64.fromByteArray(state.ramBytes)
      state.ramString = await uint8ToBase64(state.ramBytes)
      delete state.ramBytes
    }
    await this._cpu.flattenState(state.cpu)
    await this.speaker.flattenState(state.speaker)
    await this.display.flattenState(state.display)
    await this.disk2Card.flattenState(state.disk2Card)
  }

  public setState(state: any) {

    // *** does caller stop cpu first? ***

    this.type = state.type      // *** check for conflict?

    if (state.ramString) {
      this.ram = base64.toByteArray(state.ramString)
    } else {
      this.ram = new Uint8Array(state.ramBytes)
    }

    this.highRamWrite = state.highRamWrite
    this.highRamRead = state.highRamRead
    this.highRamBank = state.highRamBank
    this.lastHighRamAccess = state.lastHighRamAccess

    this.altZpOffset = state.altZpOffset
    this.auxReadOffset = state.auxReadOffset
    this.auxWriteOffset = state.auxWriteOffset
    this.intCXRom = state.intCXRom
    this.intC8Rom = state.intC8Rom
    this.slotC3Rom = state.slotC3Rom
    this.altCharSet = state.altCharSet

    this.store80Mode = state.store80Mode
    this.column80Mode = state.column80Mode
    this.textMode = state.textMode
    this.page2 = state.page2
    this.mixedGraphics = state.mixedGraphics
    this.hiresGraphics = state.hiresGraphics
    this.doubleGraphics = state.doubleGraphics
    this.visibleDisplayPage = state.visibleDisplayPage
    this.activeDisplayPage = state.activeDisplayPage

    this.keyLatch = state.keyLatch
    this.paddleButtons = [...state.paddleButtons]
    this.paddleValues = [...state.paddleValues]
    this.paddleTimes = [...state.paddleTimes]

    this._cpu.setState(state.cpu)
    this.speaker.setState(state.speaker)
    this.display.setState(state.display)
    this.disk2Card.setState(state.disk2Card)

    this.display.update(this._cpu.cycles, true)
  }

  public reset(hardReset: boolean) {
    this.highRamWrite = false
    this.highRamRead = false
    this.highRamBank = 1
    this.lastHighRamAccess = 0

    this.altZpOffset = 0
    this.auxReadOffset = 0
    this.auxWriteOffset = 0
    this.intCXRom = 0
    this.intC8Rom = 0
    this.slotC3Rom = 0
    this.altCharSet = 0

    this.store80Mode = 0
    this.column80Mode = 0
    this.textMode = 1
    this.page2 = 0
    this.mixedGraphics = 0
    this.hiresGraphics = 0
    this.doubleGraphics = 0
    this.visibleDisplayPage = 0
    this.activeDisplayPage = 0

    this.keyLatch = 0
    this.paddleButtons.fill(false)
    this.paddleValues.fill(0)
    this.paddleTimes.fill(0)

    if (hardReset) {
      // fill memory with something other than zero
      this.ram.fill(0xee)

      // fill primary text and hires buffers with black
      this.ram.fill(0x00, 0x2000, 0x3fff)
      this.ram.fill(0xA0, 0x0400, 0x07ff)
    }

    this.display.reset()
    this.speaker.reset()
    for (let i = 0; i < this.slots.length; i += 1) {
      this.slots[i]?.reset()
    }

    this.cpu.reset()
    this.clock.reset(hardReset)
    this.display.update(this._cpu.cycles, true)
  }

  //--------------------------------------------------------

  // TODO: use real interfaces
  public setDisplayView(displayView: any) {
    this.display.displayView = displayView
  }

  public get clock(): IClock {
    return this._clock
  }

  public get cpu(): IMachineCpu {
    return this._cpu
  }

  public get memory(): IMachineMemory {
    return this
  }

  // TODO: get rid of (currently used by disasm.ts)
  public getIsa(): Isa6502 {
    return this.isa6502
  }

  // NOTE: called for every CPU instruction
  public update(cycleCount: number, forceRedraw: boolean) {
    const newVblank = this.display.update(cycleCount, forceRedraw)

    this.speaker.update(cycleCount)
    for (let i = 0; i < this.slots.length; i += 1) {
      this.slots[i]?.update(cycleCount)
    }
    if (newVblank) {
      this.snapState(this.display.frameNumber)
    }
  }

  // IMachineDisplay

  public getDisplayMode(): string {
    if (this.textMode) {
      if (this.column80Mode) {
        return "text80"
      } else {
        return "text40"
      }
    } else if (this.hiresGraphics) {
      if (this.column80Mode && this.doubleGraphics) {
        return this.mixedGraphics ? "dhires.mixed" : "dhires"
      } else {
        return this.mixedGraphics ? "hires.mixed" : "hires"
      }
    } else {
      if (this.column80Mode && this.doubleGraphics) {
        return this.mixedGraphics ? "dlores.mixed" : "dlores"
      } else {
        return this.mixedGraphics ? "lores.mixed" : "lores"
      }
    }
  }

  public getDisplayMemory(frame: PixelData, page: number): void {
    if (frame.format == "text40" || frame.format.startsWith("lores")) {
      let offset = 0
      const pageAddress = 0x0400 + page * 0x0400
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + TextLoresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          frame.bytes[offset + x] = this.ram[address + x]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format == "text80" || frame.format.startsWith("dlores")) {
      let offset = 0
      const pageAddress = 0x0400 + page * 0x0400
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + TextLoresInterleave[y]
        let dstIndex = offset
        for (let x = 0; x < frame.byteWidth; x += 1) {
          frame.bytes[dstIndex++] = this.ram[0x10000 + address + x]
          frame.bytes[dstIndex++] = this.ram[0x00000 + address + x]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format.startsWith("hires")) {
      let offset = 0
      const pageAddress = 0x2000 + page * 0x2000
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + HiresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          frame.bytes[offset + x] = this.ram[address + x]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format.startsWith("dhires")) {
      let offset = 0
      const pageAddress = 0x2000 + page * 0x2000
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + HiresInterleave[y]
        let dstIndex = offset
        for (let x = 0; x < frame.byteWidth / 2; x += 1) {
          frame.bytes[dstIndex++] = this.ram[0x10000 + address + x]
          frame.bytes[dstIndex++] = this.ram[0x00000 + address + x]
        }
        offset += frame.byteWidth
      }
    }
  }

  public setDisplayMemory(frame: PixelData, page: number): void {
    if (frame.format == "text40" || frame.format.startsWith("lores")) {
      let offset = 0
      const pageAddress = 0x0400 + page * 0x0400
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + TextLoresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          this.ram[address + x] = frame.bytes[offset + x]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format == "text80" || frame.format.startsWith("dlores")) {
      let offset = 0
      const pageAddress = 0x0400 + page * 0x0400
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + TextLoresInterleave[y]
        let srcIndex = offset
        for (let x = 0; x < frame.byteWidth / 2; x += 1) {
          this.ram[0x10000 + address + x] = frame.bytes[srcIndex++]
          this.ram[0x00000 + address + x] = frame.bytes[srcIndex++]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format.startsWith("hires")) {
      let offset = 0
      const pageAddress = 0x2000 + page * 0x2000
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + HiresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          this.ram[address + x] = frame.bytes[offset + x]
        }
        offset += frame.byteWidth
      }
    } else if (frame.format.startsWith("dhires")) {
      let offset = 0
      const pageAddress = 0x2000 + page * 0x2000
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = pageAddress + HiresInterleave[y]
        let srcIndex = offset
        for (let x = 0; x < frame.byteWidth / 2; x += 1) {
          this.ram[0x10000 + address + x] = frame.bytes[srcIndex++]
          this.ram[0x00000 + address + x] = frame.bytes[srcIndex++]
        }
        offset += frame.byteWidth
      }
    }
  }

  // TODO: deprecate this
  loadRam(address: number, bank: number, data: Uint8Array | number[], offset = 0, length = -1) {
    if (length == -1) {
      length = data.length
    }
    if (offset != 0 || length != data.length) {
      data = data.slice(offset, offset + length)
    }
    // mask address so 0x1d000 is also handled
    if (((address & 0xffff) >= 0xd000 && (address & 0xffff) < 0xe000)) {
      // NOTE: bank number is ones-based
      this.ram.set(data, bank == 1 ? address : address - 0x1000)
    } else {
      this.ram.set(data, address)
    }
  }

  public writeRam(address: number, data: Uint8Array | number[]) {
    this.ram.set(data, address)
  }

  // read memory without side effects
  public readConst(address: number): number {
    if (address >= 0xC000 && address < 0xC100) {
      return 0
    }
    if (this.type >= Apple.IIe) {
      if (address == 0xCFFF) {
        return 0
      }
    }
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {
    if (address < 0x200) {
      return this.ram[address + this.altZpOffset]
    }
    if (address < 0xc000) {
      if (this.store80Mode) {
        if ((address >= 0x0400 && address < 0x0800) ||
            (address >= 0x2000 && address < 0x4000 && this.hiresGraphics)) {
          if (this.page2 == 0) {
            return this.ram[address]
          } else {
            return this.ram[address + 0x10000]
          }
        }
      }
      return this.ram[address + this.auxReadOffset]
    }
    if (address >= 0xd000) {
      if (this.highRamRead) {
        if (address >= 0xe000 || this.highRamBank == 1) {
          return this.ram[address + this.altZpOffset]
        } else {
          return this.ram[address + this.altZpOffset - 0x1000]
        }
      } else {
        return this.rom[address - 0xC000]
      }
    }
    if (address < 0xc08f) {
      switch ((address >> 4) & 0xf) {
        case 0x0:
          return this.keyLatch
        case 0x1:
          // read switch status flags
          return this.read_C01x(address, cycleCount)
        case 0x2:
          break
        case 0x3:
          this.speaker.toggle(cycleCount)
          break
        case 0x4:
          break
        case 0x5:
          // set video modes
          this.access_C05x(address)
          break
        case 0x6:
          return this.readPaddles(address, cycleCount)
        case 0x7:
          this.resetPaddles(cycleCount)
          break
        case 0x8:
          // language card (slot 0)
          this.access_C08x(address)
          break
      }
    } else if (address < 0xc100) {
      let slot = (address >> 4) & 0x7
      return this.slots[slot]?.read(address & 0xf, cycleCount) ?? this.readFloatingBus(cycleCount)
    } else if (address < 0xc800) {
      let slot = (address >> 8) & 0x7
      if (this.type >= Apple.IIe) {
        //                       $C100-$C2FF
        //  INTCXROM  SL0TC3R0M  $C400-SCFFF  $C300-$C3FF
        //   reset      reset       slot        internal
        //   reset       set        slot          slot
        //    set       reset     internal      internal
        //    set        set      internal      internal
        if (slot == 3 && !this.slotC3Rom) {
          this.intC8Rom = 1
        }
        if (this.intCXRom || (slot == 3 && !this.slotC3Rom)) {
          return this.rom[address - 0xC000]
        }
      }
      return this.slots[slot]?.readRom(address & 0xff) ?? this.readFloatingBus(cycleCount)
    } else {  // 0xC800 - 0xCFFF
      if (this.type >= Apple.IIe) {
        if (address == 0xCFFF) {
          this.intC8Rom = 0
        }
        if (this.intCXRom || this.intC8Rom) {
          return this.rom[address - 0xC000]
        }
      }
    }
    return this.readFloatingBus(cycleCount)
  }

  public write(address: number, value: number, cycleCount: number) {
    if (address < 0x200) {
      this.ram[address + this.altZpOffset] = value
    } else if (address < 0xc000) {
      if (this.store80Mode) {
        if ((address >= 0x0400 && address < 0x0800) ||
            (address >= 0x2000 && address < 0x4000 && this.hiresGraphics)) {
          if (this.page2 == 0) {
            this.ram[address] = value
          } else {
            this.ram[address + 0x10000] = value
          }
          this.activeDisplayPage = 0
          this.visibleDisplayPage = 0
          return
        }
      }
      this.ram[address + this.auxWriteOffset] = value
      // TODO: generalize this into a notification mechanism?
      // TODO: determine ranges based on display mode?
      if (address >= 0x2000 && address < 0x4000) {
        this.activeDisplayPage = 0
      } else if (address >= 0x4000 && address < 0x6000) {
        this.activeDisplayPage = 1
      }
    } else if (address >= 0xd000) {
      if (this.highRamWrite) {
        if (address >= 0xe000 || this.highRamBank == 1) {
          this.ram[address + this.altZpOffset] = value
        } else {
          this.ram[address + this.altZpOffset - 0x1000] = value
        }
      } else {
        // TODO: warn on write to ROM?
      }
    } else if (address <= 0xc08f) {
      switch ((address >> 4) & 0xf) {
        case 0x0:
          // set mem/video modes
          this.write_C00x(address, value)
          break
        case 0x1:
          this.clearKeyStrobe()
          break
        case 0x2:
          // TODO: this.tapeOut()
          break
        case 0x3:
          this.speaker.toggle(cycleCount)
          break
        case 0x4:
          break
        case 0x5:
          // set video modes
          this.access_C05x(address)
          break
        case 0x6:
          break
        case 0x7:
          this.resetPaddles(cycleCount)
          // TODO: IOUDISON   $C07E
          // TODO: IOUDISOFF  $C07F
          break
        case 0x8:
          // language card (slot 0)
          this.access_C08x(address)
          break
      }
    } else if (address < 0xc100) {
      let slot = (address >> 4) & 0x7
      if (this.slots[slot]) {
        this.slots[slot].write(address & 0xf, value & 0xff, cycleCount)
      }
    }
  }

  private readFloatingBus(cycleCount: number, highBitSet?: boolean) {
    // TODO: visibleDisplayPage doesn't make sense in 80 column or double graphics modes
    let value = this.read(getFloatingHiresAddress(cycleCount, this.visibleDisplayPage), 0)
    if (highBitSet != undefined) {
      if (highBitSet) {
        value |= 0x80
      } else {
        value &= ~0x80
      }
    }
    return value
  }

  // set mem/video modes
  private write_C00x(address: number, value:  number) {
    const lowBit = address & 1
    switch (address & 0xf) {
      case 0x0:  // 80STOREOFF
      case 0x1:  // 80STOREON
        this.store80Mode = lowBit
        break
      case 0x2:  // RAMRDOFF
      case 0x3:  // RAMRDON
        this.auxReadOffset = lowBit * 0x10000
        break
      case 0x4:  // RAMWRTOFF
      case 0x5:  // RAMWRTON
        this.auxWriteOffset = lowBit * 0x10000
        break
      case 0x6:  // INTCXROMOFF
      case 0x7:  // INTCXROMON
        this.intCXRom = lowBit
        break
      case 0x8:  // ALTZPOFF
      case 0x9:  // ALTZPON
        this.altZpOffset = lowBit * 0x10000
        break
      case 0xA:  // SLOTC3ROMOFF
      case 0xB:  // SLOTC3ROMON
        this.slotC3Rom = lowBit
        break
      case 0xC:  // 80COLOFF
      case 0xD:  // 80COLON
        this.column80Mode = lowBit
        break
      case 0xE:  // ALTCHARSETOFF
      case 0xF:  // ALTCHARSETON
        // TODO: eventually use this for enhanced support
        this.altCharSet = lowBit
        break
    }
  }

  // read switch status flags
  // TODO: what about floating bus?
  private read_C01x(address: number, cycleCount: number): number {
    switch (address & 0xf) {
      case 0x0:
        return this.clearKeyStrobe()

      case 0x1:  // BSRBANK2
        return this.highRamBank == 1 ? 0x00 : 0x80

      case 0x2:  // BSRREADRAM
        // NOTE: highRamWrite is backdoor information used by debugger UI
        //  It's not accurate to real hardware.
        return (this.highRamRead ? 0x80 : 0x00) | (this.highRamWrite ? 1 : 0)

      case 0x3:  // RAMRD
        return this.auxReadOffset == 0 ? 0x00 : 0x80

      case 0x4:  // RAMWRT
        return this.auxWriteOffset == 0 ? 0x00 : 0x80

      case 0x5:  // INTCXROM
        return this.intCXRom == 0 ? 0x00 : 0x80

      case 0x6:  // ALTZP
        return this.altZpOffset == 0 ? 0x00 : 0x80

      case 0x7:  // SLOTC3ROM
        return this.slotC3Rom == 0 ? 0x00 : 0x80

      case 0x8:  // 80STORE
        return this.store80Mode == 0 ? 0x00 : 0x80

      case 0x9:  // VERTBLANK
        const inVBlank = this.display.inVBlank(cycleCount)
        return this.readFloatingBus(cycleCount, inVBlank)

      case 0xA:  // TEXT
        return this.textMode == 0 ? 0x00 : 0x80

      case 0xB:  // MIXED
        return this.mixedGraphics == 0 ? 0x00 : 0x80

      case 0xC:  // PAGE2
        return this.page2 == 0 ? 0x00 : 0x80

      case 0xD:  // HIRES
        return this.hiresGraphics == 0 ? 0x00 : 0x80

      case 0xE:  // ALTCHARSET
        return this.altCharSet == 0 ? 0x00 : 0x80

      case 0xF:  // 80COL
        return this.column80Mode == 0 ? 0x00 : 0x80
    }

    console.log("Read of $" + address.toString(16) + " ignored")
    return 0x00
  }

  // set video modes
  private access_C05x(address: number) {
    const lowBit = address & 1
    switch (address & 0xf) {

      case 0x0:  // TEXTOFF
      case 0x1:  // TEXTON
        this.textMode = lowBit
        break

      case 0x2:  // MIXEDOFF
      case 0x3:  // MIXEDON
        this.mixedGraphics = lowBit
        break

      case 0x4:  // PAGE2OFF
      case 0x5:  // PAGE2ON
        this.page2 = lowBit
        if (this.store80Mode) {
          // TODO: what should change here?
        } else {
          this.visibleDisplayPage = this.page2
        }
        break

      case 0x6:  // HIRESOFF
      case 0x7:  // HIRESON
        this.hiresGraphics = lowBit
        break

      case 0x8:  // disable mouse interrupts
      case 0x9:
      case 0xA:  // disable VBL interrupts
      case 0xB:
      case 0xC:
      case 0xD:
        break

      // TODO: only accessible after IOUDISON ($C07E) written to
      case 0xE:  // DHIRESON
      case 0xF:  // DHIRESOFF
        this.doubleGraphics = lowBit ^ 1
        break
    }
  }

  // language card (slot 0)
  private access_C08x(address: number) {
    // TODO: currently turned off because some games (like Gorgon)
    //  don't always follow the fast double read rule.

    // check for double read to enable highRamWrite
    // if (address & 1) {
    //   let cycleCount = this.getCycleCount()
    //   if (cycleCount - this.lastHighRamAccess > 5) {
    //     this.lastHighRamAccess = cycleCount
    //     return
    //   }
    // }
    this.highRamBank = (address & 8) ? 1 : 2
    this.highRamWrite = (address & 1) != 0
    this.highRamRead = (address & 3) == 0 || (address & 3) == 3
  }

  // TODO: should this do key buffering?
  setKeyCode(code: number) {
    this.keyLatch = code | 0x80
  }

  private clearKeyStrobe(): number {
    this.keyLatch &= ~0x80
    return this.keyLatch
  }

  private resetPaddles(cycleCount: number) {
    // From //c technical reference: Reading or writing any address in the range
    //  $CO70-$CO7F also triggers the paddle timer and resets VBlInt
    for (let i = 0; i < this.paddleTimes.length; i += 1) {
      // if timer still running, strobe has no effect
      if (cycleCount <= this.paddleTimes[i]) {
        continue
      }
      const PDL_CNTR_INTERVAL = 2816.0 / 255.0;  // 11.04 (From KEGS)
      this.paddleTimes[i] = cycleCount + Math.floor(this.paddleValues[i] * PDL_CNTR_INTERVAL)
    }
  }

  private readPaddles(address: number, cycleCount: number): number {
    // bit 3 is ignored
    switch (address & 0x7) {
      case 0x0:
        // TODO: return tapeIn()
        return 0

      case 0x1:
      case 0x2:
      case 0x3:
        const isPressed = this.paddleButtons[(address & 3) - 1]
        return this.readFloatingBus(cycleCount, isPressed)

      case 0x4:
      case 0x5:
      case 0x6:
      case 0x7:
      default:
        const isActive = cycleCount <= this.paddleTimes[address & 0x3]
        return this.readFloatingBus(cycleCount, isActive)
    }
  }

  setJoystickValues(joystick: Joystick) {
    this.paddleButtons[0] = joystick.button0 ?? false
    this.paddleButtons[1] = joystick.button1 ?? false
    this.paddleButtons[2] = joystick.button2 ?? false
    this.paddleValues[0] = joystick.x0 ?? 0
    this.paddleValues[1] = joystick.y0 ?? 0
    this.paddleValues[2] = joystick.x1 ?? 0
    this.paddleValues[3] = joystick.y1 ?? 0
    for (let i = 0; i < this.paddleValues.length; i += 1) {
      if (this.paddleValues[i] < 0) {
        this.paddleValues[i] = 0
      } else if (this.paddleValues[i] > 255) {
        this.paddleValues[i] = 255
      }
    }
  }

  setDiskImage(driveIndex: number, image: FileDiskImage | undefined) {
    this.disk2Card.setImage(driveIndex, image)
  }

  getVisibleDisplayPage(): number {
    return this.visibleDisplayPage
  }

  getActiveDisplayPage(): number {
    return this.activeDisplayPage
  }

  // TODO: hasn't been tested since CPU rewrite
  call(address: number, A = 0, X = 0, Y = 0, C = 0): number {
    const cycleStart = this._cpu.cycles
    this._cpu.setPC(address)
    this._cpu.A = A
    this._cpu.X = X
    this._cpu.Y = Y
    let ps = this._cpu.getStatusBits() & ~1
    if (C) {
      ps |= 1
    }
    this._cpu.setStatusBits(ps)
    this.write(0x100 + ((this._cpu.SP + 1) & 0xFF), 0xFF, cycleStart)
    this.write(0x100 + ((this._cpu.SP + 2) & 0xFF), 0xFF, cycleStart)
    while (this._cpu.getPC() != 0x0000) {
      this._cpu.nextInstruction()
    }
    return this._cpu.cycles - cycleStart
  }

  setCpuEscapeHook(escapeHook: any, index: number) {
    this._cpu.setEscapeHook(escapeHook, index)
  }
}

//------------------------------------------------------------------------------
// MARK: Display

// *** make this a wrapper on/part of DisplayView ? ***
class DisplayGenerator {

  public frameNumber = 0
  private frameStartCycle = 0
  private isInVBlank?: boolean
  public displayView?: any   // *** make this an interface ***

  public getStateDisplay(): any {
    let state: any = {}
    state.frameNumber = this.frameNumber
    state.frameStartCycle = this.frameStartCycle
    return state
  }

  public flattenState(state: any) {
  }

  public setState(state: any) {
    this.frameNumber = state.frameNumber
    this.frameStartCycle = state.frameStartCycle
    this.isInVBlank = undefined
  }

  public reset() {
    this.frameNumber = 0
    this.frameStartCycle = 0
    this.isInVBlank = undefined
  }

  public update(cycleCount: number, forceRedraw: boolean): boolean {
    let frameCycles = cycleCount - this.frameStartCycle
    if (frameCycles >= CyclesPerFrame) {
      frameCycles -= CyclesPerFrame
      this.frameStartCycle = cycleCount - frameCycles
    }
    const wasInVBlank = this.isInVBlank
    this.isInVBlank = frameCycles >= NTCSActiveCycles
    const newVBlank = (this.isInVBlank && !wasInVBlank)
    if (newVBlank || forceRedraw || wasInVBlank == undefined) {
      this.displayView?.update()
    }
    return newVBlank
  }

  public inVBlank(cycleCount: number): boolean {
    this.update(cycleCount, false)
    return this.isInVBlank ?? false
  }
}

//------------------------------------------------------------------------------
// MARK: Speaker

class SpeakerDevice {
  private _isEnabled = false
  private audioCtx?: AudioContext

  private sampleRatio = 0
  private inSampleWindow = 0
  private fadeOutSamples = 0

  private inSamples: number[] = []
  private outSamples: number[] = []
  private inPhase = 0
  private isFading = false
  private fadeCount = 0

  private speakerLevel = -1
  private lastToggleMs = 0

  private startFrameCycle = 0
  private frameCycles = 0
  private lastBufferPushMs = 0
  private nextBufferStart = 0

  // NOTE: No JSON state is saved or restored because
  //  speaker always starts as !_enabled and requires
  //  a user click to enable.

  public getStateSpeaker(): any {
    return {}
  }

  public flattenState(state: any) {
  }

  public setState(state: any) {
  }

  public reset() {
    this.inSamples.fill(0)
    this.outSamples.fill(0)
    this.inPhase = 0
    this.isFading = false
    this.fadeCount = 0

    this.speakerLevel = -1
    this.lastToggleMs = 0

    this.startFrameCycle = 0
    this.frameCycles = 0
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
          this.sampleRatio = CyclesPerSecond / this.audioCtx.sampleRate
          this.inSampleWindow = Math.ceil(this.sampleRatio)
          this.fadeOutSamples = Math.floor(1 * this.audioCtx.sampleRate / 16)
          this.inSamples = new Array(this.inSampleWindow + CyclesPerFrame)
          this.outSamples = new Array(Math.floor(this.audioCtx.sampleRate / FramesPerSecond))
        }
        this.reset()
        this.audioCtx.resume()
      } else {
        this.audioCtx!.suspend()
      }
    }
  }

  public toggle(cycleCount: number) {
    if (this._isEnabled) {
      this.isFading = false
      this.update(cycleCount)
      this.speakerLevel = -this.speakerLevel
      this.lastToggleMs = Date.now()
    }
  }

  public update(cycleCount: number) {
    if (this._isEnabled) {
      let endFrameCycles = cycleCount - this.startFrameCycle
      while (this.frameCycles < endFrameCycles) {
        this.inSamples[this.inSampleWindow + this.frameCycles] = this.speakerLevel
        this.frameCycles += 1
        if (this.frameCycles == CyclesPerFrame) {
          this.outputBuffer()
          this.frameCycles = 0
          this.startFrameCycle += CyclesPerFrame
          endFrameCycles -= CyclesPerFrame
        }
      }
    }
  }

  private outputBuffer() {
    const nowMs = Date.now()
    this.audioCtx = this.audioCtx!

    // if buffer push got delayed too much, push some silence to get ahead again
    // TODO: is two frames worth the right amount?
    const framesAhead = 2
    if (nowMs - this.lastBufferPushMs >= 1000 / FramesPerSecond * framesAhead ||
        this.nextBufferStart < this.audioCtx.currentTime) {
      const audioBuffer = this.audioCtx.createBuffer(1, this.outSamples.length * framesAhead, this.audioCtx.sampleRate)
      const source = this.audioCtx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(this.audioCtx.destination)
      this.nextBufferStart = this.audioCtx.currentTime
      source.start(this.nextBufferStart)
      this.nextBufferStart += audioBuffer.duration
    }

    if (!this.isFading) {
      // 1/4 second (in ms) before fade out starts
      if (nowMs - this.lastToggleMs >= 1000 / 4) {
        // 1/16 second (in outSamples) to fade out
        this.fadeCount = this.fadeOutSamples
        this.isFading = true
      }
    }

    for (let i = 0; i < this.outSamples.length; i += 1) {
      const pi = this.inSampleWindow + Math.floor(this.inPhase)
      let sample = 0
      for (let j = 0; j < this.inSampleWindow; j += 1) {
        sample += this.inSamples[pi - j]
      }
      sample /= this.inSampleWindow
      if (this.isFading) {
        // fade to silence if speaker hasn't been clicked for a while
        if (this.fadeCount > 0) {
          this.fadeCount -= 1
        }
        sample *= this.fadeCount / this.fadeOutSamples
      }
      this.outSamples[i] = sample
      this.inPhase += this.sampleRatio
    }
    this.inPhase %= CyclesPerFrame

    for (let i = 1; i <= this.inSampleWindow; i += 1) {
      this.inSamples[this.inSampleWindow - i] = this.inSamples[this.inSamples.length - i]
    }

    const audioBuffer = this.audioCtx.createBuffer(1, this.outSamples.length, this.audioCtx.sampleRate)
    audioBuffer.getChannelData(0).set(this.outSamples)
    const source = this.audioCtx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.audioCtx.destination)
    source.start(this.nextBufferStart)
    this.nextBufferStart += audioBuffer.duration

    this.lastBufferPushMs = nowMs
  }
}

//------------------------------------------------------------------------------
// MARK: Disk2Drive

const NUM_TRACKS = 35
const NIB_TRACK_SIZE = 6656
const NIB_SECTOR_SIZE = 416

const SPIN_UP_CYCLES = 750
const SPIN_DOWN_CYCLES = 1000 * 1000

class Disk2Drive {
  private diskImage?: FileDiskImage
  private nibbleData?: Uint8Array
  public isWriteProtected = false
  private phase = 0
  private trackOffset = 0
  private byteIndex = 0
  private motorOnCycle = 0
  private motorOffCycle = 0
  public isSpinning = false

  constructor() {
    this.reset()
  }

  public getStateDisk2Drive(): any {
    let state: any = {}
    if (this.diskImage) {
      state.diskImage = this.diskImage.getStateDiskImage()
      if (this.nibbleData) {
        state.nibbleBytes = new Uint8Array(this.nibbleData)
      }
      state.isWriteProtected = this.isWriteProtected
      state.phase = this.phase
      state.trackOffset = this.trackOffset
      state.byteIndex = this.byteIndex
      state.motorOnCycle = this.motorOnCycle
      state.motorOffCycle = this.motorOffCycle
      state.isSpinning = this.isSpinning
    }
    return state
  }

  public async flattenState(state: any) {
    if (state.diskImage) {
      await this.diskImage?.flattenState(state.diskImage)
      if (state.nibbleBytes) {
        // state.nibbleString = base64.fromByteArray(state.nibbleBytes)
        state.nibbleString = await uint8ToBase64(state.nibbleBytes)
        delete state.nibbleBytes
      }
    }
  }

  public setState(state: any) {
    if (state.diskImage) {
      this.diskImage = FileDiskImage.fromState(state.diskImage)
      if (state.nibbleString) {
        this.nibbleData = base64.toByteArray(state.nibbleString)
      } else if (state.nibbleBytes) {
        this.nibbleData = new Uint8Array(state.nibbleBytes)
      }
      this.isWriteProtected = state.isWriteProtected
      this.phase = state.phase
      this.trackOffset = state.trackOffset
      this.byteIndex = state.byteIndex
      this.motorOnCycle = state.motorOnCycle
      this.motorOffCycle = state.motorOffCycle
      this.isSpinning = state.isSpinning
    } else {
      delete this.diskImage
    }
  }

  public reset() {
    this.isWriteProtected = false
    this.phase = 0
    this.trackOffset = 0
    this.byteIndex = 0
    this.motorOnCycle = 0
    this.motorOffCycle = 0
    this.isSpinning = false
  }

  public enable(enable: boolean, cycleCount: number) {
    if (!enable) {
      this.motorOnCycle = 0
      this.motorOffCycle = 0
      this.isSpinning = false
    }
  }

  public controlMotor(motorOn: boolean, cycleCount: number) {
    if (motorOn) {
      if (this.motorOffCycle && cycleCount - this.motorOffCycle < SPIN_DOWN_CYCLES) {
        this.motorOnCycle = this.motorOffCycle
      } else {
        this.motorOnCycle = cycleCount
      }
      this.motorOffCycle = 0
    } else {
      if (this.motorOnCycle && cycleCount - this.motorOnCycle >= SPIN_UP_CYCLES) {
        this.motorOffCycle = cycleCount
      } else {
        this.motorOffCycle = 0
      }
      this.motorOnCycle = 0
    }
  }

  public updateSpinning(cycleCount: number): boolean {
    if (this.motorOnCycle) {
      this.isSpinning = cycleCount - this.motorOnCycle >= SPIN_UP_CYCLES
    } else if (this.motorOffCycle) {
      this.isSpinning = cycleCount - this.motorOffCycle < SPIN_DOWN_CYCLES
    } else {
      this.isSpinning = false
    }
    return this.isSpinning
  }

  public setImage(diskImage?: FileDiskImage) {
    this.diskImage = diskImage
    this.nibbleData = diskImage?.nibblize()
    this.isWriteProtected = diskImage?.isReadOnly || true
  }

  public getImage(): FileDiskImage | undefined {
    return this.diskImage
  }

  public getNextDataByte(): number {
    if (this.nibbleData) {
      const value = this.nibbleData[this.trackOffset + this.byteIndex]
      this.byteIndex += 1
      if (this.byteIndex == NIB_TRACK_SIZE) {
        this.byteIndex = 0
      }
      return value
    }
    return 0xee
  }

  public setNextDataByte(data: number) {
    if (this.nibbleData) {
      this.nibbleData[this.trackOffset + this.byteIndex] = data
      this.byteIndex += 1
      if (this.byteIndex == NIB_TRACK_SIZE) {
        this.byteIndex = 0
      }
    }
  }

  public getPhase(): number {
    return this.phase
  }

  public setPhase(newPhase: number) {
    if (this.phase != newPhase) {
      this.phase = newPhase
      this.trackOffset = (this.phase >> 1) * NIB_TRACK_SIZE
    }
  }
}


// MARK: Disk2Card

class Disk2Card implements IMachineDevice {
  private drives: Disk2Drive []
  private listeners: any[] = new Array(2)
  private currentDrive = 0
  private motorIsOn = false
  private writeMode = false
  private magnetStates = 0
  private latch = 0

  constructor() {
    this.drives = [ new Disk2Drive(), new Disk2Drive() ]
    this.reset()
  }

  public getStateDisk2Card(): any {
    let state: any = {}
    state.currentDrive = this.currentDrive
    state.motorIsOn = this.motorIsOn
    state.writeMode = this.writeMode
    state.magnetStates = this.magnetStates
    state.latch = this.latch
    state.drive1 = this.drives[0].getStateDisk2Drive()
    state.drive2 = this.drives[1].getStateDisk2Drive()
    return state
  }

  public async flattenState(state: any) {
    await this.drives[0].flattenState(state.drive1)
    await this.drives[1].flattenState(state.drive2)
  }

  public setState(state: any) {
    this.currentDrive = state.currentDrive
    this.motorIsOn = state.motorIsOn
    this.writeMode = state.writeMode
    this.magnetStates = state.magnetStates
    this.latch = state.latch
    this.drives[0].setState(state.drive1)
    this.drives[1].setState(state.drive2)
  }

  public setListener(driveIndex: number, proc?: (diskImage: FileDiskImage | undefined, isActive: boolean) => void) {
    this.listeners[driveIndex] = proc
    this.notifyListener(driveIndex)
  }

  private notifyListener(driveIndex: number) {
    if (this.listeners[driveIndex]) {
      const diskImage = this.driveGetDiskImage(driveIndex)
      const isActive = this.driveIsSpinning(driveIndex)
      this.listeners[driveIndex](diskImage, isActive)
    }
  }

  public driveHasDisk(driveIndex: number): boolean {
    return this.drives[driveIndex].getImage() != undefined
  }

  public driveIsSpinning(driveIndex: number): boolean {
    return this.drives[driveIndex].isSpinning
  }

  public driveGetDiskImage(driveIndex: number): FileDiskImage | undefined {
    return this.drives[driveIndex].getImage()
  }

  public setImage(driveIndex: number, image?: FileDiskImage) {
    this.drives[driveIndex].setImage(image)
    this.notifyListener(driveIndex)
  }

  // IMachineDevice interface implementation

  public reset() {
    for (let i = 0; i < 2; i += 1) {
      this.drives[i].reset()
      this.notifyListener(i)
    }
    this.currentDrive = 0
    this.motorIsOn = false
    this.writeMode = false
    this.magnetStates = 0
    this.latch = 0
  }

  public update(cycleCount: number) {
    for (let i = 0; i < 2; i += 1) {
      const wasSpinning = this.drives[i].isSpinning
      this.drives[i].updateSpinning(cycleCount)
      if (wasSpinning != this.drives[i].isSpinning) {
        this.notifyListener(i)
      }
    }
  }

  public read(address: number, cycleCount: number): number {
    return this.onReadWrite(address, undefined, cycleCount) ?? 0xEE
  }

  public write(address: number, value: number, cycleCount: number) {
    this.onReadWrite(address, value, cycleCount)
  }

  public readConst(address: number): number {
    return disk2Rom[address & 0xff]
  }

  public readRom(address: number): number {
    return disk2Rom[address & 0xff]
  }

  private onReadWrite(address: number, value: number | undefined, cycleCount: number) {
    let isWrite = value != undefined
    switch (address & 0xf) {
      case 0x0:
      case 0x1:
      case 0x2:
      case 0x3:
      case 0x4:
      case 0x5:
      case 0x6:
      case 0x7:
        this.controlStepper(address, cycleCount)
        break

      case 0x8:
      case 0x9:
        this.controlMotor(address, cycleCount)
        break

      case 0xA:
      case 0xB:
        this.enable(address, cycleCount)
        break

      case 0xC:
        if (isWrite) {
          this.latch = value!
        }
        this.readWrite(cycleCount)
        break

      case 0xD:
        if (isWrite) {
          this.latch = value!
        } else {
          this.loadWriteProtect(cycleCount)
        }
        break

      case 0xE:
      case 0xF:
        this.setMode(address)
        break
    }

    if (!isWrite) {
      if ((address & 1) == 0) {
        return this.latch
      } else {
        return 0xee
      }
    }
  }

  private controlStepper(address: number, cycleCount: number) {
    let drive = this.drives[this.currentDrive]
    if (!this.motorIsOn) {
      if (!drive.updateSpinning(cycleCount)) {
        console.log("disk stepper accessed while motor is off")
        return
      }
      console.log("disk stepper accessed while motor is off but spinning")
    }

    let phase = (address >> 1) & 3
    let phaseBit = (1 << phase)
    if (address & 1) {
      this.magnetStates |= phaseBit   // phase on
    } else {
      this.magnetStates &= ~phaseBit  // phase off
    }

    let drivePhase = drive.getPhase()
    let direction = 0
    if (this.magnetStates & (1 << ((drivePhase + 1) & 3))) {
      direction += 1
    }
    if (this.magnetStates & (1 << ((drivePhase + 3) & 3))) {
      direction -= 1
    }

    let newPhase = drivePhase + direction
    if (newPhase < 0) {
      newPhase = 0
    } else if (newPhase > NUM_TRACKS * 2 - 1) {
      newPhase = NUM_TRACKS * 2 - 1
    }
    drive.setPhase(newPhase)
  }

  private controlMotor(address: number, cycleCount: number) {
    let turnMotorOn = (address & 1) != 0
    if (turnMotorOn != this.motorIsOn) {
      this.motorIsOn = turnMotorOn
      this.drives[this.currentDrive].controlMotor(this.motorIsOn, cycleCount)
    }
  }

  private enable(address: number, cycleCount: number) {
    const newDrive = address & 1
    if (newDrive != this.currentDrive) {
      this.currentDrive = newDrive
      this.drives[0].enable(this.currentDrive == 0, cycleCount)
      this.drives[1].enable(this.currentDrive == 1, cycleCount)
      this.drives[this.currentDrive].controlMotor(this.motorIsOn, cycleCount)
      this.notifyListener(0)
      this.notifyListener(1)
    }
  }

  private readWrite(cycleCount: number) {
    let drive = this.drives[this.currentDrive]
    if (drive.updateSpinning(cycleCount)) {
      if (!this.writeMode) {
        if (this.motorIsOn) {
          this.latch = drive.getNextDataByte()
        } else {
          this.latch = Math.floor(Math.random() * 255)
        }
      } else if (!drive.isWriteProtected) {
        drive.setNextDataByte(this.latch)
      } else {
        console.log("disk write ignored: write protected")
      }
    } else {
      this.latch = 0x80
    }
  }

  private loadWriteProtect(cycleCount: number) {
    let drive = this.drives[this.currentDrive]
    if (drive.updateSpinning(cycleCount)) {
      if (drive.isWriteProtected) {
        this.latch |= 0x80
      } else {
        this.latch &= 0x7f
      }
    } else {
      console.log("checking write protect on drive that's not spinning")
    }
  }

  private setMode(address: number) {
    this.writeMode = (address & 1) != 0
  }
}

const disk2Rom = [
  0xa2,0x20,0xa0,0x00,0xa2,0x03,0x86,0x3c,0x8a,0x0a,0x24,0x3c,0xf0,0x10,0x05,0x3c,
  0x49,0xff,0x29,0x7e,0xb0,0x08,0x4a,0xd0,0xfb,0x98,0x9d,0x56,0x03,0xc8,0xe8,0x10,
  0xe5,0x20,0x58,0xff,0xba,0xbd,0x00,0x01,0x0a,0x0a,0x0a,0x0a,0x85,0x2b,0xaa,0xbd,
  0x8e,0xc0,0xbd,0x8c,0xc0,0xbd,0x8a,0xc0,0xbd,0x89,0xc0,0xa0,0x50,0xbd,0x80,0xc0,
  0x98,0x29,0x03,0x0a,0x05,0x2b,0xaa,0xbd,0x81,0xc0,0xa9,0x56,0x20,0xa8,0xfc,0x88,
  0x10,0xeb,0x85,0x26,0x85,0x3d,0x85,0x41,0xa9,0x08,0x85,0x27,0x18,0x08,0xbd,0x8c,
  0xc0,0x10,0xfb,0x49,0xd5,0xd0,0xf7,0xbd,0x8c,0xc0,0x10,0xfb,0xc9,0xaa,0xd0,0xf3,
  0xea,0xbd,0x8c,0xc0,0x10,0xfb,0xc9,0x96,0xf0,0x09,0x28,0x90,0xdf,0x49,0xad,0xf0,
  0x25,0xd0,0xd9,0xa0,0x03,0x85,0x40,0xbd,0x8c,0xc0,0x10,0xfb,0x2a,0x85,0x3c,0xbd,
  0x8c,0xc0,0x10,0xfb,0x25,0x3c,0x88,0xd0,0xec,0x28,0xc5,0x3d,0xd0,0xbe,0xa5,0x40,
  0xc5,0x41,0xd0,0xb8,0xb0,0xb7,0xa0,0x56,0x84,0x3c,0xbc,0x8c,0xc0,0x10,0xfb,0x59,
  0xd6,0x02,0xa4,0x3c,0x88,0x99,0x00,0x03,0xd0,0xee,0x84,0x3c,0xbc,0x8c,0xc0,0x10,
  0xfb,0x59,0xd6,0x02,0xa4,0x3c,0x91,0x26,0xc8,0xd0,0xef,0xbc,0x8c,0xc0,0x10,0xfb,
  0x59,0xd6,0x02,0xd0,0x87,0xa0,0x00,0xa2,0x56,0xca,0x30,0xfb,0xb1,0x26,0x5e,0x00,
  0x03,0x2a,0x5e,0x00,0x03,0x2a,0x91,0x26,0xc8,0xd0,0xee,0xe6,0x27,0xe6,0x3d,0xa5,
  0x3d,0xcd,0x00,0x08,0xa6,0x2b,0x90,0xdb,0x4c,0x01,0x08,0x00,0x00,0x00,0x00,0x00
]

//------------------------------------------------------------------------------
// MARK: NTSC

// NTSC tables -- 262 lines, 65 horizontal cycles

const clockVertOffsetsHires = [
  // lines 0-63
  0x0000,0x0400,0x0800,0x0C00,0x1000,0x1400,0x1800,0x1C00,
  0x0080,0x0480,0x0880,0x0C80,0x1080,0x1480,0x1880,0x1C80,
  0x0100,0x0500,0x0900,0x0D00,0x1100,0x1500,0x1900,0x1D00,
  0x0180,0x0580,0x0980,0x0D80,0x1180,0x1580,0x1980,0x1D80,
  0x0200,0x0600,0x0A00,0x0E00,0x1200,0x1600,0x1A00,0x1E00,
  0x0280,0x0680,0x0A80,0x0E80,0x1280,0x1680,0x1A80,0x1E80,
  0x0300,0x0700,0x0B00,0x0F00,0x1300,0x1700,0x1B00,0x1F00,
  0x0380,0x0780,0x0B80,0x0F80,0x1380,0x1780,0x1B80,0x1F80,
  // lines 64-127
  0x0000,0x0400,0x0800,0x0C00,0x1000,0x1400,0x1800,0x1C00,
  0x0080,0x0480,0x0880,0x0C80,0x1080,0x1480,0x1880,0x1C80,
  0x0100,0x0500,0x0900,0x0D00,0x1100,0x1500,0x1900,0x1D00,
  0x0180,0x0580,0x0980,0x0D80,0x1180,0x1580,0x1980,0x1D80,
  0x0200,0x0600,0x0A00,0x0E00,0x1200,0x1600,0x1A00,0x1E00,
  0x0280,0x0680,0x0A80,0x0E80,0x1280,0x1680,0x1A80,0x1E80,
  0x0300,0x0700,0x0B00,0x0F00,0x1300,0x1700,0x1B00,0x1F00,
  0x0380,0x0780,0x0B80,0x0F80,0x1380,0x1780,0x1B80,0x1F80,
  // lines 128-191
  0x0000,0x0400,0x0800,0x0C00,0x1000,0x1400,0x1800,0x1C00,
  0x0080,0x0480,0x0880,0x0C80,0x1080,0x1480,0x1880,0x1C80,
  0x0100,0x0500,0x0900,0x0D00,0x1100,0x1500,0x1900,0x1D00,
  0x0180,0x0580,0x0980,0x0D80,0x1180,0x1580,0x1980,0x1D80,
  0x0200,0x0600,0x0A00,0x0E00,0x1200,0x1600,0x1A00,0x1E00,
  0x0280,0x0680,0x0A80,0x0E80,0x1280,0x1680,0x1A80,0x1E80,
  0x0300,0x0700,0x0B00,0x0F00,0x1300,0x1700,0x1B00,0x1F00,
  0x0380,0x0780,0x0B80,0x0F80,0x1380,0x1780,0x1B80,0x1F80,

  // lines 192-255
  0x0000,0x0400,0x0800,0x0C00,0x1000,0x1400,0x1800,0x1C00,
  0x0080,0x0480,0x0880,0x0C80,0x1080,0x1480,0x1880,0x1C80,
  0x0100,0x0500,0x0900,0x0D00,0x1100,0x1500,0x1900,0x1D00,
  0x0180,0x0580,0x0980,0x0D80,0x1180,0x1580,0x1980,0x1D80,
  0x0200,0x0600,0x0A00,0x0E00,0x1200,0x1600,0x1A00,0x1E00,
  0x0280,0x0680,0x0A80,0x0E80,0x1280,0x1680,0x1A80,0x1E80,
  0x0300,0x0700,0x0B00,0x0F00,0x1300,0x1700,0x1B00,0x1F00,
  0x0380,0x0780,0x0B80,0x0F80,0x1380,0x1780,0x1B80,0x1F80,
  // lines 256-261
  0x0B80,0x0F80,0x1380,0x1780,0x1B80,0x1F80
]

// 25 cycles of hblank, 40 cycles of active scan
const clockHorzOffsetsHires = [
  [ // lines 0-63
    0x68,
    0x68,0x69,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,
    0x70,0x71,0x72,0x73,0x74,0x75,0x76,0x77,
    0x78,0x79,0x7A,0x7B,0x7C,0x7D,0x7E,0x7F,

    0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
    0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,
    0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,
    0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,
    0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27
  ],
  [ // lines 64-127
    0x10,
    0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,
    0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,
    0x20,0x21,0x22,0x23,0x24,0x25,0x26,0x27,

    0x28,0x29,0x2A,0x2B,0x2C,0x2D,0x2E,0x2F,
    0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,
    0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,
    0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,
    0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F
  ],
  [ // lines 128-191
    0x38,
    0x38,0x39,0x3A,0x3B,0x3C,0x3D,0x3E,0x3F,
    0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,
    0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,

    0x50,0x51,0x52,0x53,0x54,0x55,0x56,0x57,
    0x58,0x59,0x5A,0x5B,0x5C,0x5D,0x5E,0x5F,
    0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,
    0x68,0x69,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,
    0x70,0x71,0x72,0x73,0x74,0x75,0x76,0x77
  ],

  [ // lines 192-255
    0x60,
    0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,
    0x68,0x69,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,
    0x70,0x71,0x72,0x73,0x74,0x75,0x76,0x77,

    0x78,0x79,0x7A,0x7B,0x7C,0x7D,0x7E,0x7F,
    0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
    0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,
    0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,
    0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F
  ],
  [ // lines 256-261-(319)
    0x60,
    0x60,0x61,0x62,0x63,0x64,0x65,0x66,0x67,
    0x68,0x69,0x6A,0x6B,0x6C,0x6D,0x6E,0x6F,
    0x70,0x71,0x72,0x73,0x74,0x75,0x76,0x77,

    0x78,0x79,0x7A,0x7B,0x7C,0x7D,0x7E,0x7F,
    0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
    0x08,0x09,0x0A,0x0B,0x0C,0x0D,0x0E,0x0F,
    0x10,0x11,0x12,0x13,0x14,0x15,0x16,0x17,
    0x18,0x19,0x1A,0x1B,0x1C,0x1D,0x1E,0x1F,
  ]
]

function getFloatingHiresAddress(cycleCount: number, page: number) {
  const videoClockVert = Math.floor(cycleCount / 65) % 262
  const videoClockHorz = cycleCount % 65
  return clockVertOffsetsHires[videoClockVert]
    + clockHorzOffsetsHires[videoClockVert >> 6][videoClockHorz]
    + 0x2000 + page * 0x2000
}

// TODO: fix tearing that occurs in Kaboom explosion flash
//  when using vaporlock

//------------------------------------------------------------------------------
