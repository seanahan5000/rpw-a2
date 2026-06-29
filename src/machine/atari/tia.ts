
import { AtariMachine } from "./atari"

const H_PIXEL = 160             // PIXELS_PER_LINE *** or just get rid of ***
const H_CYCLES = 76             // CPU_CYCLES_PER_LINE
const CLOCKS_PER_CYCLE = 3
const H_CLOCKS = H_CYCLES * CLOCKS_PER_CYCLE  // = 228      *** HCLOCKS_PER_LINE
const H_BLANK_CLOCKS = H_CLOCKS - H_PIXEL // = 68

//------------------------------------------------------------------------------

enum TiaRReg {
  cxm0p,    // 0x0 -
  cxm1p,    // 0x1 -
  cxp0fb,   // 0x2 -
  cxp1fb,   // 0x3 -
  cxm0fb,   // 0x4 -
  cxm1fb,   // 0x5 -
  cxblpf,   // 0x6 -
  cxppmm,   // 0x7 -
  inpt0,    // 0x8 -
  inpt1,    // 0x9 -
  inpt2,    // 0xA -
  inpt3,    // 0xB -
  inpt4,    // 0xC -
  inpt5,    // 0xD -
}

enum TiaWReg {
  vsync,    // 0x00 - vertical sync set/clear
  vblank,   // 0x01 - vertical blank set/clear
  wsync,    // 0x02 - wait for hblank
  rsync,    // 0x03 - reset hsync count
  nusiz0,   // 0x04 - num/size player/missile 0
  nusiz1,   // 0x05 - num/size player/missile 1
  colup0,   // 0x06 - color/lum player 0
  colup1,   // 0x07 - color/lum player 1
  colupf,   // 0x08 - color/lum playfield
  colubk,   // 0x09 - color/lum background
  ctrlpf,   // 0x0A - control playfield/ball/collisions
  refp0,    // 0x0B - reflect player 0
  refp1,    // 0x0C - reflect player 1
  pf0,      // 0x0D - playfield register byte 0
  pf1,      // 0x0E - playfield register byte 1
  pf2,      // 0x0F - playfield register byte 2
  resp0,    // 0x10 - reset player 0
  resp1,    // 0x11 - reset player 1
  resm0,    // 0x12 - reset missile 0
  resm1,    // 0x13 - reset missile 1
  resbl,    // 0x14 - reset ball
  audc0,    // 0x15 - audio control 0
  audc1,    // 0x16 - audio control 1
  audf0,    // 0x17 - audio frequency 0
  audf1,    // 0x18 - audio frequency 1
  audv0,    // 0x19 - audio volume 0
  audv1,    // 0x1A - audio volume 1
  grp0,     // 0x1B - graphics register player 0
  grp1,     // 0x1C - graphics register player 1
  enam0,    // 0x1D - enable missile 0
  enam1,    // 0x1E - enable missile 1
  enabl,    // 0x1F - enable ball
  hmp0,     // 0x20 - horizontal motion player 0
  hmp1,     // 0x21 - horizontal motion player 1
  hmm0,     // 0x22 - horizontal motion missile 0
  hmm1,     // 0x23 - horizontal motion missile 1
  hmbl,     // 0x24 - horizontal motion ball
  vdelp0,   // 0x25 - vertical delay player 0
  vdelp1,   // 0x26 - vertical delay player 1
  vdelbl,   // 0x27 - vertical delay ball
  resmp0,   // 0x28 - reset missile 0 to player 0
  resmp1,   // 0x29 - reset missile 1 to player 1
  hmove,    // 0x2A - apply horizontal motion
  hmclr,    // 0x2B - clear horizontal move registers
  cxclr,    // 0x2C - clear collision latches
}

enum Delay {
  vblank  = 1,
  refp    = 1,
  pf      = 2,
  grp     = 1,
  enam    = 1,
  enabl   = 1,
  hmp     = 2,
  hmm     = 2,
  hmbl    = 2,
  hmove   = 6,
  hmclr   = 2,
}

enum CollisionMask {
  player0   = 0b0111110000000000,
  player1   = 0b0100001111000000,
  missile0  = 0b0010001000111000,
  missile1  = 0b0001000100100110,
  ball      = 0b0000100010010101,
  playfield = 0b0000010001001011,
}

//------------------------------------------------------------------------------

type DelayEntry = {
  address: number
  value: number
  delay: number
}

class DelayQueue {

  private entries: DelayEntry[] = []

  public reset() {
    this.entries = []
  }

  public push(address: number, value: number, delay: number) {
    this.entries.push({ address, value, delay })
  }

  public execute(callback: (address: number, value: number) => void) {
    let length = this.entries.length
    while (--length >= 0) {
      const entry = this.entries.shift()!
      if (--entry.delay < 0) {                // *** <= ???
        callback(entry.address, entry.value)
      } else {
        this.entries.push(entry)
      }
    }
  }
}

//------------------------------------------------------------------------------
// MARK: TIA

const OverscanLines = 26      // TODO: share with formats

export class Tia {

  // *** move out of here into common frame generator ***
  public frameBuffer: Uint8Array = new Uint8Array(160 * (192 + OverscanLines)) // ***
  public frameX: number = 0
  public frameY: number = 0
  // ***

  private machine: AtariMachine
  private background: Background
  private playfield: Playfield
  private player0: Player
  private player1: Player
  private missile0: Missile
  private missile1: Missile
  private ball: Ball

  private delayQueue = new DelayQueue()
  private readRegs: number[] = new Array(0x10)
  private writeRegs: number[] = new Array(0x40)

  private prevCycles: number = 0
  private extraClocks: number = 0

  private inVSync: boolean = false
  private inVBlank: boolean = true

  public inHBlank: boolean = true
  private extendedHBlank: boolean = false
  private hcounter: number = 0
  private hdelta: number = 0
  private inMotion: boolean = false
  private moveClock: number = 0

  private collisionMask: number = 0
  private priority: number = 0

  constructor(machine: AtariMachine) {
    this.machine = machine
    this.background = new Background(this)
    this.playfield = new Playfield(this, CollisionMask.playfield)
    this.player0 = new Player(0, this, CollisionMask.player0)
    this.player1 = new Player(1, this, CollisionMask.player1)
    this.missile0 = new Missile(0, this, CollisionMask.missile0)
    this.missile1 = new Missile(1,this, CollisionMask.missile1)
    this.ball = new Ball(this, CollisionMask.ball)
  }

  public reset() {
    this.background.reset()
    this.playfield.reset()
    this.player0.reset()
    this.player1.reset()
    this.missile0.reset()
    this.missile1.reset()
    this.ball.reset()
    this.delayQueue.reset()
    this.readRegs.fill(0)
    this.writeRegs.fill(0)

    this.prevCycles = 0
    this.extraClocks = 0

    this.inVSync = false
    this.inVBlank = true

    this.inHBlank = true
    this.extendedHBlank = false
    this.hcounter = 0
    this.hdelta = 0
    this.inMotion = false
    this.moveClock = 0

    this.collisionMask = 0
    this.priority = 0

    // ***
    this.frameX = 0
    this.frameY = 0
  }

  public getState(): any {
    let state: any = {}
    // ***
    return state
  }

  public setState(state: any) {
    // ***
  }

  // *** maybe in display clock instead? ***
  public onHalt(cycleCount: number): number {
    this.update(cycleCount)   // ***??? (always delta of just 1 cycle?)
    this.extraClocks = (H_CLOCKS - this.hcounter) % H_CLOCKS
    const haltCycles = Math.floor(this.extraClocks / CLOCKS_PER_CYCLE)
    this.extraClocks %= CLOCKS_PER_CYCLE
    return cycleCount + haltCycles
  }

  public update(cycleCount: number) {

    // *** update pia from here too?

    const cycleDelta = cycleCount - this.prevCycles     // *** fold back in
    let colorClocks = cycleDelta * CLOCKS_PER_CYCLE + this.extraClocks
    this.prevCycles = cycleCount
    this.extraClocks = 0

    while (--colorClocks >= 0) {

      this.delayQueue.execute((address, value) => { this.delayedWrite(address, value) })

      // *** collision checks

      // if (this.linesSinceChange < 2) {  // ***

        this.clockMotion()

        if (this.inHBlank) {
          this.clockHBlank()
        } else {
          this.clockHActive()
        }

        // *** check collisions
      // }

      if (++this.hcounter >= H_CLOCKS) {
        this.nextLine()
        // *** only eat extra cycles if wsync completed
        // colorClocks = 0
      }

      // *** audio ticks
    }
  }

  private clockMotion() {
    if (this.inMotion) {

      if ((this.hcounter & 3) == 0) {

        const moveCounter = this.moveClock > 15 ? 0 : this.moveClock
        this.player0.clockMotion(moveCounter, this.hcounter)
        this.player1.clockMotion(moveCounter, this.hcounter)
        this.missile0.clockMotion(moveCounter, this.hcounter)
        this.missile1.clockMotion(moveCounter, this.hcounter)
        this.ball.clockMotion(moveCounter, this.hcounter)

        this.inMotion =
          this.player0.inMotion ||
          this.player1.inMotion ||
          this.missile0.inMotion ||
          this.missile1.inMotion ||
          this.ball.inMotion

        this.moveClock += 1
      }
    }
  }

  private clockHBlank() {
    if (this.hcounter == 0) {
      this.extendedHBlank = false
      // this.cpu.clearHalt()          // ***???
    } else if (this.hcounter == H_BLANK_CLOCKS - 1) {
      if (!this.extendedHBlank) {
        this.inHBlank = false
      }
    } else if (this.hcounter == H_BLANK_CLOCKS + 7) {
      if (this.extendedHBlank) {
        this.inHBlank = false
      }
    }

    // if (this._extendedHblank && this._hctr > 67) {
    //     this._playfield.tick(this._hctr - 68 + this._xDelta);
    // }

    // if (myExtendedHblank && myHctr - myHctrDelta > TIAConstants::H_BLANK_CLOCKS - 1)
    //   myPlayfield.tick(myHctr - TIAConstants::H_BLANK_CLOCKS - myHctrDelta);

    if (this.extendedHBlank) {
      const fpClocks = this.hcounter - this.hdelta - H_BLANK_CLOCKS
      if (fpClocks > 0) {
        this.playfield.clock(fpClocks)
      }
    }
  }

  private clockHActive() {

    this.frameX = this.hcounter - H_BLANK_CLOCKS - this.hdelta

    this.playfield.clock(this.frameX)
    this.player0.clock(this.hcounter)
    this.player1.clock(this.hcounter)
    this.missile0.clock(this.hcounter)
    this.missile1.clock(this.hcounter)
    this.ball.clock(this.hcounter)

    if (!this.inVBlank /*&& !this.inVSync*/) {
      this.renderPixel(this.frameX, this.frameY)
    }
  }

  private nextLine() {

    this.hcounter = 0
    this.hdelta = 0
    this.inHBlank = true

    this.frameX = 0
    this.frameY += 1

    this.playfield.nextLine()
    this.player0.nextLine()
    this.player1.nextLine()
    this.missile0.nextLine()
    this.missile1.nextLine()
    this.ball.nextLine()

    this.machine.cpu.clearHalt()
  }

  private updateCollisionMask() {
    this.collisionMask |=
      this.player0.curCollisionMask &
      this.player1.curCollisionMask &
      this.missile0.curCollisionMask &
      this.missile1.curCollisionMask &
      this.ball.curCollisionMask &
      this.playfield.curCollisionMask
  }

  public read(address: number, cycleCount: number): number {

    if (cycleCount != 0) {
      this.update(cycleCount)
    }

    // TODO: when are readRegs updated?
    let value = 0
    switch (address & 0xF) {
      case TiaRReg.cxm0p:
        if (this.collisionMask & CollisionMask.missile0 & CollisionMask.player0) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.missile0 & CollisionMask.player1) {
          value |= 0x80
        }
        break
      case TiaRReg.cxm1p:
        if (this.collisionMask & CollisionMask.missile1 & CollisionMask.player1) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.missile1 & CollisionMask.player0) {
          value |= 0x80
        }
        break
      case TiaRReg.cxp0fb:
        if (this.collisionMask & CollisionMask.player0 & CollisionMask.ball) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.player0 & CollisionMask.playfield) {
          value |= 0x80
        }
        break
      case TiaRReg.cxp1fb:
        if (this.collisionMask & CollisionMask.player1 & CollisionMask.ball) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.player1 & CollisionMask.playfield) {
          value |= 0x80
        }
        break
      case TiaRReg.cxm0fb:
        if (this.collisionMask & CollisionMask.missile0 & CollisionMask.ball) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.missile0 & CollisionMask.playfield) {
          value |= 0x80
        }
        break
      case TiaRReg.cxm1fb:
        if (this.collisionMask & CollisionMask.missile1 & CollisionMask.ball) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.missile1 & CollisionMask.playfield) {
          value |= 0x80
        }
        break
      case TiaRReg.cxblpf:
        if (this.collisionMask & CollisionMask.ball & CollisionMask.playfield) {
          value |= 0x80
        }
        break
      case TiaRReg.cxppmm:
        if (this.collisionMask & CollisionMask.missile0 & CollisionMask.missile1) {
          value |= 0x40
        }
        if (this.collisionMask & CollisionMask.player0 & CollisionMask.player1) {
          value |= 0x80
        }
        break
      case TiaRReg.inpt0:
      case TiaRReg.inpt1:
      case TiaRReg.inpt2:
      case TiaRReg.inpt3:
      case TiaRReg.inpt4:
      case TiaRReg.inpt5:
        return this.machine.readInput(address)
    }
    return value
  }

  public readConst(address: number): number {
    return this.read(address, 0)   // ***
  }

  // private prevCycleCount = 0    // ***

  public write(address: number, value: number, cycleCount: number) {

    this.update(cycleCount)

    // updateEmulation();
    address &= 0x3f

    this.writeRegs[address] = value
    switch (address) {
      case TiaWReg.vsync:
        this.inVSync = (value & 2) != 0
        if (!this.inVSync) {
          // console.log(`deltaCycles: ${cycleCount - this.prevCycleCount}`)
          // this.prevCycleCount = cycleCount
        }
        // ***
        break
      case TiaWReg.vblank:
        // this.input0.vblank = value
        // this.input1.vblank = value
        // *** more stuff
        this.delayQueue.push(address, value, Delay.vblank)
        break
      case TiaWReg.wsync:
        this.machine.cpu.requestHalt()
        break
      case TiaWReg.rsync:
        this.flush()
        // *** applyRsync()
        break
      case TiaWReg.nusiz0:
        // this.flush()    // *** why?
        this.missile0.nusiz = value
        this.player0.nusiz = value
        break
      case TiaWReg.nusiz1:
        // this.flush()    // *** why?
        this.missile1.nusiz = value
        this.player1.nusiz = value
        break
      case TiaWReg.colup0:
        value &= 0xfe
        this.playfield.colup0 = value
        this.missile0.colup = value
        this.player0.colup = value
        break
      case TiaWReg.colup1:
        value &= 0xfe
        this.playfield.colup1 = value
        this.missile1.colup = value
        this.player1.colup = value
        break
      case TiaWReg.colupf:
        // this.flush()    // *** why?
        value &= 0xfe
        this.playfield.colupf = value
        this.ball.colupf = value
        break
      case TiaWReg.colubk:
        value &= 0xfe
        this.background.colubk = value
        break
      case TiaWReg.ctrlpf:
        this.ctrlpf = value
        this.playfield.ctrlpf = value
        this.ball.ctrlpf = value
        break
      case TiaWReg.refp0:
        this.player0.refp = value
        break
      case TiaWReg.refp1:
        this.player1.refp = value
        break
      case TiaWReg.pf0:
        this.delayQueue.push(address, value, Delay.pf)
        break
      case TiaWReg.pf1:
        this.delayQueue.push(address, value, Delay.pf)
        break
      case TiaWReg.pf2:
        this.delayQueue.push(address, value, Delay.pf)
        break
      case TiaWReg.resp0:
        this.flush()
        this.player0.resp()
        break
      case TiaWReg.resp1:
        this.flush()
        this.player1.resp()
        break
      case TiaWReg.resm0:
        this.flush()
        this.missile0.resm()
        break
      case TiaWReg.resm1:
        this.flush()
        this.missile1.resm()
        break
      case TiaWReg.resbl:
        this.flush()
        this.ball.resbl()
        break
      case TiaWReg.audc0:
      case TiaWReg.audc1:
      case TiaWReg.audf0:
      case TiaWReg.audf1:
      case TiaWReg.audv0:
      case TiaWReg.audv1:
        this.machine.writeTiaAudio(address, value)
        break
      case TiaWReg.grp0:
        this.delayQueue.push(address, value, Delay.grp)
        break
      case TiaWReg.grp1:
        this.delayQueue.push(address, value, Delay.grp)
        break
      case TiaWReg.enam0:
        this.delayQueue.push(address, value, Delay.enam)
        break
      case TiaWReg.enam1:
        this.delayQueue.push(address, value, Delay.enam)
        break
      case TiaWReg.enabl:
        this.delayQueue.push(address, value, Delay.enabl)
        break
      case TiaWReg.hmp0:
        this.delayQueue.push(address, value, Delay.hmp)
        break
      case TiaWReg.hmp1:
        this.delayQueue.push(address, value, Delay.hmp)
        break
      case TiaWReg.hmm0:
        this.delayQueue.push(address, value, Delay.hmm)
        break
      case TiaWReg.hmm1:
        this.delayQueue.push(address, value, Delay.hmm)
        break
      case TiaWReg.hmbl:
        this.delayQueue.push(address, value, Delay.hmbl)
        break
      case TiaWReg.vdelp0:
        this.player0.vdelp = value
        break
      case TiaWReg.vdelp1:
        this.player1.vdelp = value
        break
      case TiaWReg.vdelbl:
        this.ball.vdelbl = value
        break
      case TiaWReg.resmp0:
        this.missile0.resmp(value, this.player0)
        break
      case TiaWReg.resmp1:
        this.missile1.resmp(value, this.player1)
        break
      case TiaWReg.hmove:
        this.delayQueue.push(address, value, Delay.hmove)
        break
      case TiaWReg.hmclr:
        this.delayQueue.push(address, value, Delay.hmclr)
        break
      case TiaWReg.cxclr:
        this.flush()
        // this.collisionMask = 0
        break
    }
  }

  private delayedWrite(address: number, value: number) {
    switch (address) {
      case TiaWReg.vblank:
        this.flush()
        this.inVBlank = (value & 2) != 0
        this.frameY = 0   // ***
        break
      case TiaWReg.pf0:
        this.playfield.pf0 = value
        break
      case TiaWReg.pf1:
        this.playfield.pf1 = value
        break
      case TiaWReg.pf2:
        this.playfield.pf2 = value
        break
      case TiaWReg.grp0:
        this.player0.grp = value
        this.player1.swapPattern()
        break
      case TiaWReg.grp1:
        this.player1.grp = value
        this.player0.swapPattern()
        this.ball.swapEnabled()
        break
      case TiaWReg.enam0:
        this.missile0.enam = value
        break
      case TiaWReg.enam1:
        this.missile1.enam = value
        break
      case TiaWReg.enabl:
        this.ball.enabl = value
        break
      case TiaWReg.hmp0:
        this.player0.hmp = value
        break
      case TiaWReg.hmp1:
        this.player1.hmp = value
        break
      case TiaWReg.hmm0:
        this.missile0.hmm = value
        break
      case TiaWReg.hmm1:
        this.missile1.hmm = value
        break
      case TiaWReg.hmbl:
        this.ball.hmbl = value
        break
      case TiaWReg.vdelp0:
        this.player0.vdelp = value
        break
      case TiaWReg.vdelp1:
        this.player1.vdelp = value
        break
      case TiaWReg.vdelbl:
        this.ball.vdelbl = value
        break
      case TiaWReg.resmp0:
        this.missile0.resmp(value, this.player0)
        break
      case TiaWReg.resmp1:
        this.missile1.resmp(value, this.player1)
        break

      // (2)
      // hcounter: 171, player0.xcounter: 21, player1.xcounter: 154
      // tia.ts:674
      // player: 0, hmp: 10
      // player.ts:103
      // player: 1, hmp: 10
      // player.ts:103
      // hcounter: 12, player0.xcounter: 150, player1.xcounter: 18
      // tia.ts:674
      // (460)
      // hcounter: 12, player0.xcounter: 152, player1.xcounter: 20
      // tia.ts:674
      // player: 0, hmp: 10
      // player.ts:103
      // player: 1, hmp: 10
      // player.ts:103
      // hcounter: 12, player0.xcounter: 150, player1.xcounter: 18
      // tia.ts:674
      // hcounter: 12, player0.xcounter: 152, player1.xcounter: 20
      // tia.ts:674
      // (137)
      // hcounter: 12, player0.xcounter: 154, player1.xcounter: 22

      case TiaWReg.hmove:       // *** this.hcounter is 12, should be 15 here
        this.flush()            // hctr: 15, 149, 17
        console.log(`hcounter: ${this.hcounter}, player0.xcounter: ${this.player0.xcounter}, player1.xcounter: ${this.player1.xcounter}`)
        // *** set hmove instead?
        this.moveClock = 0
        this.inMotion = true
        this.extendedHBlank = true
        this.player0.inMotion = true
        this.player1.inMotion = true
        this.missile0.inMotion = true
        this.missile1.inMotion = true
        this.ball.inMotion = true
        break
      case TiaWReg.hmclr:
        this.player0.hmp = 0
        this.player1.hmp = 0
        this.missile0.hmm = 0
        this.missile1.hmm = 0
        this.ball.hmbl = 0
        this.writeRegs[TiaWReg.hmp0] = 0
        this.writeRegs[TiaWReg.hmp1] = 0
        this.writeRegs[TiaWReg.hmm0] = 0
        this.writeRegs[TiaWReg.hmm1] = 0
        this.writeRegs[TiaWReg.hmbl] = 0
        break
    }
  }

  // enum ResxCounter: uInt8 {
  //   hblank = 159,
  //   lateHblank = 158,
  //   frame = 157
  // };

  // static constexpr uInt8 resxLateHblankThreshold = TIAConstants::H_CYCLES - 3;

  public getResXCounter(): number {
    if (this.inHBlank) {
      return this.hcounter >= 76/*H_CYCLES*/ - 3 ? 158 : 159
    } else {
      return 157      // ResxCounter.frame
    }
  }

  public flush() {
    // ***
  }

  private set ctrlpf(value: number) {
    const priority = (value >> 1) & 3
    if (priority != this.priority) {
      this.flush()
      this.priority = priority
    }
  }

  private renderPixel(x: number, y: number) {

    let pixel: number
    switch (this.priority) {
      case 0:   // normal
        pixel = this.player0.curPixel ??
                this.missile0.curPixel ??
                this.player1.curPixel ??
                this.missile1.curPixel ??
                this.playfield.curPixel ??
                this.ball.curPixel ??
                this.background.curPixel
        break
      case 1:   // score
        pixel = this.player0.curPixel ??
                this.missile0.curPixel ??
                this.playfield.curPixel ??
                this.player1.curPixel ??
                this.missile1.curPixel ??
                this.ball.curPixel ??
                this.background.curPixel
        break
      default:  // pfp
        pixel = this.playfield.curPixel ??
                this.ball.curPixel ??
                this.player0.curPixel ??
                this.missile0.curPixel ??
                this.player1.curPixel ??
                this.missile1.curPixel ??
                this.background.curPixel
        break
    }

    // *** range check earlier
    if (y < 192 + 30) { // ***
      this.frameBuffer[y * H_PIXEL + x] = pixel
    }

    // myBackBuffer[y * 160/*TIAConstants::H_PIXEL*/ + x] = pixel
    // if (myIsLayoutDetector)
    //   myFrameManager->pixelColor(color);
  }
}

//------------------------------------------------------------------------------
// MARK: Player

export class Player {
  private readonly RENDER_COUNTER_OFFSET = -5
  private readonly collisionsDisabled

  public inMotion!: boolean
  private color!: number
  private delayed!: boolean
  private reflected!: boolean
  private formatIndex!: number
  private hmoveClocks!: number
  public/*private*/ xcounter!: number
  private prevPattern!: number
  private nextPattern!: number
  private curPattern!: number
  private divider!: number
  private nextDivider!: number
  // private dividerChangeCounter!: number
  private isRendering!: boolean
  private renderCounter!: number
  private renderCounterTripPoint!: number
  private bitIndex!: number
  public curCollisionMask!: number
  public curPixel?: number

  constructor(private index: number, private tia: Tia, collisionMask: number) {
    this.collisionsDisabled = ~collisionMask
    this.reset()
  }

  public reset() {
    this.inMotion = false
    this.color = 0
    this.delayed = false
    this.reflected = false
    this.formatIndex = 0
    this.hmoveClocks = 0
    this.xcounter = 0
    this.prevPattern = 0
    this.nextPattern = 0
    this.curPattern = 0
    this.divider = 1
    this.nextDivider = 0
    this.renderCounterTripPoint = 0
    // this.dividerChangeCounter = -1
    this.isRendering = false
    this.renderCounter = 0
    this.bitIndex = 0
    this.curCollisionMask = this.collisionsDisabled
    this.curPixel = undefined
  }

  public set colup(value: number) {
    if (value != this.color) {
      this.tia.flush()
    }
    this.color = value
  }

  public set grp(value: number) {
    const pattern = this.nextPattern
    this.nextPattern = value
    if (!this.delayed && value != pattern) {
      this.tia.flush()
      this.updatePattern()
    }
  }

  private updatePattern() {
    this.curPattern = this.delayed ? this.prevPattern : this.nextPattern
    if (!this.reflected) {
      this.curPattern =
        ((this.curPattern & 0x01) << 7) |
        ((this.curPattern & 0x02) << 5) |
        ((this.curPattern & 0x04) << 3) |
        ((this.curPattern & 0x08) << 1) |
        ((this.curPattern & 0x10) >> 1) |
        ((this.curPattern & 0x20) >> 3) |
        ((this.curPattern & 0x40) >> 5) |
        ((this.curPattern & 0x80) >> 7)
    }
    // if (myIsRendering && myRenderCounter >= myRenderCounterTripPoint) {
    //   collision = (myPattern & (1 << mySampleCounter)) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
    //   myTIA->scheduleCollisionUpdate();
    // }
  }

  public swapPattern() {
    const pattern = this.prevPattern
    this.prevPattern = this.nextPattern
    if (this.delayed && pattern != this.nextPattern) {
      this.tia.flush()
      this.updatePattern
    }
  }

  public set hmp(value: number) {
    this.hmoveClocks = (value >> 4) ^ 8
    if (this.hmoveClocks != 8) {   // ***
      console.log(`player: ${this.index}, hmp: ${this.hmoveClocks}`) // ***
    }
  }

  public set nusiz(value: number) {
    const prevFormatIndex = this.formatIndex

    this.formatIndex = (value & 7)
    if (this.formatIndex == 5) {        // double size
      this.nextDivider = 2
    } else if (this.formatIndex == 7) { // quad size
      this.nextDivider = 4
    } else {                            // normal size
      this.nextDivider = 1
    }

    // myDecodes = DrawCounterDecodes::get().playerDecodes()[myDecodesOffset];

    // // Changing NUSIZ can trigger a decode in the same cycle
    // // (https://github.com/stella-emu/stella/issues/1012)
    // if (!myIsRendering && myDecodes[(myCounter + TIAConstants::H_PIXEL - 1) % TIAConstants::H_PIXEL]) {
    //   myIsRendering = true;
    //   mySampleCounter = 0;
    //   myRenderCounter = renderCounterOffset;
    //   myCopy = myDecodes[myCounter - 1];
    // }

    // if (
    //   myDecodes != oldDecodes &&
    //   myIsRendering &&
    //   (myRenderCounter - Count::renderCounterOffset) < 2 &&
    //   !myDecodes[(myCounter - myRenderCounter + Count::renderCounterOffset + TIAConstants::H_PIXEL - 1) % TIAConstants::H_PIXEL]
    // ) {
    //   myIsRendering = false;
    // }

    if (this.nextDivider != this.divider) {
      if (this.isRendering) {
        // *** lots of special cases ***
      } else {
        this.setDivider(this.nextDivider)
      }
    }
  }

  private setDivider(divider: number) {
    this.divider = divider
    this.renderCounterTripPoint = divider == 1 ? 0 : 1
  }

  public resp() {
    this.xcounter = this.tia.getResXCounter()

    // *** special case
    if (this.isRendering) {
      if (this.renderCounter - this.RENDER_COUNTER_OFFSET < 4) {
        this.renderCounter = this.RENDER_COUNTER_OFFSET + this.xcounter - 157
      }
    }
  }

  public set refp(value: number) {
    const reflected = (value & 8) != 0
    if (reflected != this.reflected) {
      this.tia.flush()
      this.reflected = reflected
    }
  }

  public set vdelp(value: number) {
    const delayed = (value & 1) != 0
    if (delayed != this.delayed) {
      this.tia.flush()
      this.delayed = delayed
    }
  }

  public getRespClock(): number {
    let width: number
    if (this.divider == 1) {
      width = 5
    } else if (this.divider == 2) {
      width = 8
    } else {
      width = 12
    }
    return (this.xcounter + H_PIXEL - width) % H_PIXEL
  }

  public clockMotion(moveCounter: number, hcounter: number) {
    if (this.inMotion) {
      // if (this.index == 0) {
      //   console.log(`xcounter: ${this.xcounter}, moveCounter: ${moveCounter}, hcounter: ${hcounter}, hblank: ${this.tia.inHBlank}, isRendering: ${this.isRendering}, renderCounter: ${this.renderCounter}`)
      // }
      if (moveCounter == this.hmoveClocks) {
        this.inMotion = false
      } else if (this.tia.inHBlank) {
        this.clock(hcounter, false)
      }
    }
  }

  public clock(hclock: number, regularClocks: boolean = true) {
    if (!this.isRendering || this.renderCounter < this.renderCounterTripPoint) {
    //   collision = myCollisionMaskDisabled;
      this.curPixel = undefined
    } else {
    //   collision = (myPattern & (1 << mySampleCounter)) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
      this.curPixel = (this.curPattern & (1 << this.bitIndex)) ? this.color : undefined
    }

    const sequence = formatSequences[this.formatIndex]
    if (sequence[this.xcounter]) {
      this.isRendering = true
      this.bitIndex = 0
      this.renderCounter = this.RENDER_COUNTER_OFFSET
    } else if (this.isRendering) {
      this.renderCounter += 1
      if (this.divider == 1) {
        if (this.renderCounter > 0) {
          this.bitIndex += 1
        }
      } else {
        if (this.renderCounter > 1) {
          if (((this.renderCounter - 1) % this.divider) == 0) {
            this.bitIndex += 1
          }
        }
      }

      // *** ">= 0" versus "> 0" ***
      // if (this.renderCounter >= 0 && this.dividerChangeCounter >= 0) {
      //   this.dividerChangeCounter -= 1
      //   if (this.dividerChangeCounter == -1) {
      //     this.setDivider(this.nextDivider)
      //   }
      // }
      if (this.bitIndex == 8) {
        this.isRendering = false
      }
    }

    if (++this.xcounter >= H_PIXEL) {
      this.xcounter = 0;
    }
  }

  public nextLine() {
    // if (!myIsRendering || myRenderCounter < myRenderCounterTripPoint)
    //   collision = myCollisionMaskDisabled;
    // else
    //   collision = (myPattern & (1 << mySampleCounter)) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
    // }
  }
}

//------------------------------------------------------------------------------

const format057 = new Uint8Array(160).fill(0)
const format1 = new Uint8Array(160).fill(0)
const format2 = new Uint8Array(160).fill(0)
const format3 = new Uint8Array(160).fill(0)
const format4 = new Uint8Array(160).fill(0)
const format6 = new Uint8Array(160).fill(0)

format057[156] = 1

format1[156] = 1
format1[12] = 1

format2[156] = 1
format2[28] = 1

format3[156] = 1
format3[28] = 1
format3[12] = 1

format4[156] = 1
format4[60] = 1

format6[156] = 1
format6[60] = 1
format6[28] = 1

const formatSequences = [
  format057,
  format1,
  format2,
  format3,
  format4,
  format057,
  format6,
  format057,
]

//------------------------------------------------------------------------------
// MARK: Missile

class Missile {
  private readonly RENDER_COUNTER_OFFSET = -4
  private readonly collisionsDisabled

  private color!: number

  public inMotion!: boolean

  private enabled!: boolean
  private sizeIndex!: number
  private formatIndex!: number
  private resetMP!: boolean

  private isVisible!: boolean
  private isRendering!: boolean
  private renderCounter!: number
  private hmoveClocks!: number
  private xcounter!: number
  private curEnabled!: boolean
  private curWidth!: number
  public curCollisionMask!: number
  public curPixel?: number

  constructor(private index: number, private tia: Tia, collisionMask: number) {
    this.collisionsDisabled = ~collisionMask
    this.reset()
  }

  public reset() {
    this.inMotion = false

    this.enabled = false
    this.formatIndex = 0
    this.sizeIndex = 0
    this.resetMP = false

    this.isVisible = false
    this.isRendering = false
    this.renderCounter = 0
    this.hmoveClocks = 0
    this.xcounter = 0
    this.curEnabled = false
    this.curWidth = 0
    this.curCollisionMask = this.collisionsDisabled
    this.curPixel = undefined
  }

  public set colup(value: number) {
    if (value != this.color) {
      this.tia.flush()
      this.color = value
    }
  }

  public set enam(value: number) {
    const enabled = (value & 2) != 0
    if (enabled != this.enabled) {
      this.enabled = enabled
      this.tia.flush()
      this.enabledChanged()
    }
  }

  public set hmm(value: number) {
    this.hmoveClocks = (value >> 4) ^ 8
  }

  public resm() {
    this.xcounter = this.tia.getResXCounter()
    if (this.isRendering) {
      if (this.renderCounter < 0) {
        this.renderCounter = this.RENDER_COUNTER_OFFSET + (this.xcounter - 157)
      } else {
        switch (this.sizeIndex) {
          case 0:
            if (this.tia.inHBlank) {
              this.isRendering = this.renderCounter > 0
            }
            break
          case 1:
            if (this.tia.inHBlank) {
              this.isRendering = this.renderCounter > 1
            } else if (this.renderCounter == 0) {
              this.renderCounter += 1
            }
            break
          case 2:
            this.renderCounter = this.xcounter - 157
            break
          case 3:
            this.renderCounter = (this.xcounter - 157) + ((this.renderCounter >= 4) ? 4 : 0)
            break
        }
      }
    }
  }

  public resmp(value: number, player: Player) {
    const resetMP = (value & 2) != 0
    if (resetMP != this.resetMP) {
      this.tia.flush()
      this.resetMP = resetMP
      if (!this.resetMP) {
        this.xcounter = player.getRespClock()
      }
      this.enabledChanged()
    }
  }

  public set nusiz(value: number) {
    this.sizeIndex = (value >> 4) & 3
    this.formatIndex = (value & 7)

    if (this.isRendering) {
      if (this.renderCounter >= (1 << this.sizeIndex)) {
        this.isRendering = false
      }
    }
  }

  private enabledChanged() {
    this.curEnabled = this.enabled && !this.resetMP

    // collision = (myIsVisible && myIsEnabled) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
    // myTIA->scheduleCollisionUpdate();
  }

  public clockMotion(moveCounter: number, hcounter: number) {
    if (this.inMotion) {
      if (moveCounter == this.hmoveClocks) {
        this.inMotion = false
      } else if (this.tia.inHBlank) {
        this.clock(hcounter, false)
      }
    }
  }

  public clock(hclock: number, regularClocks: boolean = true) {

    this.isVisible = false
    if (this.isRendering) {
      if (this.renderCounter >= 0) {
        this.isVisible = true
      } else if (this.inMotion && regularClocks && this.renderCounter == -1) {
        if (this.sizeIndex < 2 && ((hclock + 1) % 4 == 3)) {
          this.isVisible = true
        }
      }
    }

//   // Consider enabled status and the signal to determine visibility (as represented
//   // by the collision mask)
//   collision = (myIsVisible && myIsEnabled) ? myCollisionMaskEnabled : myCollisionMaskDisabled;

    if (this.isVisible && this.curEnabled) {
      this.curPixel = this.color
    } else {
      this.curPixel = undefined
    }

    const sequence = formatSequences[this.formatIndex]
    if (sequence[this.xcounter]) {
      this.isRendering = true
      this.renderCounter = this.RENDER_COUNTER_OFFSET
    } else if (this.isRendering) {
      const width = 1 << this.sizeIndex
      if (this.renderCounter == -1) {
        this.curWidth = width
        if (this.inMotion && regularClocks) {
          const starfieldDelta = (hclock + 1) % 4
          if (starfieldDelta == 3) {
            this.curWidth = width == 1 ? 2 : width
            if (this.sizeIndex < 2) {
              this.renderCounter += 1
            }
          } else if (starfieldDelta == 2) {
            this.curWidth = 0
          }
        }
      }
      if (this.renderCounter >= (this.inMotion ? this.curWidth : width)) {
        this.isRendering = false
      }
    }

    if (++this.xcounter == 160) {
      this.xcounter = 0
    }
  }

  public nextLine() {
    // ***
  }
}

//------------------------------------------------------------------------------
// MARK: Ball

class Ball {
  private readonly RENDER_COUNTER_OFFSET = -4
  private readonly collisionsDisabled

  public inMotion!: boolean
  private hmoveClocks!: number
  private prevEnabled!: boolean
  private nextEnabled!: boolean
  private enabled!: boolean
  private width!: number
  private delayed!: boolean
  private color!: number
  private xcounter!: number
  private isRendering!: boolean
  private renderCounter!: number
  private signalActive!: boolean
  private lastXCounter!: number
  private curWidth!: number
  public curCollisionMask!: number
  public curPixel?: number

  constructor(private tia: Tia, private collisionMask: number) {
    this.collisionsDisabled = ~collisionMask
    this.reset()
  }

  public reset() {
    this.inMotion = false
    this.hmoveClocks = 0
    this.prevEnabled = false
    this.nextEnabled = false
    this.enabled = false
    this.width = 1
    this.delayed = false
    this.color = 0
    this.xcounter = 0
    this.isRendering = false
    this.renderCounter = 0
    this.signalActive = false
    this.lastXCounter = 0
    this.curWidth = 0
    this.curCollisionMask = this.collisionsDisabled
    this.curPixel = undefined
  }

  public set enabl(value: number) {
    const enabled = this.nextEnabled
    this.nextEnabled = (value & 2) != 0
    if (enabled != this.nextEnabled && !this.delayed) {
      this.tia.flush()
      this.enabledChanged()
    }
  }

  public set hmbl(value: number) {
    this.hmoveClocks = (value >> 4) ^ 0x08
  }

  public resbl() {
    this.xcounter = this.tia.getResXCounter()
    this.isRendering = true
    this.renderCounter = this.RENDER_COUNTER_OFFSET + this.xcounter - 157
  }

  public set ctrlpf(value: number) {
    const width = 1 << ((value & 0x30) >> 4)
    if (width != this.width) {
      this.tia.flush()
      this.width = width
    }
  }

  public set vdelbl(value: number) {
    const delayed = (value & 1) != 0
    if (delayed != this.delayed) {
      this.tia.flush()
      this.delayed = delayed
      this.enabledChanged()
    }
  }

  public set colupf(value: number) {
    if (value != this.color) {
      this.tia.flush()
      this.color = value
    }
  }

  public swapEnabled() {
    const enabled = this.prevEnabled
    this.prevEnabled = this.nextEnabled
    if (this.delayed && enabled != this.nextEnabled) {
      this.tia.flush()
      this.enabledChanged()
    }
  }

  private enabledChanged() {
    this.enabled = this.delayed ? this.prevEnabled : this.nextEnabled
    // collision = (mySignalActive && myIsEnabled) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
    // myTIA->scheduleCollisionUpdate();
  }

  public clockMotion(moveCounter: number, hcounter: number) {
    // *** needed for starfield mode ***
    this.lastXCounter = this.xcounter

    if (this.inMotion) {
      if (moveCounter == this.hmoveClocks) {
        this.inMotion = false
      } else {
        if (this.tia.inHBlank) {
          this.clock(hcounter, false)
        }
      }
    }
  }

  // *** hclock -> hcounter ***
  public clock(hclock: number, regularClocks: boolean = true) {

    // *** rename this ***
    this.signalActive = this.isRendering && this.renderCounter >= 0

    const isOn = this.signalActive && this.enabled
    this.curPixel = isOn ? this.color : undefined

    const isStarfield = this.inMotion && regularClocks
    if (this.xcounter == 156) {
      this.isRendering = true
      this.renderCounter = this.RENDER_COUNTER_OFFSET

      const starfieldDelta = (this.xcounter + H_PIXEL - this.lastXCounter) % 4
      if (isStarfield && starfieldDelta == 3 && this.width < 4) {
        this.renderCounter += 1
      }

      if (starfieldDelta == 3) {
        this.curWidth = this.width == 1 ? 2 : this.width
      } else if (starfieldDelta == 2) {
        this.curWidth = 0
      } else {
        this.curWidth = this.width
      }
    } else if (this.isRendering) {
      this.renderCounter += 1
      if (this.renderCounter >= (isStarfield ? this.curWidth : this.width)) {
        this.isRendering = false
      }
    }

    if (++this.xcounter >= H_PIXEL) {
      this.xcounter = 0
    }
  }

  public nextLine() {
    this.signalActive = this.isRendering && this.renderCounter >= 0
    // collision = (mySignalActive && myIsEnabled) ? myCollisionMaskEnabled : myCollisionMaskDisabled;
    // *** curPixel?
  }
}

//------------------------------------------------------------------------------
// MARK: Playfield

class Playfield {
  private readonly collisionsDisabled

  private color: number = 0
  private colorP0: number = 0
  private colorP1: number = 0
  private _pf0: number = 0
  private _pf1: number = 0
  private _pf2: number = 0
  private reflect!: boolean
  private score!: boolean
  private priority!: boolean
  private curReflect!: boolean
  private curPattern!: number
  public curCollisionMask!: number
  public curPixel?: number

  constructor(private tia: Tia, collisionMask: number) {
    this.collisionsDisabled = ~collisionMask
    this.reset()
  }

  public reset() {
    this.color = 0
    this.colorP0 = 0
    this.colorP1 = 0
    this._pf0 = 0
    this._pf1 = 0
    this._pf2 = 0
    this.reflect = false
    this.score = false
    this.priority = false
    this.curReflect = false
    this.curPattern = 0
    this.curCollisionMask = this.collisionsDisabled
    this.curPixel = undefined
  }

  public set colupf(value: number) {
    if (value != this.color && !this.score) {
      this.tia.flush()
    }
    this.color = value
  }

  public set colup0(value: number) {
    if (value != this.colorP0 && this.score) {
      this.tia.flush()
    }
    this.colorP0 = value
  }

  public set colup1(value: number) {
    if (value != this.colorP1 && this.score) {
      this.tia.flush()
    }
    this.colorP1 = value
  }

  public set pf0(value: number) {
    value = (value >> 4) & 0xf
    if (value != this._pf0) {
      this.tia.flush()
      this._pf0 = value
      this.curPattern = (this.curPattern & 0x000ffff0) | value
    }
  }

  public set pf1(value: number) {
    if (value != this._pf1) {
      this.tia.flush()
      this._pf1 = value
      this.curPattern = (this.curPattern & 0x000ff00f)
        | ((value & 0x80) >> 3)
        | ((value & 0x40) >> 1)
        | ((value & 0x20) << 1)
        | ((value & 0x10) << 3)
        | ((value & 0x08) << 5)
        | ((value & 0x04) << 7)
        | ((value & 0x02) << 9)
        | ((value & 0x01) << 11)
    }
  }

  public set pf2(value: number) {
    if (value != this._pf2) {
      this.tia.flush()
      this._pf2 = value
      this.curPattern = (this.curPattern & 0x00000fff) | (value << 12)
    }
  }

  public set ctrlpf(value: number) {
    const reflect = (value & 1) != 0
    const score = (value & 2) != 0
    const priority = (value & 4) != 0

    if (reflect != this.reflect ||
        score != this.score ||
        priority != this.priority) {
      this.tia.flush()
      this.reflect = reflect
      this.score = score
      this.priority = priority
    }
  }

  public clock(x: number) {

    if (x == 0 || x == 79) {
      if (this.reflect != this.curReflect) {
        this.curReflect = this.reflect
      }
    }

    if ((x & 3) == 0) {
      let bitIndex = x >> 2
      let bit: boolean
      if (bitIndex >= 20) {
        bitIndex -= 20
        if (this.curReflect) {
          bit = (this.curPattern & (0x80000 >> bitIndex)) != 0
        } else {
          bit = (this.curPattern & (1 << bitIndex)) != 0
        }
      } else {
        bit = (this.curPattern & (1 << bitIndex)) != 0
      }

      if (bit) {
        // *** this seems backwards ***
        // this.collision = 0

        if (this.score) {
          if (x < 80) {
            this.curPixel = this.colorP0
          } else {
            this.curPixel = this.colorP1
          }
        } else {
          this.curPixel = this.color
        }
      } else {
        this.curPixel = undefined
        // *** this seems backwards ***
        // this.collision = this.collisionMask
      }
    }
  }

  public nextLine() {
    this.curCollisionMask = this.collisionsDisabled
  }
}

//------------------------------------------------------------------------------
// MARK: Background

class Background {
  public curPixel!: number

  constructor(private tia: Tia) {
    this.reset()
  }

  public reset() {
    this.curPixel = 0
  }

  public set colubk(value: number) {
    if (value != this.curPixel) {
      this.tia.flush()
      this.curPixel = value
    }
  }
}

//------------------------------------------------------------------------------
