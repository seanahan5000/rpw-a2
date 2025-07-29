import { IMachineIsa } from "../shared/types"

export enum CoverageState {
  Executed      = 1,
  BranchTarget  = 2,  // Bcc
  JumpTarget    = 4,  // JMP absolute or indirect
  CallTarget    = 8,  // JSR
  ReturnTarget  = 16  // RTS or RTI
}

// TODO: handle high/banked/aux RAM
// TODO: include reads/writes, change state on overwrite
export class Coverage {
  private isa: IMachineIsa
  private state: Uint8Array
  private nextState: Uint8Array
  private minPC!: number
  private maxPC!: number
  lastPC!: number

  public process = () => {}

  constructor(isa: IMachineIsa) {
    this.isa = isa
    this.state = new Uint8Array(0x10000)
    this.nextState = new Uint8Array(0x10000)
    this.reset()
  }

  public reset() {
    this.state.fill(0)
    this.nextState.fill(0)
    this.minPC = 0x10000
    this.maxPC = -1
    this.lastPC = -1
  }

  public step(startPC: number, endPC: number, opByte: number) {
    this.nextState[startPC] |= CoverageState.Executed
    if (this.minPC > startPC) {
      this.minPC = startPC
    }
    if (this.maxPC < startPC) {
      this.maxPC = startPC
    }
    this.lastPC = endPC
    if (this.isa.isBranch(opByte)) {
      if (endPC != startPC + 2) {
        this.nextState[endPC] |= CoverageState.BranchTarget
      }
    } else if (this.isa.isJump(opByte)) {
      this.nextState[endPC] |= CoverageState.JumpTarget
    } else if (this.isa.isCall(opByte)) {
      this.nextState[endPC] |= CoverageState.CallTarget
    } else if (this.isa.isReturn(opByte)) {
      this.nextState[endPC] |= CoverageState.ReturnTarget
    }
  }

  public processEach(callback: (address: number, state: CoverageState) => void) {
    while (this.minPC <= this.maxPC) {
      let stateChange = this.nextState[this.minPC] ^ this.state[this.minPC]
      if (stateChange) {
        callback(this.minPC, this.nextState[this.minPC])
        this.state[this.minPC] = this.nextState[this.minPC]
      }
      this.minPC += 1
    }
    if (this.lastPC != -1) {
      callback(this.lastPC, this.nextState[this.lastPC])
      this.lastPC = -1
    }
    this.minPC = 0x10000
    this.maxPC = -1
  }
}
