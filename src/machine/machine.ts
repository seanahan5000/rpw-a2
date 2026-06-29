
import { IMachine, IClock, IMemory, ICpu } from "../shared/types"
import { SocketDebugger } from "./debugger"

export type EmulatorParams = {
  variant?: string
  debugPort?: number
  stopOnEntry?: boolean
  saveState?: any
}

//------------------------------------------------------------------------------

export abstract class Emulator {

  protected debugger: SocketDebugger
  public topDiv: HTMLDivElement
  public machine: Machine

  constructor(
      parent: HTMLElement | undefined,
      params: EmulatorParams) {

    this.debugger = new SocketDebugger(params.debugPort)

    this.topDiv = document.createElement("div")
    parent?.appendChild(this.topDiv)

    this.machine = this.createMachine(params)
    if (params.saveState) {
      this.machine.setState(params.saveState)
    }
    this.debugger.setMachine(this.machine)
  }

  protected abstract createMachine(params: EmulatorParams): Machine

  protected startMachine(params: EmulatorParams) {
    if (params.saveState) {
      // *** this.machine.clock.stop/start based on state? ***
    } else {
      this.machine.reset(true)

      const stopOnEntry = params.stopOnEntry ?? false
      if (stopOnEntry) {
        this.machine.clock.stop("launch")
      } else {
        this.machine.clock.start()
      }
    }
  }

  public close() {
    // ***
  }
}

//------------------------------------------------------------------------------

export abstract class Machine implements IMachine {

  abstract reset(hardReset: boolean): void
  abstract update(cycleCount: number/*, forceRedraw: boolean*/): void

  abstract get soundEnabled(): boolean
  abstract set soundEnabled(enabled: boolean)

  abstract get clock(): IClock
  abstract get memory(): IMemory
  abstract get cpu(): ICpu

  public abstract setView(displayView: any): void

  // state recording

  protected curStateIndex: number = 0
  protected states: any[] = []

  public snapState(frameNumber: number) {
    this.trimStates()
    this.states.push(this.getState())
    this.curStateIndex += 1
  }

  public getStateInfo() {
    return {
      index: this.curStateIndex,
      count: this.states.length
    }
  }

  protected trimStates() {
    if (this.curStateIndex < this.states.length) {
      this.states = this.states.slice(0, this.curStateIndex)
    }
    if (this.states.length >= 60 * 5) {
      this.states.shift()
      this.curStateIndex -= 1
    }
  }

  protected clearStates() {
    this.states = []
    this.curStateIndex = 0
  }

  public advanceState(forward: boolean, largeStep: boolean): boolean {
    let changed = false
    if (forward) {
      if (this.curStateIndex < this.states.length) {
        if (largeStep) {
          this.curStateIndex += 60
          if (this.curStateIndex > this.states.length) {
            this.curStateIndex = this.states.length
          }
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
          // *** make this work again ***
          // if (lastState.cpu.cycles != this._cpu.cycles) {
          //   this.states.push(this.getState())
          //   this.curStateIndex += 1
          // }
        }
        if (largeStep) {
          this.curStateIndex -= 60
          if (this.curStateIndex < 0) {
            this.curStateIndex = 0
          }
          this.setState(this.states[this.curStateIndex])
        } else {
          this.setState(this.states[--this.curStateIndex])
        }
        changed = true
      }
    }
    return changed
  }

  abstract getState(): any
  abstract flattenState(state: any): Promise<void>
  abstract setState(state: any): void

  // disk/cart handling

  abstract setDataImage(
    fullPath: string,
    dataBytes: Uint8Array,
    driveIndex?: number,
    onWrite?: (newDataBytes: Uint8Array) => void): void
}

//------------------------------------------------------------------------------

export async function base64FromUint8(uint8: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([uint8.buffer as ArrayBuffer])
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
