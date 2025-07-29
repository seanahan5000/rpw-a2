import { IMachine, IClock, IClockEvents } from "../shared/types"
import { BreakpointEntry } from "../shared/types"
import { Coverage } from "./coverage"
import { EventEmitter } from "events"

//------------------------------------------------------------------------------

// TODO: move this somewhere else

export function ASSERT(condition: boolean, message: string = "") {
  if (!condition) {
    debugger
    throw new Error(message)
  }
}

//------------------------------------------------------------------------------

enum StepMode {
  None = 0,
  Over = 1,
  Out  = 2,
  Stop = 3
}

export class Clock implements IClock {

  protected machine!: IMachine
  public coverage?: Coverage
  public breakHook?: (pc: number) => string

  private clockRate = 0
  private frameRate = 0
  private cyclesPerFrame = 0

  private runTimerId?: NodeJS.Timeout
  private nextCpuRunTimeMs = 0

  private stopRequested = false
  private stepMode = StepMode.None
  private stepDepth = 0
  private stepBreak = -1
  private breakMap = new Map<number, boolean>()

  private emitter = new EventEmitter()

  constructor(machine: IMachine, clockRate: number, frameRate: number) {
    this.machine = machine

    this.machine.cpu.on("debug", () => {
      this.stopRequested = true
    })

    this.machine.cpu.on("call", () => {
      if (this.stepMode != StepMode.None) {
        this.stepDepth += 1
      }
    })

    this.machine.cpu.on("return", () => {
      if (this.stepMode != StepMode.None) {
        this.stepDepth -= 1
        if (this.stepDepth <= 0) {
          this.stepMode = StepMode.Stop
        }
      }
    })

    this.clockRate = clockRate
    this.frameRate = frameRate
    this.cyclesPerFrame = clockRate / this.frameRate
    ASSERT(this.cyclesPerFrame == Math.floor(this.cyclesPerFrame))
  }

  public reset(hardReset: boolean) {
    ASSERT(this.machine != undefined)
    this.stepMode = StepMode.None
    this.stepDepth = 0
    this.stepBreak = -1
    this.stop(hardReset ? "hardReset" : "reset")
  }

  public start() {
    if (!this.isRunning) {
      this.nextCpuRunTimeMs = Date.now()
      this.runTimerId = setTimeout(() => { this.runClock() }, 0)
      this.emit("start")
    }
  }

  public stop(reason?: string) {
    this.stopRequested = false
    if (this.runTimerId) {
      clearTimeout(this.runTimerId)
      this.runTimerId = undefined
    }
    if (reason != "hardReset") {
      this.emit("stop", reason ?? "requested")
    }
  }

  private runClock() {

    this.runTimerId = undefined

    const partialFrameCycles = this.machine.cpu.getCycles() % this.cyclesPerFrame
    const stopReason = this.advanceClock(this.cyclesPerFrame - partialFrameCycles)
    if (stopReason) {
      this.emit("stop", stopReason)
      return
    }

    // reschedule one frame into the future, minus time spent on this frame
    this.nextCpuRunTimeMs += 1000 / this.frameRate
    const timeNowMs = Date.now()
    let scheduleDeltaMs = Math.floor(this.nextCpuRunTimeMs - timeNowMs)

    // reset scheduling if time delta goes negative, probably due to debugging
    if (scheduleDeltaMs < 0 || partialFrameCycles > 10) {
      scheduleDeltaMs = 0
      this.nextCpuRunTimeMs = timeNowMs
    }

    this.runTimerId = setTimeout(() => { this.runClock() }, scheduleDeltaMs)
  }

  private advanceClock(advanceCount: number): string {
    let stopReason = ""
    const cpu = this.machine.cpu
    do {
      let cycles: number
      if (this.coverage) {
        const startPC = cpu.getPC()
        const opByte = this.machine.memory.readConst(startPC)
        cycles = cpu.nextInstruction()
        const nextPC = cpu.getPC()
        this.coverage.step(startPC, nextPC, opByte)
      } else {
        cycles = cpu.nextInstruction()
      }

      advanceCount -= cycles
      this.machine.update(cpu.getCycles(), false)

      if (this.stopRequested) {
        stopReason = "requested"
        this.stopRequested = false
      }

      const pc = cpu.getPC()
      if (pc == this.stepBreak) {
        this.stepBreak = -1
        stopReason = "step"
      }

      if (this.breakMap.get(pc)) {
        stopReason = "breakpoint"
      }

      // TODO: remove this hook to support old projects
      if (this.breakHook) {
        const breakType = this.breakHook(pc)
        if (breakType != "") {
          stopReason = breakType
        }
      }

      if (this.stepMode == StepMode.Stop) {
        this.stepMode = StepMode.None
        stopReason = "step"
      }

    } while (advanceCount > 0 && !stopReason)

    if (stopReason) {
      // force display redraw when stepping
      this.machine.update(cpu.getCycles(), true)

      this.coverage?.process()
    }

    return stopReason
  }

  public get isRunning(): boolean {
    return this.runTimerId != undefined
  }

  public getClockRate(): number {
    return this.clockRate
  }

  public stepInto() {
    if (!this.isRunning) {
      this.stepMode = StepMode.Stop
      this.start()
    }
  }

  public stepOver() {
    if (!this.isRunning) {
      const pc = this.machine.cpu.getPC()
      const opByte = this.machine.memory.readConst(pc)
      if (this.machine.cpu.isa.isCall(opByte)) {
        this.stepMode = StepMode.Over
        this.stepDepth = 0
        this.start()
      } else {
        this.stepInto()
      }
    }
  }

  public stepOutOf() {
    if (!this.isRunning) {
      this.stepMode = StepMode.Out
      this.stepDepth = 1
      this.start()
    }
  }

  public stepForward() {
    if (!this.isRunning) {
      const pc = this.machine.cpu.getPC()
      const opByte = this.machine.memory.readConst(pc)
      if (this.machine.cpu.isa.isBranch(opByte)) {
        // NOTE: 6502-specific
        if (this.machine.memory.readConst(pc + 1) > 0x7F) {
          const nextPC = pc + 2
          this.stepBreak = nextPC
          this.start()
          return
        }
      }
      this.stepOver()
    }
  }

  public setBreakpoints(breakpoints: BreakpointEntry[]) {
    this.breakMap = new Map<number, boolean>()
    for (const breakpoint of breakpoints) {
      this.breakMap.set(breakpoint.address, true)
    }
  }

  public on<K extends keyof IClockEvents>(event: K, listener: IClockEvents[K]): void {
    this.emitter.on(event, listener)
  }

  protected emit<K extends keyof IClockEvents>(event: K, ...args: Parameters<IClockEvents[K]>): void {
    this.emitter.emit(event, ...args);
  }
}

//------------------------------------------------------------------------------
