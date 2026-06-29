
import { AtariMachine } from "./atari"

import { CoordinateInfo } from '../../display/display'
import { Tool } from '../../display/tools'

//------------------------------------------------------------------------------

export enum MariaReg {

  inptctrl = 0x01,  // 0x01 - INPUT PORT CONTROL("VBLANK" IN TIA) WO

  inpt0 = 0x08,     // 0x08 - PADDLE CONTROL INPUT 0      RO
  inpt1,            // 0x09 - PADDLE CONTROL INPUT 1      RO
  inpt2,            // 0x0A - PADDLE CONTROL INPUT 2      RO
  inpt3,            // 0x0B - PADDLE CONTROL INPUT 3      RO
  inpt4,            // 0x0C - PLAYER 0 FIRE BUTTON INPUT  RO
  inpt5,            // 0x0D - PLAYER 1 FIRE BUTTON INPUT  RO

  audc0 = 0x15,     // 0x15 - AUDIO CONTROL CHANNEL 0     WO
  audc1,            // 0x16 - AUDIO CONTROL CHANNEL 1     WO
  audf0,            // 0x17 - AUDIO FREQUENCY CHANNEL 0   WO
  audf1,            // 0x18 - AUDIO FREQUENCY CHANNEL 1   WO
  audv0,            // 0x19 - AUDIO VOLUME CHANNEL 0      WO
  audv1,            // 0x1A - AUDIO VOLUME CHANNEL 1      WO

  backgrnd = 0x20,  // 0x20 - BACKGROUND COLOR        R/W
  p0c1,             // 0x21 - PALETTE 0 - COLOR 1     R/W
  p0c2,             // 0x22 - PALETTE 0 - COLOR 2     R/W
  p0c3,             // 0x23 - PALETTE 0 - COLOR 3     R/W
  wsync,            // 0x24 - WAIT FOR SYNC           STROBE
  p1c1,             // 0x25 - PALETTE 1 – COLOR 1     R/W
  p1c2,             // 0x26 - PALETTE 1 – COLOR 2     R/W
  p1c3,             // 0x27 - PALETTE 1 – COLOR 3     R/W
  mstat,            // 0x28 - MARIA STATUS            RO
  p2c1,             // 0x29 - PALETTE 2 – COLOR 1     R/W
  p2c2,             // 0x2A - PALETTE 2 – COLOR 2     R/W
  p2c3,             // 0x2B - PALETTE 2 – COLOR 3     R/W
  dpph,             // 0x2C - DISPLAY LIST LIST POINT HIGH WO
  p3c1,             // 0x2D - PALETTE 3 – COLOR 1     R/W
  p3c2,             // 0x2E - PALETTE 3 – COLOR 2     R/W
  p3c3,             // 0x2F - PALETTE 3 – COLOR 3     R/W
  dppl,             // 0x30 - DISPLAY LIST LIST POINT LOW WO
  p4c1,             // 0x31 - PALETTE 4 – COLOR 1     R/W
  p4c2,             // 0x32 - PALETTE 4 – COLOR 2     R/W
  p4c3,             // 0x33 - PALETTE 4 – COLOR 3     R/W
  charbase,         // 0x34 - CHARACTER BASE ADDRESS  WO
  p5c1,             // 0x35 - PALETTE 5 – COLOR 1     R/W
  p5c2,             // 0x36 - PALETTE 5 – COLOR 2     R/W
  p5c3,             // 0x37 - PALETTE 5 – COLOR 3     R/W
  offset,           // 0x38 - FOR FUTURE EXPANSION    R/W
  p6c1,             // 0x39 - PALETTE 6 – COLOR 1     R/W
  p6c2,             // 0x3A - PALETTE 6 – COLOR 2     R/W
  p6c3,             // 0x3B - PALETTE 6 – COLOR 3     R/W
  ctrl,             // 0x3C - MARIA CONTROL REGISTER  WO
  p7c1,             // 0x3D - PALETTE 7 – COLOR 1     R/W
  p7c2,             // 0x3E - PALETTE 7 – COLOR 2     R/W
  p7c3,             // 0x3F - PALETTE 7 – COLOR 3     R/W
}

enum OutputMode {
  //        WRR
  m160A = 0b000,
  m320D = 0b010,
  m320A = 0b011,
  m160B = 0b100,
  m320B = 0b110,
  m320C = 0b111,
}

const OutputModeNames = [
  "160A",
  "320D",
  "320A",
  "160B",
  "320B",
  "320C",
]

//------------------------------------------------------------------------------

type DllistLog = {
  dllBaseAddr: number     // starting address of 3 byte dlist entries
  dlists: DlistLog[]
}

type DlistLog = {
  dllAddr: number         // address of this 3 byte dlist entry in memory
  dlInt: boolean
  holeyMode: number
  height: number
  dlBaseAddr: number
  dlLines: DlLineLog[]
}

type DlLineLog = {
  dlist: DlistLog
  colorRegs: number[]
  dlSegments: DlSegmentLog[]
  lineCycles: number
}

type DlSegmentLog = {
  dlSegAddr: number
  modeByte: number
  graphAddr: number
  writeMode: number
  indirectMode: boolean
  paletteIndex: number
  byteWidth: number
  hleft: number             // in 320 pixels, inclusive
  hright: number            // in 320 pixels, wrapped, exclusive
  outputMode: number        // implicit capture of readMode
  srcAddr: number
  srcIndAddrs?: number[]
  segData: number[]
}


class MariaLogger {

  public curDllist?: DllistLog
  private curDlist?: DlistLog
  private curDlLine?: DlLineLog
  private curDlSeg?: DlSegmentLog

  constructor(private maria: Maria) {
  }

  public logDllStart(dllBaseAddr: number) {
    this.curDllist = {
      dllBaseAddr,
      dlists: []
    }
  }

  public logDlist(dlist: DlistLog) {
    if (this.curDllist) {
      this.curDlist = dlist
      this.curDllist.dlists.push(dlist)
    }
  }

  public logDlLineStart(colorRegs: number[]) {
    if (this.curDlist) {
      this.curDlLine = {
        dlist: this.curDlist!,
        colorRegs,
        dlSegments: [],
        lineCycles: 0
      }
      this.curDlist.dlLines.push(this.curDlLine)
    }
  }

  public logDlSegment(dlSeg: DlSegmentLog) {
    this.curDlSeg = dlSeg
    this.curDlLine!.dlSegments.push(dlSeg)
  }

  public logSegAddr(srcAddr: number) {
    this.curDlSeg!.srcAddr = srcAddr
  }

  public logSegIndAddr(srcAddr: number) {
    if (this.curDlSeg!.srcIndAddrs == undefined) {
      this.curDlSeg!.srcIndAddrs = []
    }
    this.curDlSeg!.srcIndAddrs.push(srcAddr)
  }

  public logSegData(segData: number) {
    this.curDlSeg!.segData.push(segData)
  }

  public logLineCycles(lineCycles: number) {
    if (this.curDlLine) {
      this.curDlLine.lineCycles = lineCycles
    }
  }

  public logSegHRight(hright: number) {
    this.curDlSeg!.hright = hright
  }

  public logDllEnd(): DllistLog | undefined {
    const result = this.curDllist
    this.curDllist = undefined
    return result
  }
}

type DlineInfo = {
  dllist: DllistLog
  dlist: DlistLog
  dlIndex: number
  y0: number
  y1: number
  dlLine: DlLineLog
  dlSegs: DlSegmentLog[]
}

function findDlineInfo(x: number, y: number, dllistTop: DllistLog | undefined, dllistBot: DllistLog): DlineInfo | undefined {

  if (x < 0 || y < 0) {
    return
  }

  let result: DlineInfo | undefined

  for (const dllist of [dllistTop, dllistBot]) {
    if (dllist) {
      let y0 = 0
      let y1 = 0
      for (let i = 0; i < dllist.dlists.length; i += 1) {
        const dlist = dllist.dlists[i]
        y0 = y1
        y1 += dlist.height
        if (y >= y1) {
          continue
        }
        if (y - y0 < dlist.dlLines.length) {
          result = {
            dllist: dllist,
            dlist: dlist,
            dlIndex: i,
            y0,
            y1,
            dlLine: dlist.dlLines[y - y0],
            dlSegs: []
          }
        }
        break
      }
      if (result) {
        break
      }
    }
  }

  if (result) {
    for (const dseg of result.dlLine.dlSegments) {
      if (dseg.hleft < dseg.hright) {
        if (x >= dseg.hleft && x < dseg.hright) {
          result.dlSegs.push(dseg)
        }
      } else {
        if (x >= dseg.hleft || x < dseg.hright) {
          result.dlSegs.push(dseg)
        }
      }
    }
  }

  return result
}

function buildYAlignment(dllistTop: DllistLog | undefined, dllistBot: DllistLog): number[] {
  const result: number[] = []
  let nextY = 0
  if (dllistTop) {
    for (const dlist of dllistTop.dlists) {
      let y = nextY
      if (dlist.dlInt) {
        y += 0x1000
      }
      result.push(y)

      if (dlist.dlLines.length < dlist.height) {
        break
      }
      nextY += dlist.height
    }
  }

  let restartY = nextY
  nextY = 0

  for (const dlist of dllistBot.dlists) {
    let y = nextY
    if (y >= restartY) {
      if (dlist.dlInt) {
        y += 0x1000
      }
      result.push(y)
    }
    nextY += dlist.height
  }

  result.push(nextY)
  return result
}

//------------------------------------------------------------------------------

export class Maria {

  private machine: AtariMachine

  private registers: number[] = new Array(0x20)
  public colorRegs: number[] = new Array(0x20)
  private scanline: number[] = new Array(0x200)

  private logger?: MariaLogger
  public dllistLog?: DllistLog

  constructor(machine: AtariMachine) {
    this.machine = machine
    // NOTE: For now, always create this.  If performance issues
    //  come up, then set to undefined by default.
    this.logger = new MariaLogger(this)
    this.reset()
  }

  // TODO: move this
  public getDisplayInfo(coordInfo: CoordinateInfo, tool: Tool, defaultStr: string): string {
    let str = defaultStr
    if (this.logger && this.dllistLog) {
      const x = coordInfo.start?.x ?? -1
      const y = coordInfo.start?.y ?? -1
      const result = findDlineInfo(x, y, this.logger?.curDllist, this.dllistLog)
      if (result?.dlLine) {

        // dlist info
        // dl:0 @ $0000 -> $0000 h:8 INT hm16
        const dlist = result.dlist
        str += `<br>dl:${result.dlIndex}` +
               ` @ $${dlist.dllAddr.toString(16)}` +
               `->$${dlist.dlBaseAddr.toString(16)}` +
               ` h:${dlist.height}` +
               `${dlist.dlInt ? " INT" : ""}` +
               (dlist.holeyMode ? ` hm${dlist.holeyMode * 8}` : "")

        // dline info
        //  cyc:999 pal: (*** HTML color boxes? *** use line mode to pixel 8 or 24 colors)

        // dseg info
        if (result.dlSegs.length > 0) {
          const seg = result.dlSegs[0]
          const index = result.dlLine.dlSegments.indexOf(seg)
          str += "<br>"
              + `s:${index}`
              + ` @ $${seg.dlSegAddr.toString(16)}`
              + `->$${seg.graphAddr.toString(16)}`
              + ` l:${seg.hleft} r:${seg.hright}`
              + ` m:${OutputModeNames[seg.outputMode]}`
          if (seg.indirectMode) {
            str += "i"
          }
        }
      }
    }
    return str
  }

  public getAlignmentY(): number[] | number {
    if (this.logger && this.dllistLog) {
      return buildYAlignment(this.logger?.curDllist, this.dllistLog)
    }
    return 8
  }

  public reset() {

    // NOTE: The Maria chip does no resetting of state
    //  itself, so this initialization is incorrect.

    // // control register settings
    // this.colorKill = false
    // this.dmaEnabled = false
    // this.charWidth = 1
    // this.blackBorder = false
    // this.kangaroo = false
    // this.readMode = 0

    // // display list list entry
    // this.dlInt = false
    // this.holeyMode = 0
    // this.offset = 0
    // this.dlAddr = 0

    // // display list entry
    // this.lineCycles = 0
    // this.graphAddr = 0
    // this.writeMode = 0
    // this.indirectMode = false
    // this.paletteIndex = 0
    // this.width = 0
    // this.horzPos = 0

    this.colorRegs = new Array(0x20).fill(0xEE)
  }

  public getState(): any {
    let state: any = {}
    state.colorKill = this.colorKill
    state.dmaEnabled = this.dmaEnabled
    state.charWidth = this.charWidth
    state.blackBorder = this.blackBorder
    state.kangaroo = this.kangaroo
    state.readMode = this.readMode

    state.curDllAddr = this.curDllAddr
    state.dllAddr = this.dllAddr
    state.dlInt = this.dlInt
    state.holeyMode = this.holeyMode
    state.offset = this.offset
    state.dlAddr = this.dlAddr

    state.graphAddr = this.graphAddr
    state.writeMode = this.writeMode
    state.indirectMode = this.indirectMode
    state.paletteIndex = this.paletteIndex
    state.width = this.width
    state.horzPos = this.horzPos

    state.registers = [...this.registers]
    state.colorRegs = [...this.colorRegs]
    state.scanline = [...this.scanline]

    // TODO: is it enough to just capture the object?
    //  Or does it need to be completely flattened?
    state.dllist = this.dllistLog
    return state
  }

  public setState(state: any) {
    this.colorKill = state.colorKill
    this.dmaEnabled = state.dmaEnabled
    this.charWidth = state.charWidth
    this.blackBorder = state.blackBorder
    this.kangaroo = state.kangaroo
    this.readMode = state.readMode

    this.curDllAddr = state.curDllAddr
    this.dllAddr = state.dllAddr
    this.dlInt = state.dlInt
    this.holeyMode = state.holeyMode
    this.offset = state.offset
    this.dlAddr = state.dlAddr

    this.graphAddr = state.graphAddr
    this.writeMode = state.writeMode
    this.indirectMode = state.indirectMode
    this.paletteIndex = state.paletteIndex
    this.width = state.width
    this.horzPos = state.horzPos

    this.registers = [...state.registers]
    this.colorRegs = [...state.colorRegs]
    this.scanline = [...state.scanline]

    this.dllistLog = state.dllist
  }

  public readConst(address: number): number {
    return this.read(address, 0)
  }

  public read(address: number, cycleCount: number): number {
    address &= 0x3f
    switch (address) {

      case MariaReg.inpt0:
      case MariaReg.inpt1:
      case MariaReg.inpt2:
      case MariaReg.inpt3:
        return this.machine.readInput(address) ^ 0x80

      case MariaReg.inpt4:
      case MariaReg.inpt5:
        return this.machine.readInput(address)

      case MariaReg.mstat:
        return this.machine.inVBlank() ? 0x80 : 0x00

      case MariaReg.backgrnd:
      case MariaReg.p0c1:
      case MariaReg.p0c2:
      case MariaReg.p0c3:
      case MariaReg.p1c1:
      case MariaReg.p1c2:
      case MariaReg.p1c3:
      case MariaReg.p2c1:
      case MariaReg.p2c2:
      case MariaReg.p2c3:
      case MariaReg.p3c1:
      case MariaReg.p3c2:
      case MariaReg.p3c3:
      case MariaReg.p4c1:
      case MariaReg.p4c2:
      case MariaReg.p4c3:
      case MariaReg.p5c1:
      case MariaReg.p5c2:
      case MariaReg.p5c3:
      case MariaReg.p6c1:
      case MariaReg.p6c2:
      case MariaReg.p6c3:
      case MariaReg.p7c1:
      case MariaReg.p7c2:
      case MariaReg.p7c3:
        return this.colorRegs[address - MariaReg.backgrnd]

      default:
        if (cycleCount == 0) {
          return this.registers[address]
        }
        return 0xEE
    }
  }

  private colorKill!: boolean
  private dmaEnabled!: boolean
  private charWidth!: number
  private blackBorder!: boolean
  private kangaroo!: boolean
  public  readMode!: number

  public write(address: number, value: number, cycleCount: number) {

    address &= 0x3f
    switch (address) {

      // INPUT PORT CONTROL
      // D0: Lock Mode: When set to 1 this bit locks the control register so
      //     that no more writes will affect it. The only way to clear the lock
      //     is to power cycle the console.
      // D1: MARIA Enable: 1 = enable MARIA (also enables system RAM), 0 = disable MARIA
      // D2: EXT: 0 = enable BIOS at $8000-$FFFF, 1 = disable BIOS / enable cartridge
      // D3: TIA-EN: 1 = enable TIA video pull-ups (video output is TIA instead of MARIA)
      //     and also disables 2 button joystick mode, 0 = disable TIA video pull-ups
      //     (video output is MARIA instead of TIA).
      case MariaReg.inptctrl:
        // TODO: need to actually implement this?
        break

      case MariaReg.audc0:
      case MariaReg.audc1:
      case MariaReg.audf0:
      case MariaReg.audf1:
      case MariaReg.audv0:
      case MariaReg.audv1:
        this.machine.writeTiaAudio(address, value)
        break

      case MariaReg.wsync:
        this.machine.cpu.requestHalt()
        break

      case MariaReg.dpph:
        this.dllAddr = (this.dllAddr & 0x00ff) + (value << 8)
        break
      case MariaReg.dppl:
        this.dllAddr = (this.dllAddr & 0xff00) + value
        break
      case MariaReg.charbase:
        break

      case MariaReg.offset:       // "future expansion"
        break

      case MariaReg.ctrl:
        this.colorKill = ((value >> 7) & 1) == 1
        const dmaControl = ((value >> 5) & 3)
        if (dmaControl == 0 || dmaControl == 1) {
          // *** throw error
        }
        this.dmaEnabled = dmaControl == 2
        this.charWidth = 1 + ((value >> 4) & 1)
        this.blackBorder = ((value >> 3) & 1) == 1
        this.kangaroo = ((value >> 2) & 1) == 1
        this.readMode = (value >> 0) & 3
        if (this.readMode == 1) {
          // *** throw error
        }
        break

      case MariaReg.backgrnd:
      case MariaReg.p0c1:
      case MariaReg.p0c2:
      case MariaReg.p0c3:
      case MariaReg.p1c1:
      case MariaReg.p1c2:
      case MariaReg.p1c3:
      case MariaReg.p2c1:
      case MariaReg.p2c2:
      case MariaReg.p2c3:
      case MariaReg.p3c1:
      case MariaReg.p3c2:
      case MariaReg.p3c3:
      case MariaReg.p4c1:
      case MariaReg.p4c2:
      case MariaReg.p4c3:
      case MariaReg.p5c1:
      case MariaReg.p5c2:
      case MariaReg.p5c3:
      case MariaReg.p6c1:
      case MariaReg.p6c2:
      case MariaReg.p6c3:
      case MariaReg.p7c1:
      case MariaReg.p7c2:
      case MariaReg.p7c3:
        // NOTE: Treat colorRegs as immutable so logging
        //  can snapshot current colorRegs by reference.
        this.colorRegs = [...this.colorRegs]
        this.colorRegs[address - MariaReg.backgrnd] = value
        return

      case MariaReg.mstat:
      default:
        // *** invalid register write
        return
    }

    this.registers[address] = value
  }

  private curDllAddr!: number
  private dllAddr!: number
  private dlInt!: boolean
  private holeyMode!: number
  private offset!: number
  private dlAddr!: number

  private graphAddr!: number
  private writeMode!: number
  private indirectMode!: boolean
  private paletteIndex!: number
  private width!: number
  private horzPos!: number

  // only valid during buildScanline
  private lineCycles!: number

  // TODO: what about left/right overscan?

  public buildScanline(lineCycles: number, firstLine: boolean):
      { scanline: number[], lineCycles: number, interrupt: boolean } {

    this.lineCycles = lineCycles

    // TODO: choose between black and background color? (just overscan?)
    this.scanline.fill(this.colorRegs[0])

    let interrupt = false
    if (this.dmaEnabled) {

      if (firstLine) {
        this.logger?.logDllStart(this.dllAddr)
        this.curDllAddr = this.dllAddr
        this.loadList()
      }

      this.logger?.logDlLineStart(this.colorRegs)

      let dlAddr = this.dlAddr
      this.lineCycles += 9    // DMA startup time

      while (this.lineCycles < 454) {

        const dlSegAddr = dlAddr

        this.graphAddr = this.readDma(dlAddr++, 2)
        const modeByte = this.readDma(dlAddr++, 2)
        if ((modeByte & 0x5f) == 0) {
          break
        }
        this.graphAddr += this.readDma(dlAddr++, 2) << 8

        let palWidth: number
        if ((modeByte & 0x1f) == 0) {
          this.writeMode = (modeByte >> 7) & 1
          this.indirectMode = (modeByte & 0x20) != 0
          palWidth = this.readDma(dlAddr++, 2)
        } else {
          this.indirectMode = false
          palWidth = modeByte
        }
        this.paletteIndex = (palWidth >> 5) & 0x7
        this.width = (~palWidth & 0x1f) + 1
        this.horzPos = this.readDma(dlAddr++, 2)

        const outputMode = (this.writeMode << 2) + this.readMode

        this.logger?.logDlSegment({
          dlSegAddr,
          modeByte,
          graphAddr: this.graphAddr,
          writeMode: this.writeMode,
          indirectMode: this.indirectMode,
          paletteIndex: this.paletteIndex,
          byteWidth: this.width,
          hleft: this.horzPos << 1,
          hright: 0,
          outputMode,
          srcAddr: 0,
          segData: []
        })

        switch (outputMode) {
          case OutputMode.m160A:
            this.buildSegment160A()
            break
          case OutputMode.m160B:
            this.buildSegment160B()
            break
          case OutputMode.m320A:
            this.buildSegment320A()
            break
          case OutputMode.m320B:
            this.buildSegment320B()
            break
          case OutputMode.m320C:
            this.buildSegment320C()
            break
          case OutputMode.m320D:
            this.buildSegment320D()
            break
        }
      }

      this.lineCycles += 7    // DMA shutdown time - 16 total
      this.logger?.logLineCycles(this.lineCycles - lineCycles)

      this.offset -= 1
      if (this.offset < 0) {
        this.loadList()       // DMA shutdown time - 24 total
        interrupt = this.dlInt
      }
    }

    // *** check this -- atari.ts instead? ***
    this.machine.cpu.clearHalt()
    return {
      scanline: this.scanline,
      lineCycles: this.lineCycles,
      interrupt
    }
  }

  public onFrameEnd() {
    this.dllistLog = this.logger?.logDllEnd()
  }

//------------------------------------------------------------------------------

//  15 vblank lines
//  10 background lines   (displayArea.top == 16-1 ...
// 223 active lines       (visibleArea 26-1 to 248-1)
//  10 background lines   ... displayArea.bottom == 258-1)
//   4 vblank lines       (total = 262)

// dllist processing starts at displayArea.top
// vblank off at displayArea.top
// vblank on after displayArea.bottom (+3 for Pole Position II)

// my visible lines = displayArea = 243


// - think about break-on-scanline


// *** 1-based values ***

//rect maria_displayArea = {0, 16, 319, 258};
// var maria_displayArea = new Rect(0, 17, 319, 258);

//rect maria_visibleArea = {0, 26, 319, 248};
// var maria_visibleArea = new Rect(0, 26, 319, 248);

    // if (maria_scanline == maria_displayArea.top) {
    //   memory_ram[MSTAT] = 0;
    // }
    // else if (maria_scanline == (maria_displayArea.bottom - prosystem_mstat_adjust /* PPII Hack */)) {
    //   memory_ram[MSTAT] = 128;
    // }

// prosystem_scanlines = 262

  // for (maria_scanline = 1; maria_scanline <= prosystem_scanlines; maria_scanline++) {

    // vblank ends at line 16 (15 blank)
  //   if (maria_scanline == maria_displayArea.top) {
  //     memory_ram[MSTAT] = 0;
  //   }
  //   else if (maria_scanline == (maria_displayArea.bottom - prosystem_mstat_adjust /* PPII Hack */)) {
  //     memory_ram[MSTAT] = 128;
  //   }

  //   // ***
  // }

//------------------------------------------------------------------------------

  private loadList() {
    const startDllAddr = this.curDllAddr
    const value = this.readDma(this.curDllAddr++, 2)
    this.dlInt = (value & 0x80) != 0
    this.holeyMode = (value >> 5) & 0x3
    this.offset = ((value >> 0) & 0xf)
    this.dlAddr = this.readDma(this.curDllAddr++, 2) << 8
    this.dlAddr += this.readDma(this.curDllAddr++, 2)
    // TODO: verify that this.dlAddr is in RAM, else throw error

    this.logger?.logDlist({
      dllAddr: startDllAddr,
      dlInt: this.dlInt,
      holeyMode: this.holeyMode,
      height: this.offset + 1,
      dlBaseAddr: this.dlAddr,
      dlLines: []
    })

    // Add extra 2 cycles to match 8 total cycles measured when next zone is loaded.
    // https://forums.atariage.com/topic/224025-7800-hardware-facts/#comment-2983361
    this.lineCycles += 2
  }

  private readDma(address: number, mpuCycles: number): number {
    this.lineCycles += mpuCycles
    return this.machine.memory.read(address, 0)
  }

  private buildSegment160A() {
    let h = this.horzPos << 1
    const paletteBits = this.paletteIndex << 2

    let srcBase!: number
    let srcAddr!: number
    let byteCount: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      this.logger?.logSegAddr(srcBase)
      byteCount = this.charWidth
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      this.logger?.logSegAddr(srcAddr)
      byteCount = 1
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase! + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegIndAddr(srcAddr)
      }
      for (let b = 0; b < byteCount; b += 1) {
        if ((this.holeyMode == 1 && (srcAddr! & 0x8800) == 0x8800) ||
            (this.holeyMode == 2 && (srcAddr! & 0x9000) == 0x9000)) {
          h = (h + 8) & 0x1ff
          srcAddr++

          // If holey DMA is enabled and graphics reads would reside in a DMA hole,
          //  only 3 cycles of penalty for the graphic read is incurred, whatever the
          //  sprite width is.
          if (i == 0 && b == 0) {
            this.lineCycles += 3
          }
          continue
        }

        const data = this.readDma(srcAddr++, 3)
        this.logger?.logSegData(data)

        let bits = (data >> 6) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits + bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff

        bits = (data >> 4) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits + bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff

        bits = (data >> 2) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits + bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff

        bits = (data >> 0) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits + bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff
      }
    }

    this.logger?.logSegHRight(h)
  }

  private buildSegment160B() {
    let h = this.horzPos << 1
    const paletteBits = (this.paletteIndex & 0x04) << 2

    let srcBase!: number
    let srcAddr!: number
    let byteCount: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      byteCount = this.charWidth
      this.logger?.logSegAddr(srcBase)
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      byteCount = 1
      this.logger?.logSegAddr(srcAddr)
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegAddr(srcAddr)
      }
      for (let b = 0; b < byteCount; b += 1) {
        if ((this.holeyMode == 1 && (srcAddr & 0x8800) == 0x8800) ||
            (this.holeyMode == 2 && (srcAddr & 0x9000) == 0x9000)) {
          h = (h + 4) & 0x1ff
          srcAddr++
          if (i == 0 && b == 0) {
            this.lineCycles += 3
          }
          continue
        }

        const data = this.readDma(srcAddr++, 3)
        this.logger?.logSegData(data)

        let bits = (data >> 6) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits | (data & 0x0c) | bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        } else if (this.kangaroo) {
          const value = this.colorRegs[0]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff

        bits = (data >> 4) & 3
        if (bits != 0) {
          const value = this.colorRegs[paletteBits | ((data & 3) << 2) | bits]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        } else if (this.kangaroo) {
          const value = this.colorRegs[0]
          this.scanline[h] = value
          this.scanline[h + 1] = value
        }
        h = (h + 2) & 0x1ff
      }
    }

    this.logger?.logSegHRight(h)
  }

  private buildSegment320A() {
    let h = this.horzPos << 1
    const paletteBits = (this.paletteIndex << 2) | 2

    let srcBase!: number
    let srcAddr!: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      this.logger?.logSegAddr(srcBase)
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      this.logger?.logSegAddr(srcAddr)
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegIndAddr(srcAddr)
      }

      if ((this.holeyMode == 1 && (srcAddr & 0x8800) == 0x8800) ||
          (this.holeyMode == 2 && (srcAddr & 0x9000) == 0x9000)) {
        h = (h + 8) & 0x1ff
        srcAddr++
        if (i == 0) {
          this.lineCycles += 3
        }
        continue
      }

      const data = this.readDma(srcAddr++, 3)
      this.logger?.logSegData(data)
      const value = this.colorRegs[paletteBits]

      if ((data & 0xc0) != 0) {
        if ((data & 0x80) != 0) {
          this.scanline[h] = value
        } else {
          this.scanline[h] = this.colorRegs[0]
        }
        if ((data & 0x40) != 0) {
          this.scanline[h + 1] = value
        } else {
          this.scanline[h + 1] = this.colorRegs[0]
        }
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
        this.scanline[h + 1] = this.colorRegs[0]
      }
      h = (h + 2) & 0x1ff

      if ((data & 0x30) != 0) {
        if ((data & 0x20) != 0) {
          this.scanline[h] = value
        } else {
          this.scanline[h] = this.colorRegs[0]
        }
        if ((data & 0x10) != 0) {
          this.scanline[h + 1] = value
        } else {
          this.scanline[h + 1] = this.colorRegs[0]
        }
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
        this.scanline[h + 1] = this.colorRegs[0]
      }
      h = (h + 2) & 0x1ff

      if ((data & 0x0c) != 0) {
        if ((data & 0x08) != 0) {
          this.scanline[h] = value
        } else {
          this.scanline[h] = this.colorRegs[0]
        }
        if ((data & 0x04) != 0) {
          this.scanline[h + 1] = value
        } else {
          this.scanline[h + 1] = this.colorRegs[0]
        }
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
        this.scanline[h + 1] = this.colorRegs[0]
      }
      h = (h + 2) & 0x1ff

      if ((data & 0x03) != 0) {
        if ((data & 0x02) != 0) {
          this.scanline[h] = value
        } else {
          this.scanline[h] = this.colorRegs[0]
        }
        if ((data & 0x01) != 0) {
          this.scanline[h + 1] = value
        } else {
          this.scanline[h + 1] = this.colorRegs[0]
        }
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
        this.scanline[h + 1] = this.colorRegs[0]
      }
      h = (h + 2) & 0x1ff
    }

    this.logger?.logSegHRight(h)
  }

  private buildSegment320B() {
    let h = this.horzPos << 1
    const paletteBits = (this.paletteIndex & 0x04) << 2

    let srcBase!: number
    let srcAddr!: number
    let byteCount: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      byteCount = this.charWidth
      this.logger?.logSegAddr(srcBase)
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      byteCount = 1
      this.logger?.logSegAddr(srcAddr)
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegIndAddr(srcAddr)
      }
      for (let b = 0; b < byteCount; b += 1) {
        if ((this.holeyMode == 1 && (srcAddr & 0x8800) == 0x8800) ||
            (this.holeyMode == 2 && (srcAddr & 0x9000) == 0x9000)) {
          h = (h + 4) & 0x1ff
          srcAddr++
          if (i == 0 && b == 0) {
            this.lineCycles += 3
          }
          continue
        }

        const data = this.readDma(srcAddr++, 3)
        this.logger?.logSegData(data)

        let bits = ((data >> 6) & 2) | ((data >> 3) & 1)
        if (bits != 0) {
          if ((data & 0xc0) || this.kangaroo) {
            this.scanline[h] = this.colorRegs[paletteBits | bits]
          }
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data >> 5) & 2) | ((data >> 2) & 1)
        if (bits != 0) {
          if ((data & 0xc0) || this.kangaroo) {
            this.scanline[h] = this.colorRegs[paletteBits | bits]
          }
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff

        bits = ((data >> 4) & 2) | ((data >> 1) & 1)
        if (bits != 0) {
          if ((data & 0x30) || this.kangaroo) {
            this.scanline[h] = this.colorRegs[paletteBits | bits]
          }
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data >> 3) & 2) | ((data >> 0) & 1)
        if (bits != 0) {
          if ((data & 0x30) || this.kangaroo) {
            this.scanline[h] = this.colorRegs[paletteBits | bits]
          }
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff
      }
    }

    this.logger?.logSegHRight(h)
  }

  private buildSegment320C() {
    let h = this.horzPos << 1
    const paletteBits = ((this.paletteIndex & 4) << 2) | 2

    let srcBase!: number
    let srcAddr!: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      this.logger?.logSegAddr(srcBase)
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      this.logger?.logSegAddr(srcAddr)
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegIndAddr(srcAddr)
      }
      if ((this.holeyMode == 1 && (srcAddr & 0x8800) == 0x8800) ||
          (this.holeyMode == 2 && (srcAddr & 0x9000) == 0x9000)) {
        h = (h + 4) & 0x1ff
        srcAddr++
        if (i == 0) {
          this.lineCycles += 3
        }
        continue
      }

      const data = this.readDma(srcAddr++, 3)
      this.logger?.logSegData(data)
      let value = this.colorRegs[((data << 0) & 0x0C) | paletteBits]

      if ((data & 0x80) != 0) {
        this.scanline[h] = value
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
      }
      h += 1

      if ((data & 0x40) != 0) {
        this.scanline[h] = value
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
      }
      h = (h + 1) & 0x1ff

      value = this.colorRegs[((data << 2) & 0x0C) | paletteBits]

      if ((data & 0x20) != 0) {
        this.scanline[h] = value
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
      }
      h += 1

      if ((data & 0x10) != 0) {
        this.scanline[h] = value
      } else if (this.kangaroo) {
        this.scanline[h] = this.colorRegs[0]
      }
      h = (h + 1) & 0x1ff
    }

    this.logger?.logSegHRight(h)
  }

  private buildSegment320D() {
    let h = this.horzPos << 1
    const paletteBits = (this.paletteIndex << 2) & 0x10
    const pbit0 = (this.paletteIndex >> 0) & 1
    const pbit1 = (this.paletteIndex >> 1) & 1

    let srcBase!: number
    let srcAddr!: number
    let byteCount: number
    if (this.indirectMode) {
      srcBase = (this.registers[MariaReg.charbase] + this.offset) << 8
      this.logger?.logSegAddr(srcBase)
      byteCount = this.charWidth
    } else {
      srcAddr = this.graphAddr + (this.offset << 8)
      this.logger?.logSegAddr(srcAddr)
      byteCount = 1
    }

    for (let i = 0; i < this.width; i += 1) {
      if (this.indirectMode) {
        srcAddr = srcBase + this.readDma(this.graphAddr + i, 3)
        this.logger?.logSegIndAddr(srcAddr)
      }
      for (let b = 0; b < byteCount; b += 1) {
        if ((this.holeyMode == 1 && (srcAddr & 0x8800) == 0x8800) ||
            (this.holeyMode == 2 && (srcAddr & 0x9000) == 0x9000)) {
          h = (h + 8) & 0x1ff
          srcAddr++
          if (i == 0 && b == 0) {
            this.lineCycles += 3
          }
          continue
        }

        const data = this.readDma(srcAddr++, 3)
        this.logger?.logSegData(data)

        let bits = ((data >> 6) & 2) + pbit1
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data >> 5) & 2) + pbit0
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff

        bits = ((data >> 4) & 2) + pbit1
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data >> 3) & 2) + pbit0
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff

        bits = ((data >> 2) & 2) + pbit1
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data >> 1) & 2) + pbit0
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff

        bits = ((data >> 0) & 2) + pbit1
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h += 1

        bits = ((data << 1) & 2) + pbit0
        if (bits != 0) {
          this.scanline[h] = this.colorRegs[paletteBits + bits]
        } else if (this.kangaroo) {
          this.scanline[h] = this.colorRegs[0]
        }
        h = (h + 1) & 0x1ff
      }
    }

    this.logger?.logSegHRight(h)
  }
}

//------------------------------------------------------------------------------

// from GCC docs:
//  DMA Cycle Timing
//  Short Header    8 cycles
//  Long Header 	   10 cycles
//  Graphics, pre byte 3 cycles
//  Indirect map fetch   3 cycles (plus one or two graphics fetches)
//  DMA startup 5-12 cycles
//  DMA shutdown, short 13-17 cycles
//  DMA shutdown, long 19-23 cycles (list-list fetch)
//  End-of-Vblank DMA 7+ cycles
//
// 16 vblank
// 242 active lines (25 + 192 + 25)
// 4 vblank
//
//    H   B                     B    H
// H  B   O                     O    B
// S  L   R                     R    L
// Y  A   D                     D    A
// N  N   E                     E    N
// C  K   R                     R    K
// +--+---+----+----------------+----+----+
// 0  34  68   93               413  440  452
// (other docs claim 454, not 452)


// DMA start-up and shutdown, last line in zone     24 cycles*
// DMA start-up and shutdown, other lines in zone   16 cycles
// process 4-byte DL header	                        8 cycles
// process 5-byte DL header	                        10 cycles
// direct graphics data read	                      3 cycles per byte of data read
// indirect 1-byte read	                            6 cycles
// indirect 2-byte read	                            9 cycles

// * The DMA start-up may be delayed if the 6502 clock isn't at the end
//  of a cycle when DMA begins. Up to 3 additional cycles are lost for
//  DMA if the 6502 is at normal speed, or up to 5 additional cycles are
//  lost if the 6502 happens to be slowed down for TIA access. DMA start-up
//  delay usually occurs every other scanline, since a scanline length is
//  113.5 6502 cycles long.

// If holey DMA is enabled and graphics reads would reside in a DMA hole,
//  only 3 cycles of penalty for the graphic read is incurred, whatever the
//  sprite width is.

// The end of VBLANK is made up of a DMA startup plus a Long shutdown.

// !!! DMA does not begin until 7 CPU (1.79 MHz) cycles into each scan line.
//  The significance of this is that there is enough time to change a color,
//  or change CTRL before DMA begins, and during HBLANK (before display begins).
//  This figure should, however, be included in any DMA usage calculations.

// Another timing consideration is there is one MPU (7.16 MHz) cycle between
//  DMA shutdown and generation of a DLI.

//------------------------------------------------------------------------------
