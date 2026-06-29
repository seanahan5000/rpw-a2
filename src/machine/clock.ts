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

export enum StepMode {
  None = 0,
  Over = 1,
  Out  = 2,
  Stop = 3
}

export abstract class Clock implements IClock {

  protected machine!: IMachine
  public coverage?: Coverage

  protected clockRate: number
  protected cpuClockScale: number
  protected frameRate: number

  protected clockCycles: number

  protected runTimerId?: NodeJS.Timeout
  protected nextRunTimeMs = 0

  protected stopRequested = ""
  protected stepMode = StepMode.None
  protected stepDepth = 0
  protected stepBreak = -1
  protected breakMap = new Map<number, boolean>()

  private emitter = new EventEmitter()

  constructor(machine: IMachine, clockRate: number, frameRate: number, cpuClockScale: number) {
    this.machine = machine

    this.machine.cpu.on("debug", (error?: string) => {
      this.stopRequested = "requested"
      if (error) {
        this.emit("error", error)
      }
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
    this.cpuClockScale = cpuClockScale
    this.frameRate = frameRate

    this.clockCycles = 0
  }

  public reset(hardReset: boolean) {
    ASSERT(this.machine != undefined)
    this.clockCycles = 0
    this.stepMode = StepMode.None
    this.stepDepth = 0
    this.stepBreak = -1
    this.stop(hardReset ? "hardReset" : "reset")
  }

  public getState(): any {
    let state: any = {}
    state.clockCycles = this.clockCycles
    return state
  }

  public setState(state: any) {
    this.clockCycles = state.clockCycles
  }

  public start() {
    if (!this.isRunning) {
      this.nextRunTimeMs = Date.now()
      this.runTimerId = setTimeout(() => { this.runClock() }, 0)
      this.emit("start")
    }
  }

  public stop(reason?: string) {
    this.stopRequested = ""
    if (this.runTimerId) {
      clearTimeout(this.runTimerId)
      this.runTimerId = undefined
    }
    if (reason != "hardReset") {
      this.emit("stop", reason ?? "requested")
    }
  }

  private runClock() {

    if (this.runTimerId) {
      clearTimeout(this.runTimerId)
      this.runTimerId = undefined
    }

    const stopReason = this.advanceClock()
    if (stopReason != "vblank") {
      this.coverage?.process()
      this.emit("stop", stopReason)
      return
    }

    // reschedule one frame into the future, minus time spent on this frame
    this.nextRunTimeMs += 1000 / this.frameRate
    const timeNowMs = Date.now()
    let scheduleDeltaMs = Math.floor(this.nextRunTimeMs - timeNowMs)

    // reset scheduling if time delta goes negative, probably due to debugging
    if (scheduleDeltaMs < 0 /* *** || partialFrameCycles > 10 *** */) {
      scheduleDeltaMs = 0
      this.nextRunTimeMs = timeNowMs
    }

    this.runTimerId = setTimeout(() => { this.runClock() }, scheduleDeltaMs)
  }

  protected abstract advanceClock(): string

  protected oneInstruction(): number {
    let cycleDelta: number
    if (this.coverage) {
      const startPC = this.machine.cpu.getPC()
      const opByte = this.machine.memory.readConst(startPC)
      cycleDelta = this.machine.cpu.nextInstruction(this.clockCycles, this.cpuClockScale)
      const nextPC = this.machine.cpu.getPC()
      this.coverage.step(startPC, nextPC, opByte)
    } else {
      cycleDelta = this.machine.cpu.nextInstruction(this.clockCycles, this.cpuClockScale)
    }
    this.clockCycles += cycleDelta
    return cycleDelta
  }

  protected checkStops(): string {
    let stopReason = ""

    if (this.stopRequested) {
      stopReason = this.stopRequested
      this.stopRequested = ""
    }

    const pc = this.machine.cpu.getPC()
    if (pc == this.stepBreak) {
      this.stepBreak = -1
      stopReason = "step"
    }

    if (this.breakMap.get(pc)) {
      stopReason = "breakpoint"
    }

    if (this.stepMode == StepMode.Stop) {
      this.stepMode = StepMode.None
      stopReason = "step"
    }
    return stopReason
  }

  public get isRunning(): boolean {
    return this.runTimerId != undefined
  }

  public get rate(): number {
    return this.clockRate
  }

  public get cycles(): number {
    return this.clockCycles
  }

  public get cpuCycles(): number {
    return Math.floor(this.clockCycles / this.cpuClockScale)
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

import { DisplayView } from "../display/display_view"

export abstract class DisplayClock extends Clock {

  public inVBlank: boolean = false
  protected frameNumber: number = 0
  protected lineNumber: number = 0
  protected lineCycles: number = 0
  protected displayView?: DisplayView   // ***

  constructor(
      machine: IMachine,
      protected cyclesPerLine: number,
      protected visibleLines: number,
      protected linesPerFrame: number,
      protected framesPerSecond: number,
      protected cpuClockScale: number) {

    const clockRate = cyclesPerLine * linesPerFrame * framesPerSecond
    super(machine, clockRate, framesPerSecond, cpuClockScale)
  }

  public reset(hardReset: boolean) {
    super.reset(hardReset)
    this.inVBlank = false
    this.frameNumber = 0
    this.lineNumber = 0
    this.lineCycles = 0
    if (hardReset) {
      this.displayView?.setEditMode(false)
    }
  }

  public getState(): any {
    let state: any = {}
    state.clock = super.getState()
    state.inVBlank = this.inVBlank
    state.frameNumber = this.frameNumber
    state.lineNumber = this.lineNumber
    state.lineCycles = this.lineCycles
    return state
  }

  public setState(state: any) {
    super.setState(state.clock)
    this.inVBlank = state.inVBlank
    this.frameNumber = state.frameNumber
    this.lineNumber = state.lineNumber
    this.lineCycles = state.lineCycles
  }

  public setView(displayView: DisplayView) {
    this.displayView = displayView
    // TODO: apply displayView dimensions from here?
  }

  protected updateCycles():
      { stopReason: string, newFrame: boolean, newLine: boolean } {

    let stopReason = this.checkStops()

    let newLine = false
    let newFrame = false
    if (this.lineCycles >= this.cyclesPerLine) {
      this.lineCycles -= this.cyclesPerLine
      this.lineNumber += 1
      newLine = true

      if (this.lineNumber == this.visibleLines) {

        // always update display at the start of vblank
        this.updateDisplay(false)

        this.inVBlank = true
        if (!stopReason) {
          stopReason = "vblank"
        }
      } else if (this.lineNumber == this.linesPerFrame) {
        this.frameNumber += 1
        this.lineNumber = 0
        this.inVBlank = false
        newFrame = true
      }
    }

    if (stopReason && stopReason != "vblank") {
      // TODO: Deal with the issue of a breakpoint hitting
      //  that is then ignored because the underlying code
      //  is not loaded or is switched out.
      this.updateDisplay(true)
    }

    // update audio, disk, etc.
    this.machine.update(this.clockCycles)

    if (newFrame) {
      this.machine.snapState(this.frameNumber)
    }

    return { stopReason, newFrame, newLine }
  }

  protected abstract updateDisplay(partial: boolean): void
}

//------------------------------------------------------------------------------
