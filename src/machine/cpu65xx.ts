
// Known Issues:
//  - 6502: ADC and SBC decimal mode status bit fixes from 65C02 always applied
//  - 6502: BRK instruction clears D flag like fixed 65C02 dpoes
//  - 65C02: ADC and SBC do not add extra cycle in decimal mode
//  - 65C02: extra write still happens in read-modify-write operations

import { IMachineCpu, IMachineIsa, IMachineMemory, StackEntry, StackRegister } from "../shared/types"
import { OpInfo } from "../shared/types"
import { Isa, OpMode } from "./isa65xx"

type Proc = () => void
type Instruction = Proc[]
type AddrProc = (arg: Proc) => Proc[]

//------------------------------------------------------------------------------

const NMI_VECTOR = 0xfffa
const RESET_VECTOR = 0xfffc
const IRQ_VECTOR = 0xfffe

export class Cpu65xx implements IMachineCpu {

  private _isa: Isa
  public mem: IMachineMemory
  // TODO: any need for RDY flag?

  private instructions: Instruction[] = new Array(256)
  private vstack: VirtualStack

  private PC: number = 0
  public SP: number = 0
  public A: number = 0
  public X: number = 0
  public Y: number = 0

  private N: number = 0
  private V: number = 0
  private D: number = 0
  private I: number = 0
  private Z: number = 0
  private C: number = 0

  private T: number = 0
  private opcode: number = -1
  private instruction: Instruction = []

  public cycles: number = 0
  private pendingNMI: boolean = false
  private pendingIRQ: boolean = false

  private data: number = 0
  private AD: number = 0
  private BA: number = 0
  private BACarry: number = 0
  private IA: number = 0
  private IACarry: number = 0
  private branchOffset: number = 0;
  private branchOffsetCrossAdjust: number = 0;

  private debugHook?: Function
  private callHook?: Function
  private returnHook?: Function
  private escapeHooks?: Function[]

  constructor(isa: Isa, mem: IMachineMemory) {
    this._isa = isa
    this.mem = mem

    // TODO: use isa to make this choice
    this.initInst6502()  // TODO: let caller choose this
    this.vstack = new VirtualStack(this)
  }

  public getStateCpu(): any {
    let state: any = {}
    state.PC = this.PC,
    state.SP = this.SP,
    state.A = this.A,
    state.X = this.X,
    state.Y = this.Y,
    state.PS = this.getStatusBits()
    state.T = this.T
    state.cycles = this.cycles
    state.pendingNMI = this.pendingNMI
    state.pendingIRQ = this.pendingIRQ
    state.vstack = this.vstack.getStateStack()
    state.opcode = this.opcode
    return state
  }

  public flattenState(state: any) {
    this.vstack.flattenState(state.vstack)
  }

  public setState(state: any) {
    this.PC = state.PC
    this.SP = state.SP
    this.A = state.A
    this.X = state.X
    this.Y = state.Y
    this.setStatusBits(state.PS)
    this.T = state.T
    this.cycles = state.cycles
    this.pendingNMI = state.pendingNMI
    this.pendingIRQ = state.pendingIRQ
    this.opcode = state.opcode
    this.instruction = this.instructions[this.opcode]
    this.vstack.setState(state.vstack)
  }

  public get isa(): IMachineIsa {
    return this._isa
  }

  public reset() {
    this.I = 1
    this.PC = this.mem.read(RESET_VECTOR, this.cycles)
      | (this.mem.read(RESET_VECTOR + 1, this.cycles) << 8)
    this.cycles = 0
    this.pendingNMI = false
    this.pendingIRQ = false
    this.vstack = new VirtualStack(this)
    this.fetchNextOpcode()
  }

  // advance one instructions worth of cycles
  public nextInstruction(): number {

    // NOTE: assume T == 0 always true here
    if (this.pendingNMI) {
      this.takeNMI()
    } else if (this.pendingIRQ) {
      // TODO: look at this.I flag?
      this.takeIRQ()
    }

    let opCycles = 0
    do {
      // advance clock a single cycle
      this.T += 1
      this.instruction[this.T]()
      this.cycles += 1

      opCycles += 1
    } while (this.T != 0)
    return opCycles
  }

  // state

  public getPC(): number {
    // NOTE: Instruction prefetch has always advanced
    //  the PC by a byte so subtract it out here.
    return (this.PC - 1) & 0xFFFF
  }

  public setPC(address: number) {
    this.PC = address
    this.T = -1
    this.fetchNextOpcode()
  }

  public setRegister(reg: StackRegister) {
    switch (reg.name) {
      case "PC":
          this.setPC(reg.value)
          break
      case "SP":
          this.SP = reg.value
          break
      case "PS":
          this.setStatusBits(reg.value)
          break
      case "A":
          this.A = reg.value
          break
      case "X":
          this.X = reg.value
          break
      case "Y":
          this.Y = reg.value
          break
    }
  }

  public getCycles(): number {
    return this.cycles
  }

  public getStatusBits(): number {
    return this.N << 7
      | this.V << 6
      | this.D << 3
      | this.I << 2
      | this.Z << 1
      | this.C << 0
  }

  public setStatusBits(val: number) {
    this.N = (val >>> 7)
    // E and B flags actually do not exist as real flags, so ignore
    this.V = (val >>> 6) & 1
    this.D = (val >>> 3) & 1
    this.I = (val >>> 2) & 1
    this.Z = (val >>> 1) & 1
    this.C = val & 1
  }

  public getCallStack(): StackEntry[] {
    return this.vstack.getCallStack()
  }

  // hooks

  public on(name: string, listener: () => void): void {
    switch (name) {
      case "debug":
        this.debugHook = listener
        break
      case "call":
        this.callHook = listener
        break
      case "return":
        this.returnHook = listener
        break
    }
  }

  // TODO: switch to on() API?
  public setEscapeHook(hook: Function, index: number) {
    if (!this.escapeHooks) {
      this.escapeHooks = new Array(3)
      this.initEscapeOpcodes()
    }
    this.escapeHooks[index] = hook
  }

  // interrupts

  // TODO: more work needed on interrupt emulation

  public raiseNMI() {
    this.pendingNMI = true
  }

  private takeNMI() {
    // NOTE: assume T == 0 always true here
    this.instruction = this.NMI()
    this.T = 1
    this.PC = (this.PC - 1) & 0xffff
    this.pendingNMI = false
  }

  public raiseIRQ() {
    this.pendingIRQ = true
  }

  private takeIRQ() {
    // NOTE: assume T == 0 always true here
    this.instruction = this.IRQ()
    this.T = 1
    this.PC = (this.PC - 1) & 0xffff
    this.pendingIRQ = false
  }

  // fetch functions

  private fetchNextOpcode = () => {
    this.opcode = this.mem.read(this.PC, this.cycles)
    this.instruction = this.instructions[this.opcode]
    this.T = 0
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchAndDiscard = () => {
    this.mem.read(this.PC, this.cycles)
  }

  private fetchBranchOffset = () => {
    this.branchOffset = this.mem.read(this.PC, this.cycles)
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchADL = () => {
    this.AD = this.mem.read(this.PC, this.cycles)
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchADH = () => {
    this.AD |= this.mem.read(this.PC, this.cycles) << 8
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchADLFromBA = () => {
    this.AD = this.mem.read(this.BA, this.cycles)
  }

  private fetchADHFromBA = () => {
    this.AD |= this.mem.read(this.BA, this.cycles) << 8
  }

  private fetchBAL = () => {
    this.BA = this.mem.read(this.PC, this.cycles)
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchBAH = () => {
    this.BA |= this.mem.read(this.PC, this.cycles) << 8
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchBALFromIA = () => {
    this.BA = this.mem.read(this.IA, this.cycles)
  }

  private fetchBAHFromIA = () => {
    this.BA = (this.BA & 0x00FF) | (this.mem.read(this.IA, this.cycles) << 8)
  }

  private addXtoBAL = () => {
    const result = (this.BA & 255) + this.X
    this.BACarry = result & 0x100
    this.BA = (this.BA & 0xff00) | (result & 0xff)
  }

  private addYtoBAL = () => {
    const result = (this.BA & 0xff) + this.Y
    this.BACarry = result & 0x100
    this.BA = (this.BA & 0xff00) | (result & 0xff)
  }

  private add1toBAL = () => {
    const result = (this.BA & 0xff) + 1
    this.BACarry = result & 0x100
    this.BA = (this.BA & 0xff00) | (result & 0xff)
  }

  private addBACarryToBAH = () => {
    this.BA = (this.BA + this.BACarry) & 0xffff
  }

  // *** rename fetch -> read ***

  private fetchIAL = () => {
    this.IA = this.mem.read(this.PC, this.cycles)
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchIAH = () => {
    this.IA |= this.mem.read(this.PC, this.cycles) << 8
    this.PC = (this.PC + 1) & 0xffff
  }

  private add1toIAL = () => {
    const next = (this.IA & 0xff) + 1
    this.IACarry = (next > 255) ? 0x100 : 0
    this.IA = (this.IA & 0xff00) | (next & 0x00ff)
  }

  private addIACarrytoIAH = () => {
    this.IA = (this.IA + this.IACarry) & 0xffff
  }

  private fetchDataFromImm = () => {
    this.data = this.mem.read(this.PC, this.cycles)
    this.PC = (this.PC + 1) & 0xffff
  }

  private fetchDataFromAD = () => {
    this.data = this.mem.read(this.AD, this.cycles)
  }

  private fetchDataFromBA = () => {
    this.data = this.mem.read(this.BA, this.cycles)
  }

  private writeDataToAD = () => {
    this.mem.write(this.AD, this.data, this.cycles)
  }

  private writeDataToBA = () => {
    this.mem.write(this.BA, this.data, this.cycles)
  }

  private addBranchOffsetToPCL = () => {
    const oldLow = (this.PC & 0x00ff)
    const newLow = (oldLow + this.branchOffset) & 255
    if (this.branchOffset > 127) {
      this.branchOffsetCrossAdjust = (newLow > oldLow) ? -0x0100 : 0
    } else {
      this.branchOffsetCrossAdjust = (newLow < oldLow) ? 0x0100 : 0
    }
    this.PC = (this.PC & 0xff00) | newLow
  }

  private adjustPCHForBranchOffsetCross = () => {
    this.PC = (this.PC + this.branchOffsetCrossAdjust) & 0xffff
  }

  // addressing

  private implied = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read #$FF
  private immRead = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchDataFromImm,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read $FF
  private zpageRead = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchADL,
      this.fetchDataFromAD,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read $FF,X
  private zpageXRead = (operation: Function) => {
    return this.zpageXYRead(operation, this.addXtoBAL)
  }

  // read $FF,Y
  private zpageYRead = (operation: Function) => {
    return this.zpageXYRead(operation, this.addYtoBAL)
  }

  private zpageXYRead = (operation: Function, addIndex: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchDataFromBA,
      () => {
        addIndex()
        this.fetchDataFromBA()
      },
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read $FFFF
  private absRead = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchADL,
      this.fetchADH,
      this.fetchDataFromAD,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read $FFFF,X
  private absXRead = (operation: Function) => {
    return this.absXYRead(operation, this.addXtoBAL)
  }

  // read $FFFF,Y
  private absYRead = (operation: Function) => {
    return this.absXYRead(operation, this.addYtoBAL)
  }

  private absXYRead = (operation: Function, addIndex: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchBAH,
      () => {
        addIndex()
        this.fetchDataFromBA()
        this.addBACarryToBAH()
      },
      () => {
        if (this.BACarry) {
          this.fetchDataFromBA()
        } else {
          operation()
          this.fetchNextOpcode()
        }
      },
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read ($FF,X)
  private indXRead = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchDataFromBA,
      () => {
        this.addXtoBAL()
        this.fetchADLFromBA()
      },
      () => {
        this.add1toBAL()
        this.fetchADHFromBA()
      },
      this.fetchDataFromAD,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read ($FF),Y
  private indYRead = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchIAL,
      this.fetchBALFromIA,
      () => {
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      () => {
        this.addYtoBAL()
        this.fetchDataFromBA()
        this.addBACarryToBAH()
      },
      () => {
        if (this.BACarry) {
          this.fetchDataFromBA()
        } else {
          operation()
          this.fetchNextOpcode()
        }
      },
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // read ($FF)
  private indZRead = (operation: Function) => {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchIAL,
      this.fetchBALFromIA,
      () => {
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      this.fetchDataFromBA,
      () => {
        operation()
        this.fetchNextOpcode()
      }
    ]
  }

  // write $FF
  private zpageWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchADL,
      () => {
        operation()
        this.writeDataToAD()
      },
      this.fetchNextOpcode
    ]
  }

  // write $FF,X
  private zpageXWrite = (operation: Function) => {
    return this.zpageXYWrite(operation, this.addXtoBAL)
  }

  // write $FF,Y
  private zpageYWrite = (operation: Function) => {
    return this.zpageXYWrite(operation, this.addYtoBAL)
  }

  private zpageXYWrite = (operation: Function, addIndex: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchDataFromBA,
      () => {
        addIndex()
        operation()
        this.writeDataToBA()
      },
      this.fetchNextOpcode
    ]
  }

  // write $FFFF
  private absWrite = (operation: Function) => {
    return [
        this.fetchNextOpcode,
        this.fetchADL,
        this.fetchADH,
        () => {
          operation()
          this.writeDataToAD()
        },
        this.fetchNextOpcode
    ]
  }

  // write $FFFF,X
  private absXWrite = (operation: Function) => {
    return this.absXYWrite(operation, this.addXtoBAL)
  }

  // write $FFFF,Y
  private absYWrite = (operation: Function) => {
    return this.absXYWrite(operation, this.addYtoBAL)
  }

  private absXYWrite = (operation: Function, addIndex: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchBAH,
      () => {
        addIndex()
        this.fetchDataFromBA()
        this.addBACarryToBAH()
      },
      () => {
        operation()
        this.writeDataToBA()
      },
      this.fetchNextOpcode
    ]
  }

  // write ($FF,X)
  private indXWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchDataFromBA,
      () => {
        this.addXtoBAL()
        this.fetchADLFromBA()
      },
      () => {
        this.add1toBAL()
        this.fetchADHFromBA()
      },
      () => {
        operation()
        this.writeDataToAD()
      },
      this.fetchNextOpcode
    ]
  }

  // write ($FF),Y
  private indYWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchIAL,        // 1
      this.fetchBALFromIA,  // 2
      () => {               // 3
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      () => {               // 4
        this.addYtoBAL()
        this.fetchDataFromBA()
        this.addBACarryToBAH()
      },
      () => {               // 5
        operation()
        this.writeDataToBA()
      },
      this.fetchNextOpcode  // 6
    ]
  }

  // write ($FF)
  private indZWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchIAL,
      this.fetchBALFromIA,
      () => {
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      () => {
        operation()
        this.writeDataToBA()
      },
      this.fetchNextOpcode
    ]
  }

  // read/write $FF
  private zpageReadWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchADL,        // 1
      this.fetchDataFromAD, // 2
      this.writeDataToAD,   // 3
      () => {               // 4
        operation()
        this.writeDataToAD()
      },
      this.fetchNextOpcode  // 5
    ]
  }

  // read/write $FF,X
  private zpageXReadWrite = (operation: Function) => {
    return [
        this.fetchNextOpcode,
        this.fetchBAL,
        this.fetchDataFromBA,
        () => {
          this.addXtoBAL()
          this.fetchDataFromBA()
        },
        this.writeDataToBA,
        () => {
          operation()
          this.writeDataToBA()
        },
        this.fetchNextOpcode
    ]
  }

  // read/write $FFFF
  private absReadWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchADL,        // 1
      this.fetchADH,        // 2
      this.fetchDataFromAD, // 3
      this.writeDataToAD,   // 4
      () => {               // 5
        operation()
        this.writeDataToAD()
      },
      this.fetchNextOpcode  // 6
    ]
  }

  // read/write $FFFF,X
  private absXReadWrite = (operation: Function) => {
    return [
      this.fetchNextOpcode,
      this.fetchBAL,
      this.fetchBAH,
      () => {
        this.addXtoBAL()
        this.fetchDataFromBA()
        this.addBACarryToBAH()
      },
      this.fetchDataFromBA,
      this.writeDataToBA,
      () => {
        operation()
        this.writeDataToBA()
      },
      this.fetchNextOpcode
    ]
  }

  // status flags

  private setZ(val: number) {
    this.Z = (val == 0) ? 1 : 0
  }

  private setN(val: number) {
    this.N = (val & 0x080) ? 1 : 0
  }

  private setZN(val: number) {
    this.Z = (val == 0) ? 1 : 0
    this.N = (val & 0x80) ? 1 : 0
  }

  private setV(b: boolean) {
    this.V = b ? 1 : 0
  }

  private setC(b: boolean) {
    this.C = b ? 1 : 0
  }

  private popFromStack = () => {
    this.SP = (this.SP + 1) & 255
    return this.mem.read(0x0100 + this.SP, this.cycles)
  }

  private peekFromStack = () => {
    return this.mem.read(0x0100 + this.SP, this.cycles)
  }

  private pushToStack = (val: number) => {
    this.mem.write(0x0100 + this.SP, val, this.cycles)
    this.SP = (this.SP - 1) & 255
  }

  // simple instructions

  private ASL_A() {
    return this.implied(() => {
      this.setC(this.A > 127)
      this.A = (this.A << 1) & 255
      this.setZN(this.A)
    })
  }

  private CLC() {
    return this.implied(() => {
      this.C = 0
    })
}

  private CLD() {
    return this.implied(() => {
      this.D = 0
    })
  }

  private CLI() {
    return this.implied(() => {
      this.I = 0
    })
  }

  private CLV() {
    return this.implied(() => {
      this.V = 0
    })
  }

  private DEC_A() {
    return this.implied(() => {
      this.A = (this.A - 1) & 255
      this.setZN(this.A)
    })
  }

  private DEX() {
    return this.implied(() => {
      this.X = (this.X - 1) & 255
      this.setZN(this.X)
    })
  }

  private DEY() {
    return this.implied(() => {
      this.Y = (this.Y - 1) & 255
      this.setZN(this.Y)
    })
  }

  private INC_A() {   // 65C02
    return this.implied(() => {
      this.A = (this.A + 1) & 255
      this.setZN(this.A)
    })
  }

  private INX() {
    return this.implied(() => {
      this.X = (this.X + 1) & 255
      this.setZN(this.X)
    })
  }

  private INY() {
    return this.implied(() => {
      this.Y = (this.Y + 1) & 255
      this.setZN(this.Y)
    })
  }

  private LSR_A() {
    return this.implied(() => {
      this.C = this.A & 0x01
      this.A >>>= 1
      this.setZ(this.A)
      this.N = 0
    })
  }

  private NOP() {
    return this.implied(() => {
      // nothing
    })
  }

  private NOP1() {    // 65C02 (1 byte, 1 cycle)
    return [
      this.fetchNextOpcode,
      this.fetchNextOpcode, // 1
    ]
  }

  private NOP2() {    // 65C02 (2 bytes, 2 cycles)
    return [
      this.fetchNextOpcode,
      this.fetchADL,        // 1
      this.fetchNextOpcode, // 2
    ]
  }

  private NOP3() {    // 65C02 (3 bytes, 4 cycles)
    return [
      this.fetchNextOpcode,
      this.fetchADL,        // 1
      this.fetchADL,        // 2
      this.fetchDataFromAD, // 3
      this.fetchNextOpcode, // 4
    ]
  }

  private ROL_A() {
    return this.implied(() => {
      const newC = this.A > 127
      this.A = ((this.A << 1) | this.C) & 255
      this.setC(newC)
      this.setZN(this.A)
    })
  }

  private ROR_A() {
    return this.implied(() => {
      const newC = (this.A & 0x01) != 0
      this.A = (this.A >>> 1) | (this.C << 7)
      this.setC(newC)
      this.setZN(this.A)
    })
  }

  private SEC() {
    return this.implied(() => {
      this.C = 1
    })
  }

  private SED() {
    return this.implied(() => {
      this.D = 1
    })
  }

  private SEI() {
    return this.implied(() => {
      this.I = 1
    })
  }

  private TAX() {
    return this.implied(() => {
      this.X = this.A
      this.setZN(this.X)
    })
}

  private TAY() {
    return this.implied(() => {
      this.Y = this.A
      this.setZN(this.Y)
    })
  }

  private TSX() {
    return this.implied(() => {
      this.X = this.SP
      this.setZN(this.X)
    })
  }

  private TXA() {
    return this.implied(() => {
      this.A = this.X
      this.setZN(this.A)
    })
  }

  private TXS() {
    return this.implied(() => {
      this.vstack.TXS()
      this.SP = this.X
    })
  }

  private TYA() {
    return this.implied(() => {
      this.A = this.Y
      this.setZN(this.A)
    })
  }

  // load and arithmetic instructions

  private ADC(addressing: AddrProc) {
    return addressing(() => {
      if (this.D) {
        const operand = this.data
        let AL = (this.A & 15) + (operand & 15) + this.C
        if (AL > 9) {
          AL += 6
        }
        let AH = ((this.A >> 4) + (operand >> 4) + ((AL > 15) ? 1 : 0)) << 4
        this.setZ((this.A + operand + this.C) & 255)
        this.setN(AH)
        this.setV((((this.A ^AH) & ~(this.A ^ operand)) & 128) != 0)
        if (AH > 0x9f) {
          AH += 0x60
        }
        this.setC(AH > 255)
        this.A = (AH | (AL & 15)) & 255

        this.setZN(this.A)   // TODO: 65C02-only
      } else {
        const add = this.A + this.data + this.C
        this.setC(add > 255)
        this.setV((((this.A ^ add) & (this.data ^ add)) & 0x80) != 0)
        this.A = add & 255
        this.setZN(this.A)
      }
    })
  }

  private AND(addressing: AddrProc) {
    return addressing(() => {
      this.A &= this.data
      this.setZN(this.A)
    })
  }

  private BIT(addressing: AddrProc) {
    return addressing(() => {
      const par = this.data
      this.setZ(this.A & par)
      this.setV((par & 0x40) != 0)
      this.setN(par)
    })
  }

  private BIT_IMM(addressing: AddrProc) {   // 65C02
    return addressing(() => {
      const par = this.data
      this.setZ(this.A & par)
      // V and N flags unchanged
    })
  }

  private CMP(addressing: AddrProc) {
    return addressing(() => {
      const val = (this.A - this.data) & 255
      this.setC(this.A >= this.data)
      this.setZN(val)
    })
  }

  private CPX(addressing: AddrProc) {
    return addressing(() => {
      const val = (this.X - this.data) & 255
      this.setC(this.X >= this.data)
      this.setZN(val)
    })
  }

  private CPY(addressing: AddrProc) {
    return addressing(() => {
      const val = (this.Y - this.data) & 255
      this.setC(this.Y >= this.data)
      this.setZN(val)
    })
  }

  private EOR(addressing: AddrProc) {
    return addressing(() => {
      this.A ^= this.data
      this.setZN(this.A)
    })
  }

  private LDA(addressing: AddrProc) {
    return addressing(() => {
      this.A = this.data
      this.setZN(this.A)
    })
  }

  private LDX(addressing: AddrProc) {
    return addressing(() => {
      this.X = this.data
      this.setZN(this.X)
    })
  }

  private LDY(addressing: AddrProc) {
    return addressing(() => {
      this.Y = this.data
      this.setZN(this.Y)
    })
  }

  private ORA(addressing: AddrProc) {
    return addressing(() => {
      this.A |= this.data
      this.setZN(this.A)
    })
  }

  private SBC(addressing: AddrProc) {
    return addressing(() => {
      if (this.D) {
        const operand = this.data
        let AL = (this.A & 15) - (operand & 15) - (1 - this.C)
        let AH = (this.A >> 4) - (operand >> 4) - ((AL < 0) ? 1 : 0)
        if (AL < 0) {
          AL -= 6
        }
        if (AH < 0) {
          AH -= 6
        }
        const sub = this.A - operand - (1 - this.C)
        this.setC((~sub & 256) != 0)
        this.setV((((this.A ^ operand) & (this.A ^ sub)) & 128) != 0)
        this.setZ(sub & 255)
        this.setN(sub)
        this.A = ((AH << 4) | (AL & 15)) & 255

        this.setZN(this.A)   // TODO: 65C02-only
      } else {
        const operand = (~this.data) & 255
        const sub = this.A + operand + this.C
        this.setC(sub > 255)
        this.setV((((this.A ^ sub) & (operand ^ sub) & 0x80)) != 0)
        this.A = sub & 255
        this.setZN(this.A)
      }
    })
  }

  // store instructions

  private STA(addressing: AddrProc) {
    return addressing(() => {
      this.data = this.A
    })
  }

  private STX(addressing: AddrProc) {
    return addressing(() => {
      this.data = this.X
    })
  }

  private STY(addressing: AddrProc) {
    return addressing(() => {
      this.data = this.Y
    })
  }

  private STZ(addressing: AddrProc) {
    return addressing(() => {
      this.data = 0
    })
  }

  // read-modify-write instructions

  private ASL(addressing: AddrProc) {
    return addressing(() => {
      this.setC(this.data > 127)
      const par = (this.data << 1) & 255
      this.data = par
      this.setZN(par)
    })
  }

  private DEC(addressing: AddrProc) {
    return addressing(() => {
      const par = (this.data - 1) & 255
      this.data = par
      this.setZN(par)
    })
  }

  private INC(addressing: AddrProc) {
    return addressing(() => {
      const par = (this.data + 1) & 255
      this.data = par
      this.setZN(par)
    })
  }

  private LSR(addressing: AddrProc) {
    return addressing(() => {
      this.C = this.data & 0x01
      this.data >>>= 1
      this.setZ(this.data)
      this.N = 0
    })
  }

  private ROL(addressing: AddrProc) {
    return addressing(() => {
      var newC = this.data > 127
      const par = ((this.data << 1) | this.C) & 255
      this.data = par
      this.setC(newC)
      this.setZN(par)
    })
  }

  private ROR(addressing: AddrProc) {
    return addressing(() => {
      var newC = (this.data & 0x01) != 0
      const par = (this.data >>> 1) | (this.C << 7)
      this.data = par
      this.setC(newC)
      this.setZN(par)
    })
  }

  // miscellaneous instructions

  private PHA() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      () => {
        this.pushToStack(this.A)
        this.vstack.PHA()
      },
      this.fetchNextOpcode
    ]
  }

  private PHX() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      () => {
        this.pushToStack(this.X)
        this.vstack.PHA()
      },
      this.fetchNextOpcode
    ]
  }

  private PHY() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      () => {
        this.pushToStack(this.Y)
        this.vstack.PHA()
      },
      this.fetchNextOpcode
    ]
  }

  private PHP() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      () => {
        // E and B bits always pushed as set
        this.pushToStack(this.getStatusBits() | 0x30)
        this.vstack.PHP()
      },
      this.fetchNextOpcode
    ]
  }

  private PLA() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => {
        this.A = this.popFromStack()
        this.setZN(this.A)
        this.vstack.PLA()
      },
      this.fetchNextOpcode
    ]
  }

  private PLX() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => {
        this.X = this.popFromStack()
        this.setZN(this.X)
        this.vstack.PLA()
      },
      this.fetchNextOpcode
    ]
  }

  private PLY() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => {
        this.Y = this.popFromStack()
        this.setZN(this.Y)
        this.vstack.PLA()
      },
      this.fetchNextOpcode
    ]
  }

  private PLP() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => {
        this.setStatusBits(this.popFromStack())
        this.vstack.PLP()
      },
      this.fetchNextOpcode
    ]
  }

  private JSR() {
    return [
      this.fetchNextOpcode,
      this.fetchADL,
      this.peekFromStack,
      () => { this.pushToStack((this.PC >>> 8) & 0xff) },
      () => { this.pushToStack(this.PC & 0xff) },
      this.fetchADH,
      () => {
        this.vstack.JSR(this.AD)
        this.PC = this.AD
        if (this.callHook) {
          this.callHook()
        }
        this.fetchNextOpcode()
      }
    ]
  }

  private TSB(addressing: AddrProc) {   // 65C02
    return addressing(() => {
      const par = this.data & this.A
      this.data |= this.A
      this.setZ(par)
    })
  }

  private TRB(addressing: AddrProc) {   // 65C02
    return addressing(() => {
      const par = this.data & this.A
      this.data &= this.A ^ 0xFF
      this.setZ(par)
    })
  }

  private WAI() {   // 65C02
    return [
      this.fetchNextOpcode,
      () => {},
      () => {},
      this.fetchNextOpcode
    ]
  }

  private STP() {   // 65C02
    return [
      this.fetchNextOpcode,
      () => {},
      () => {},
      this.fetchNextOpcode
    ]
  }

  private BRK() {
    return [
      this.fetchNextOpcode,
      this.fetchDataFromImm, // For debugging purposes, use operand as an arg for BRK!
      () => {
        if (this.debugHook) {
          this.debugHook()
        }
        this.pushToStack((this.PC >>> 8) & 0xff)
      },
      () => { this.pushToStack(this.PC & 0xff) },
      () => {
        // set E and B bits when pushing
        this.pushToStack(this.getStatusBits() | 0x30)
      },
      () => { this.AD = this.mem.read(IRQ_VECTOR, this.cycles) },
      () => { this.AD |= this.mem.read(IRQ_VECTOR + 1, this.cycles) << 8 },
      () => {
        this.vstack.BRK(this.AD)
        this.PC = this.AD
        this.I = 1
        this.D = 0      // TODO: 65C02-only
        this.fetchNextOpcode()
      }
    ]
  }

  private IRQ() {
    return [
      this.fetchNextOpcode,
      this.fetchDataFromImm, // For debugging purposes, use operand as an arg for BRK!
      () => { this.pushToStack((this.PC >>> 8) & 0xff) },
      () => { this.pushToStack(this.PC & 0xff) },
      () => { this.pushToStack(this.getStatusBits()) },
      () => { this.AD = this.mem.read(IRQ_VECTOR, this.cycles) },
      () => { this.AD |= this.mem.read(IRQ_VECTOR + 1, this.cycles) << 8 },
      () => {
        this.vstack.IRQ(this.AD)
        this.PC = this.AD
        this.fetchNextOpcode()
      }
    ]
  }

  private NMI() {
    return [
      this.fetchNextOpcode,
      this.fetchDataFromImm,
      () => {
        if (this.debugHook) {
          this.debugHook()
        }
        this.pushToStack((this.PC >>> 8) & 0xff)
      },
      () => { this.pushToStack(this.PC & 0xff) },
      () => { this.pushToStack(this.getStatusBits()) },
      () => { this.AD = this.mem.read(NMI_VECTOR, this.cycles) },
      () => { this.AD |= this.mem.read(NMI_VECTOR + 1, this.cycles) << 8 },
      () => {
        this.vstack.NMI(this.AD)
        this.PC = this.AD
        this.fetchNextOpcode()
      }
    ]
  }

  private RTI() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => { this.setStatusBits(this.popFromStack()) },
      () => { this.AD = this.popFromStack() },
      () => { this.AD |= this.popFromStack() << 8 },
      () => {
        this.vstack.RTI(this.AD)
        this.PC = this.AD
        this.fetchNextOpcode()
        if (this.returnHook) {
          this.returnHook()
        }
      }
    ]
  }

  private RTS() {
    return [
      this.fetchNextOpcode,
      this.fetchAndDiscard,
      this.peekFromStack,
      () => { this.AD = this.popFromStack() },
      () => { this.AD |= this.popFromStack() << 8 },
      () => {
        this.vstack.RTS(this.AD)
        this.PC = this.AD
        this.fetchDataFromImm()
        if (this.returnHook) {
          this.returnHook()
        }
      },
      this.fetchNextOpcode
    ]
  }

  // JMP $FFFF
  private JMP_ABS() {
    return [
      this.fetchNextOpcode,
      this.fetchADL,
      this.fetchADH,
      () => {
        this.vstack.JMP(this.AD)
        this.PC = this.AD
        this.fetchNextOpcode()
      }
    ]
  }

  // JMP ($FFFF)
  // 5 cycles with 6502 overflow bug
  private JMP_IND() {
    return [
      this.fetchNextOpcode,
      this.fetchIAL,        // 1
      this.fetchIAH,        // 2
      this.fetchBALFromIA,  // 3
      () => {               // 4
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      () => {               // 5
        this.vstack.JMP(this.BA)
        this.PC = this.BA
        this.fetchNextOpcode()
      }
    ]
  }

  // JMP ($FFFF)
  // 6 cycles with overflow bug fixed
  private JMP_IND_FIXED() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchIAL,          // 1
      this.fetchIAH,          // 2
      this.fetchBALFromIA,    // 3
      () => {                 // 4
        this.add1toIAL()
        this.fetchBAHFromIA()
      },
      () => {                 // 5
        if (this.IACarry != 0) {
          this.addIACarrytoIAH()
          this.fetchBAHFromIA()
        } else {
          this.vstack.JMP(this.BA)
          this.PC = this.BA
          this.fetchNextOpcode()
        }
      },
      () => {                 // 6
        this.vstack.JMP(this.BA)
        this.PC = this.BA
        this.fetchNextOpcode()
      }
    ]
  }

  // JMP ($FFFF,X)
  private JMP_AXI() {   // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchBAL,        // 1
      () => {               // 2
        this.fetchBAH()
        this.addXtoBAL()
      },
      () => {               // 3
        this.addBACarryToBAH()
        this.PC = this.BA
      },
      this.fetchBAL,        // 4
      this.fetchBAH,        // 5
      () => {               // 6
        this.vstack.JMP(this.BA)
        this.PC = this.BA
        this.fetchNextOpcode()
      }
    ]
  }

  private BPL() {
    return this.Bxx(() => { return this.N == 0 })
  }

  private BMI() {
    return this.Bxx(() => { return this.N == 1 })
  }

  private BVC() {
    return this.Bxx(() => { return this.V == 0 })
  }

  private BVS() {
    return this.Bxx(() => { return this.V == 1 })
  }

  private BCC() {
    return this.Bxx(() => { return this.C == 0 })
  }

  private BCS() {
    return this.Bxx(() => { return this.C == 1 })
  }

  private BNE() {
    return this.Bxx(() => { return this.Z == 0 })
  }

  private BEQ() {
    return this.Bxx(() => { return this.Z == 1 })
  }

  private BRA() {   // 65C02
    return this.Bxx(() => { return true })
  }

  private Bxx(branchTaken: () => boolean) {
    return [
      this.fetchNextOpcode,
      this.fetchBranchOffset,
      () => {
        if (branchTaken()) {
          this.fetchAndDiscard()
          this.addBranchOffsetToPCL()
        } else {
          this.fetchNextOpcode()
        }
      },
      () => {
        if (this.branchOffsetCrossAdjust) {
          this.fetchAndDiscard()
          this.adjustPCHForBranchOffsetCross()
        } else {
          this.fetchNextOpcode()
        }
      },
      this.fetchNextOpcode
    ]
  }

  private BBR(bit: number) {   // 65C02
    return this.BBRS(() => { this.data = (this.data ^ 0xff) & (1 << bit) })
  }

  private BBS(bit: number) {   // 65C02
    return this.BBRS(() => { this.data = this.data & (1 << bit) })
  }

  private BBRS(operation: Function) { // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchADL,          // 1
      this.fetchDataFromAD,   // 2
      this.fetchBranchOffset, // 3
      () => {                 // 4
        operation()
      },
      () => {                 // 5
        if (this.data != 0) {
          // branch taken
          this.addBranchOffsetToPCL()
        } else {
          // branch not taken
          this.fetchNextOpcode()
        }
      },
      () => {                 // 6 (branch taken)
        if (this.branchOffsetCrossAdjust) {
          this.adjustPCHForBranchOffsetCross()
        } else {
          this.fetchNextOpcode()
        }
      },
      this.fetchNextOpcode    // 7 (page crossed)
    ]
  }

  private RMB(bit: number) {   // 65C02
    return this.RSMB(() => { this.data &= ~(1 << bit) })
  }

  private SMB(bit: number) {   // 65C02
    return this.RSMB(() => { this.data |= (1 << bit) })
  }

  private RSMB(operation: Function) { // 65C02
    return [
      this.fetchNextOpcode,
      this.fetchADL,        // 1
      this.fetchDataFromAD, // 2
      () => {               // 3
        operation()
      },
      this.writeDataToAD,   // 4
      this.fetchNextOpcode  // 5
    ]
  }

  private ILL() {
    return [
      this.fetchNextOpcode,
      // TODO: break into debugger? NOP?
      () => {
        console.log("Illegal")
      },
      this.fetchNextOpcode
    ]
  }

  private initInst6502() {
    const illegal = this.ILL()
    for (let i = 0; i < this.instructions.length; i += 1) {
      this.instructions[i] = illegal
    }

    this.instructions[0x00] = this.BRK()
    this.instructions[0x01] = this.ORA(this.indXRead)
//  this.instructions[0x02] =
//  this.instructions[0x03] =
//  this.instructions[0x04] =
    this.instructions[0x05] = this.ORA(this.zpageRead)
    this.instructions[0x06] = this.ASL(this.zpageReadWrite)
//  this.instructions[0x07] =
    this.instructions[0x08] = this.PHP()
    this.instructions[0x09] = this.ORA(this.immRead)
    this.instructions[0x0a] = this.ASL_A()
//  this.instructions[0x0b] =
//  this.instructions[0x0c] =
    this.instructions[0x0d] = this.ORA(this.absRead)
    this.instructions[0x0e] = this.ASL(this.absReadWrite)
//  this.instructions[0x0f] =
    this.instructions[0x10] = this.BPL()
    this.instructions[0x11] = this.ORA(this.indYRead)
//  this.instructions[0x12] =
//  this.instructions[0x13] =
//  this.instructions[0x14] =
    this.instructions[0x15] = this.ORA(this.zpageXRead)
    this.instructions[0x16] = this.ASL(this.zpageXReadWrite)
//  this.instructions[0x17] =
    this.instructions[0x18] = this.CLC()
    this.instructions[0x19] = this.ORA(this.absYRead)
//  this.instructions[0x1a] =
//  this.instructions[0x1b] =
//  this.instructions[0x1c] =
    this.instructions[0x1d] = this.ORA(this.absXRead)
    this.instructions[0x1e] = this.ASL(this.absXReadWrite)
//  this.instructions[0x1f] =
    this.instructions[0x20] = this.JSR()
    this.instructions[0x21] = this.AND(this.indXRead)
//  this.instructions[0x22] =
//  this.instructions[0x23] =
    this.instructions[0x24] = this.BIT(this.zpageRead)
    this.instructions[0x25] = this.AND(this.zpageRead)
    this.instructions[0x26] = this.ROL(this.zpageReadWrite)
//  this.instructions[0x27] =
    this.instructions[0x28] = this.PLP()
    this.instructions[0x29] = this.AND(this.immRead)
    this.instructions[0x2a] = this.ROL_A()
//  this.instructions[0x2b] =
    this.instructions[0x2c] = this.BIT(this.absRead)
    this.instructions[0x2d] = this.AND(this.absRead)
    this.instructions[0x2e] = this.ROL(this.absReadWrite)
//  this.instructions[0x2f] =
    this.instructions[0x30] = this.BMI()
    this.instructions[0x31] = this.AND(this.indYRead)
//  this.instructions[0x32] =
//  this.instructions[0x33] =
//  this.instructions[0x34] =
    this.instructions[0x35] = this.AND(this.zpageXRead)
    this.instructions[0x36] = this.ROL(this.zpageXReadWrite)
//  this.instructions[0x37] =
    this.instructions[0x38] = this.SEC()
    this.instructions[0x39] = this.AND(this.absYRead)
//  this.instructions[0x3a] =
//  this.instructions[0x3b] =
//  this.instructions[0x3c] =
    this.instructions[0x3d] = this.AND(this.absXRead)
    this.instructions[0x3e] = this.ROL(this.absXReadWrite)
//  this.instructions[0x3f] =
    this.instructions[0x40] = this.RTI()
    this.instructions[0x41] = this.EOR(this.indXRead)
//  this.instructions[0x42] =
//  this.instructions[0x43] =
//  this.instructions[0x44] =
    this.instructions[0x45] = this.EOR(this.zpageRead)
    this.instructions[0x46] = this.LSR(this.zpageReadWrite)
//  this.instructions[0x47] =
    this.instructions[0x48] = this.PHA()
    this.instructions[0x49] = this.EOR(this.immRead)
    this.instructions[0x4a] = this.LSR_A()
//  this.instructions[0x4b] =
    this.instructions[0x4c] = this.JMP_ABS()
    this.instructions[0x4d] = this.EOR(this.absRead)
    this.instructions[0x4e] = this.LSR(this.absReadWrite)
//  this.instructions[0x4f] =
    this.instructions[0x50] = this.BVC()
    this.instructions[0x51] = this.EOR(this.indYRead)
//  this.instructions[0x52] =
//  this.instructions[0x53] =
//  this.instructions[0x54] =
    this.instructions[0x55] = this.EOR(this.zpageXRead)
    this.instructions[0x56] = this.LSR(this.zpageXReadWrite)
//  this.instructions[0x57] =
    this.instructions[0x58] = this.CLI()
    this.instructions[0x59] = this.EOR(this.absYRead)
//  this.instructions[0x5a] =
//  this.instructions[0x5b] =
//  this.instructions[0x5c] =
    this.instructions[0x5d] = this.EOR(this.absXRead)
    this.instructions[0x5e] = this.LSR(this.absXReadWrite)
//  this.instructions[0x5f] =
    this.instructions[0x60] = this.RTS()
    this.instructions[0x61] = this.ADC(this.indXRead)
//  this.instructions[0x62] =
//  this.instructions[0x63] =
//  this.instructions[0x64] =
    this.instructions[0x65] = this.ADC(this.zpageRead)
    this.instructions[0x66] = this.ROR(this.zpageReadWrite)
//  this.instructions[0x67] =
    this.instructions[0x68] = this.PLA()
    this.instructions[0x69] = this.ADC(this.immRead)
    this.instructions[0x6a] = this.ROR_A()
//  this.instructions[0x6b] =
    this.instructions[0x6c] = this.JMP_IND()
    this.instructions[0x6d] = this.ADC(this.absRead)
    this.instructions[0x6e] = this.ROR(this.absReadWrite)
//  this.instructions[0x6f] =
    this.instructions[0x70] = this.BVS()
    this.instructions[0x71] = this.ADC(this.indYRead)
//  this.instructions[0x72] =
//  this.instructions[0x73] =
//  this.instructions[0x74] =
    this.instructions[0x75] = this.ADC(this.zpageXRead)
    this.instructions[0x76] = this.ROR(this.zpageXReadWrite)
//  this.instructions[0x77] =
    this.instructions[0x78] = this.SEI()
    this.instructions[0x79] = this.ADC(this.absYRead)
//  this.instructions[0x7a] =
//  this.instructions[0x7b] =
//  this.instructions[0x7c] =
    this.instructions[0x7d] = this.ADC(this.absXRead)
    this.instructions[0x7e] = this.ROR(this.absXReadWrite)
//  this.instructions[0x7f] =
//  this.instructions[0x80] =
    this.instructions[0x81] = this.STA(this.indXWrite)
//  this.instructions[0x82] = uESC()
//  this.instructions[0x83] =
    this.instructions[0x84] = this.STY(this.zpageWrite)
    this.instructions[0x85] = this.STA(this.zpageWrite)
    this.instructions[0x86] = this.STX(this.zpageWrite)
//  this.instructions[0x87] =
    this.instructions[0x88] = this.DEY()
//  this.instructions[0x89] =
    this.instructions[0x8a] = this.TXA()
//  this.instructions[0x8b] =
    this.instructions[0x8c] = this.STY(this.absWrite)
    this.instructions[0x8d] = this.STA(this.absWrite)
    this.instructions[0x8e] = this.STX(this.absWrite)
//  this.instructions[0x8f] =
    this.instructions[0x90] = this.BCC()
    this.instructions[0x91] = this.STA(this.indYWrite)
//  this.instructions[0x92] =
//  this.instructions[0x93] =
    this.instructions[0x94] = this.STY(this.zpageXWrite)
    this.instructions[0x95] = this.STA(this.zpageXWrite)
    this.instructions[0x96] = this.STX(this.zpageYWrite)
//  this.instructions[0x97] =
    this.instructions[0x98] = this.TYA()
    this.instructions[0x99] = this.STA(this.absYWrite)
    this.instructions[0x9a] = this.TXS()
//  this.instructions[0x9b] =
//  this.instructions[0x9c] =
    this.instructions[0x9d] = this.STA(this.absXWrite)
//  this.instructions[0x9e] =
//  this.instructions[0x9f] =
    this.instructions[0xa0] = this.LDY(this.immRead)
    this.instructions[0xa1] = this.LDA(this.indXRead)
    this.instructions[0xa2] = this.LDX(this.immRead)
//  this.instructions[0xa3] =
    this.instructions[0xa4] = this.LDY(this.zpageRead)
    this.instructions[0xa5] = this.LDA(this.zpageRead)
    this.instructions[0xa6] = this.LDX(this.zpageRead)
//  this.instructions[0xa7] =
    this.instructions[0xa8] = this.TAY()
    this.instructions[0xa9] = this.LDA(this.immRead)
    this.instructions[0xaa] = this.TAX()
//  this.instructions[0xab] =
    this.instructions[0xac] = this.LDY(this.absRead)
    this.instructions[0xad] = this.LDA(this.absRead)
    this.instructions[0xae] = this.LDX(this.absRead)
//  this.instructions[0xaf] =
    this.instructions[0xb0] = this.BCS()
    this.instructions[0xb1] = this.LDA(this.indYRead)
//  this.instructions[0xb2] =
//  this.instructions[0xb3] =
    this.instructions[0xb4] = this.LDY(this.zpageXRead)
    this.instructions[0xb5] = this.LDA(this.zpageXRead)
    this.instructions[0xb6] = this.LDX(this.zpageYRead)
//  this.instructions[0xb7] =
    this.instructions[0xb8] = this.CLV()
    this.instructions[0xb9] = this.LDA(this.absYRead)
    this.instructions[0xba] = this.TSX()
//  this.instructions[0xbb] =
    this.instructions[0xbc] = this.LDY(this.absXRead)
    this.instructions[0xbd] = this.LDA(this.absXRead)
    this.instructions[0xbe] = this.LDX(this.absYRead)
//  this.instructions[0xbf] =
    this.instructions[0xc0] = this.CPY(this.immRead)
    this.instructions[0xc1] = this.CMP(this.indXRead)
//  this.instructions[0xc2] = uESC(1)
//  this.instructions[0xc3] =
    this.instructions[0xc4] = this.CPY(this.zpageRead)
    this.instructions[0xc5] = this.CMP(this.zpageRead)
    this.instructions[0xc6] = this.DEC(this.zpageReadWrite)
//  this.instructions[0xc7] =
    this.instructions[0xc8] = this.INY()
    this.instructions[0xc9] = this.CMP(this.immRead)
    this.instructions[0xca] = this.DEX()
//  this.instructions[0xcb] =
    this.instructions[0xcc] = this.CPY(this.absRead)
    this.instructions[0xcd] = this.CMP(this.absRead)
    this.instructions[0xce] = this.DEC(this.absReadWrite)
//  this.instructions[0xcf] =
    this.instructions[0xd0] = this.BNE()
    this.instructions[0xd1] = this.CMP(this.indYRead)
//  this.instructions[0xd2] =
//  this.instructions[0xd3] =
//  this.instructions[0xd4] =
    this.instructions[0xd5] = this.CMP(this.zpageXRead)
    this.instructions[0xd6] = this.DEC(this.zpageXReadWrite)
//  this.instructions[0xd7] =
    this.instructions[0xd8] = this.CLD()
    this.instructions[0xd9] = this.CMP(this.absYRead)
//  this.instructions[0xda] =
//  this.instructions[0xdb] =
//  this.instructions[0xdc] =
    this.instructions[0xdd] = this.CMP(this.absXRead)
    this.instructions[0xde] = this.DEC(this.absXReadWrite)
//  this.instructions[0xdf] =
    this.instructions[0xe0] = this.CPX(this.immRead)
    this.instructions[0xe1] = this.SBC(this.indXRead)
//  this.instructions[0xe2] = uESC()
//  this.instructions[0xe3] =
    this.instructions[0xe4] = this.CPX(this.zpageRead)
    this.instructions[0xe5] = this.SBC(this.zpageRead)
    this.instructions[0xe6] = this.INC(this.zpageReadWrite)
//  this.instructions[0xe7] =
    this.instructions[0xe8] = this.INX()
    this.instructions[0xe9] = this.SBC(this.immRead)
    this.instructions[0xea] = this.NOP()
//  this.instructions[0xeb] =
    this.instructions[0xec] = this.CPX(this.absRead)
    this.instructions[0xed] = this.SBC(this.absRead)
    this.instructions[0xee] = this.INC(this.absReadWrite)
//  this.instructions[0xef] =
    this.instructions[0xf0] = this.BEQ()
    this.instructions[0xf1] = this.SBC(this.indYRead)
//  this.instructions[0xf2] =
//  this.instructions[0xf3] =
//  this.instructions[0xf4] =
    this.instructions[0xf5] = this.SBC(this.zpageXRead)
    this.instructions[0xf6] = this.INC(this.zpageXReadWrite)
//  this.instructions[0xf7] =
    this.instructions[0xf8] = this.SED()
    this.instructions[0xf9] = this.SBC(this.absYRead)
//  this.instructions[0xfa] =
//  this.instructions[0xfb] =
//  this.instructions[0xfc] =
    this.instructions[0xfd] = this.SBC(this.absXRead)
    this.instructions[0xfe] = this.INC(this.absXReadWrite)
//  this.instructions[0xff] =
  }

  // TODO: cycle differences for BCD operations
  // TODO: fixes for other 6502 bugs
  private initInst65C02() {
    this.initInst6502()

    this.instructions[0x04] = this.TSB(this.zpageReadWrite)
    this.instructions[0x0c] = this.TSB(this.absReadWrite)
    this.instructions[0x12] = this.ORA(this.indZRead)
    this.instructions[0x14] = this.TRB(this.zpageReadWrite)
    this.instructions[0x1a] = this.INC_A()
    this.instructions[0x1c] = this.TRB(this.absReadWrite)
    this.instructions[0x32] = this.AND(this.indZRead)
    this.instructions[0x34] = this.BIT(this.zpageXRead)
    this.instructions[0x3a] = this.DEC_A()
    this.instructions[0x3c] = this.BIT(this.absXRead)
    this.instructions[0x52] = this.EOR(this.indZRead)
    this.instructions[0x5a] = this.PHY()
    this.instructions[0x64] = this.STZ(this.zpageWrite)
    this.instructions[0x72] = this.ADC(this.indZRead)
    this.instructions[0x74] = this.STZ(this.zpageXWrite)
    this.instructions[0x7a] = this.PLY()
    this.instructions[0x7c] = this.JMP_AXI()
    this.instructions[0x80] = this.BRA()
    this.instructions[0x89] = this.BIT_IMM(this.immRead)
    this.instructions[0x92] = this.STA(this.indZWrite)
    this.instructions[0x9c] = this.STZ(this.absWrite)
    this.instructions[0x9e] = this.STZ(this.absXWrite)
    this.instructions[0xb2] = this.LDA(this.indZRead)
    this.instructions[0xcb] = this.WAI()
    this.instructions[0xd2] = this.CMP(this.indZRead)
    this.instructions[0xda] = this.PHX()
    this.instructions[0xdb] = this.STP()
    this.instructions[0xf2] = this.SBC(this.indZRead)
    this.instructions[0xfa] = this.PLX()

    // changed/fixed instructions
    this.instructions[0x6c] = this.JMP_IND_FIXED()

    this.instructions[0x07] = this.RMB(0)
    this.instructions[0x17] = this.RMB(1)
    this.instructions[0x27] = this.RMB(2)
    this.instructions[0x37] = this.RMB(3)
    this.instructions[0x47] = this.RMB(4)
    this.instructions[0x57] = this.RMB(5)
    this.instructions[0x67] = this.RMB(6)
    this.instructions[0x77] = this.RMB(7)
    this.instructions[0x87] = this.SMB(0)
    this.instructions[0x97] = this.SMB(1)
    this.instructions[0xa7] = this.SMB(2)
    this.instructions[0xb7] = this.SMB(3)
    this.instructions[0xc7] = this.SMB(4)
    this.instructions[0xd7] = this.SMB(5)
    this.instructions[0xe7] = this.SMB(6)
    this.instructions[0xf7] = this.SMB(7)

    this.instructions[0x0f] = this.BBR(0)
    this.instructions[0x1f] = this.BBR(1)
    this.instructions[0x2f] = this.BBR(2)
    this.instructions[0x3f] = this.BBR(3)
    this.instructions[0x4f] = this.BBR(4)
    this.instructions[0x5f] = this.BBR(5)
    this.instructions[0x6f] = this.BBR(6)
    this.instructions[0x7f] = this.BBR(7)
    this.instructions[0x8f] = this.BBS(0)
    this.instructions[0x9f] = this.BBS(1)
    this.instructions[0xaf] = this.BBS(2)
    this.instructions[0xbf] = this.BBS(3)
    this.instructions[0xcf] = this.BBS(4)
    this.instructions[0xdf] = this.BBS(5)
    this.instructions[0xef] = this.BBS(6)
    this.instructions[0xff] = this.BBS(7)

    this.instructions[0x02] = this.NOP2()
    this.instructions[0x22] = this.NOP2()
    this.instructions[0x42] = this.NOP2()
    this.instructions[0x62] = this.NOP2()
    this.instructions[0x82] = this.NOP2()
    this.instructions[0xc2] = this.NOP2()
    this.instructions[0xe2] = this.NOP2()
    this.instructions[0x44] = this.NOP2()
    this.instructions[0x54] = this.NOP2()
    this.instructions[0xd4] = this.NOP2()
    this.instructions[0xf4] = this.NOP2()

    this.instructions[0x5c] = this.NOP3()
    this.instructions[0xdc] = this.NOP3()
    this.instructions[0xfc] = this.NOP3()

    this.instructions[0x03] = this.NOP1()
    this.instructions[0x13] = this.NOP1()
    this.instructions[0x23] = this.NOP1()
    this.instructions[0x33] = this.NOP1()
    this.instructions[0x43] = this.NOP1()
    this.instructions[0x53] = this.NOP1()
    this.instructions[0x63] = this.NOP1()
    this.instructions[0x73] = this.NOP1()
    this.instructions[0x83] = this.NOP1()
    this.instructions[0x93] = this.NOP1()
    this.instructions[0xa3] = this.NOP1()
    this.instructions[0xb3] = this.NOP1()
    this.instructions[0xc3] = this.NOP1()
    this.instructions[0xd3] = this.NOP1()
    this.instructions[0xe3] = this.NOP1()
    this.instructions[0xf3] = this.NOP1()
    this.instructions[0x0b] = this.NOP1()
    this.instructions[0x1b] = this.NOP1()
    this.instructions[0x2b] = this.NOP1()
    this.instructions[0x3b] = this.NOP1()
    this.instructions[0x4b] = this.NOP1()
    this.instructions[0x5b] = this.NOP1()
    this.instructions[0x6b] = this.NOP1()
    this.instructions[0x7b] = this.NOP1()
    this.instructions[0x8b] = this.NOP1()
    this.instructions[0x9b] = this.NOP1()
    this.instructions[0xab] = this.NOP1()
    this.instructions[0xbb] = this.NOP1()
    this.instructions[0xeb] = this.NOP1()
    this.instructions[0xfb] = this.NOP1()
  }

  // special escape instructions (0x82, 0xc2, 0xe2)
  private ESC(index: number) {
    return this.immRead(() => {
      if (this.escapeHooks && this.escapeHooks[index]) {
        this.cycles -= 2
        this.escapeHooks[index](this.data, this.cycles)
      }
    })
  }

  private initEscapeOpcodes() {
    this.instructions[0x82] = this.ESC(0)
    this.instructions[0xc2] = this.ESC(1)
    this.instructions[0xe2] = this.ESC(2)
  }

  public getRegIndex(opByte: number): number | undefined {
    return getRegIndex(this, this._isa, opByte)
  }

  public computeAddress(opBytes: number[], useIndex: boolean = true): OpInfo {
    return computeAddress(this, this._isa, opBytes, useIndex)
  }
}

//------------------------------------------------------------------------------

// push is (sp)- : write(sp), sp = (sp - 1) & 255
// pull is +(sp) : sp = (sp + 1) & 255, read(sp)

enum Tracker {
  Empty = -1,
  Php = -2,
  Pha = -3
}

type SimpleEntry = {
  proc: number
  regs: number[]
  cycles: number
}

class VirtualStack {

  private cpu: Cpu65xx
  private stack: SimpleEntry[] = []
  private tracker: number[] = []
  private currProc: number = -1

  constructor(cpu: Cpu65xx) {
    this.cpu = cpu
    this.reset()
  }

  public getStateStack(): any {
    let state: any = {}
    state.stack = []
    for (const entry of this.stack) {
      state.stack.push({
        proc: entry.proc,
        regs: [...entry.regs],
        cycles: entry.cycles
      })
    }
    state.tracker = [...this.tracker]
    state.currProc = this.currProc
    return state
  }

  public flattenState(state: any) {
  }

  public setState(state: any) {
    this.stack = []
    for (const entry of state.stack) {
      this.stack.push({
        proc: entry.proc,
        regs: [...entry.regs],
        cycles: entry.cycles
      })
    }
    this.tracker = [...state.tracker]
    this.currProc = state.currProc
  }

  private reset() {
    this.stack = []
    this.tracker = []
    this.currProc = this.cpu.getPC()
  }

  public JSR(dstAddr: number) {
    const PC = this.cpu.getPC() - 2
    // TODO: subtract 1? 3?
    this.tracker.push(PC >> 8)     // high
    this.tracker.push(PC & 255)    // low

    // calling proc, retAddr to JSR
    this.pushState(this.currProc, PC)

    this.currProc = dstAddr
  }

  public RTS(dstAddr: number) {
    // TODO: validation
    //  - values turned negative, or missing from reset()
    const high = this.tracker.pop() ?? Tracker.Empty
    const low = this.tracker.pop() ?? Tracker.Empty

    if (high < 0) {
      // stack is in bad state
      if (high == Tracker.Empty) {
        // TODO: break and report error
        console.log("Stack error detected on RTS")
        this.reset()
        return
      }
      // returning on PHP value
      if (high == Tracker.Php) {
        // TODO: break and report error
        console.log("Bad RTS on PHP value")
        this.reset()
        return
      }
      if (low != Tracker.Pha) {
        // TODO: break and report error
        console.log("Bad RTS on PHA value")
        this.reset()
        return
      }
      // both low and high have been repushed,
      //  so maybe updated stack
      // TODO: more here?
    } else if (low < 0) {
      // stack is in bad state
      if (high == Tracker.Empty) {
        // TODO: break and report error
        console.log("Stack error detected on RTS")
        this.reset()
        return
      }
      // returning on PHP value
      if (high == Tracker.Php) {
        // TODO: break and report error
        console.log("RTS on PHP value")
        this.reset()
        return
      }
      // TODO: break and report error
      console.log("Bad RTS on PHA value")
      this.reset()
      return
    }

    const frame = this.stack.pop()
    if (frame) {
      this.currProc = frame.proc
    }
  }

  public PHA() {
    this.tracker.push(Tracker.Pha)
  }

  public PHP() {
    this.tracker.push(Tracker.Php)
  }

  public PLA() {
    const value = this.tracker.pop()
    if (value != Tracker.Php && value != Tracker.Pha) {
      // TODO: popping return value -- correct vstack
    }
  }

  public PLP() {
    const value = this.tracker.pop()
    if (value != Tracker.Php && value != Tracker.Pha) {
      // TODO: break and report error
      console.log("PLP on return address")
      this.reset()
      return
    }
  }

  // TODO: handle these

  public BRK(dstAddr: number) {
  }

  public IRQ(dstAddr: number) {
  }

  public NMI(dstAddr: number) {
  }

  public RTI(dstAddr: number) {
  }

  public TXS() {
  }

  // TODO: rethink handling JMP as possible JSR + RTS
  public JMP(dstAddr: number) {
  }

  public getCallStack(): StackEntry[] {

    // TODO: get rid of this cleanup hack
    // (can't do it in reset() or loadState() because PC is actually PC-1)
    if (this.currProc == 0xffff) {
      this.currProc = this.cpu.getPC()
    }

    this.pushState(this.currProc, this.cpu.getPC())
    const result: StackEntry[] = []
    for (let i = this.stack.length; --i >= 0; ) {
      const entry = this.stack[i]
      result.push({
        proc: entry.proc,
        regs: [
          // PC always first
          { name: "PC", value: entry.regs[0], bitSize: 16 },
          { name: "SP", value: entry.regs[1] },
          // flagNames always upper case
          { name: "PS", value: entry.regs[2], flagNames: "CZIDBEVN" },
          { name: "A", value: entry.regs[3] },
          { name: "X", value: entry.regs[4] },
          { name: "Y", value: entry.regs[5] },
        ],
        cycles: entry.cycles
      })
    }
    this.stack.pop()
    return result
  }

  private pushState(proc: number, procPC: number) {
    this.stack.push({
      proc: proc,
      regs: [
        procPC,
        this.cpu.SP,
        this.cpu.getStatusBits(),
        this.cpu.A,
        this.cpu.X,
        this.cpu.Y,
      ],
      cycles: this.cpu.cycles
    })
  }
}

//------------------------------------------------------------------------------

// TODO: figure out how to integrate these cleanly and generally

function getRegIndex(cpu: Cpu65xx, isa: Isa, opByte: number): number | undefined {
  const opDef = isa.opcodes[opByte]
  switch (opDef.mode) {
    case OpMode.ZPX:      // $FF,X
    case OpMode.ABSX:     // $FFFF,X
    case OpMode.LABX:     // $FFFFFF,X
      return cpu.X

    case OpMode.ZPY:      // $FF,Y
    case OpMode.ABSY:     // $FFFF,Y
    case OpMode.INDY:     // ($FF),Y
    case OpMode.LIY:      // [$FF],Y
    case OpMode.SIY:      // (stack,S),Y
    case OpMode.RIY:      // (stack,R),Y
      return cpu.Y

    case OpMode.NONE:     //
    case OpMode.A:        // a
    case OpMode.IMM:      // #$FF
    case OpMode.ZP:       // $FF
    case OpMode.ABS:      // $FFFF
    case OpMode.IND:      // ($FFFF)
    case OpMode.INDX:     // ($FF,X)
    case OpMode.REL:      // *+-$FF
    case OpMode.ZP_REL:   // $FF,*+-$FF
    case OpMode.INZ:      // ($FF)
    case OpMode.AXI:      // ($FFFF,X)
    case OpMode.LIN:      // [$FF]
    case OpMode.ALI:      // [$FFFF]
    case OpMode.STS:      // stack,S
    case OpMode.SD:       // #$FF,#$FF
    case OpMode.LREL:     // *+-$FFFF
    case OpMode.LABS:     // $FFFFFF
    case OpMode.STR:      // stack,R
    case OpMode.ILLEGAL:
      break
  }
}

function computeAddress(cpu: Cpu65xx, isa: Isa, opBytes: number[], useIndex: boolean = true): OpInfo {
  const mem = cpu.mem
  const data0 = opBytes[0]
  const data1 = opBytes[1] ?? 0
  const data2 = opBytes[2] ?? 0
  const opDef = isa.opcodes[data0]
  let address = -1
  let size = 0
  switch (opDef.mode) {
    case OpMode.NONE:     //
    case OpMode.A:        // a
    case OpMode.IMM:      // #$FF
      break
    case OpMode.ZP:       // $FF
      address = data1
      size = 2
      break
    case OpMode.ZPX:      // $FF,X
      address = data1
      if (useIndex) {
        address = (address + cpu.X) & 0xff
      }
      size = 2
      break
    case OpMode.ZPY:      // $FF,Y
      address = data1
      if (useIndex) {
        address = (address + cpu.Y) & 0xff
      }
      size = 2
      break
    case OpMode.ABS:      // $FFFF
      address = data1 + (data2 << 8)
      size = 4
      break
    case OpMode.ABSX:     // $FFFF,X
      address = data1 + (data2 << 8)
      if (useIndex) {
        address = (address + cpu.X) & 0xffff
      }
      size = 4
      break
    case OpMode.ABSY:     // $FFFF,Y
      address = data1 + (data2 << 8)
      if (useIndex) {
        address = (address + cpu.Y) & 0xffff
      }
      size = 4
      break
    case OpMode.IND:      // ($FFFF)
      // *** TODO
      break
    case OpMode.INDX:     // ($FF,X)
      // always use index, even if useIndex is false
      let zaddr = data1 + cpu.X
      address = mem.readConst(zaddr & 0xff) + (mem.readConst((zaddr + 1) & 0xff) << 8)
      size = 4
      break
    case OpMode.INDY:     // ($FF),Y
      address = mem.readConst(data1) + (mem.readConst((data1 + 1) & 0xff) << 8)
      if (useIndex) {
        address = (address + cpu.Y) & 0xffff
      }
      size = 4
      break
    case OpMode.REL:      // *+-$FF
      // TODO: compute this?
      break
    case OpMode.INZ:      // ($FF)
      address = mem.readConst(data1) + (mem.readConst((data1 + 1) & 0xff) << 8)
      size = 4
      break
    case OpMode.ZP_REL:   // $FF,*+-$FF
    case OpMode.AXI:      // ($FFFF,X)
    case OpMode.LIN:      // [$FF]
    case OpMode.LIY:      // [$FF],Y
    case OpMode.ALI:      // [$FFFF]
    case OpMode.STS:      // stack,S
    case OpMode.SIY:      // (stack,S),Y
    case OpMode.SD:       // #$FF,#$FF
    case OpMode.LREL:     // *+-$FFFF
    case OpMode.LABS:     // $FFFFFF
    case OpMode.LABX:     // $FFFFFF,X
    case OpMode.STR:      // stack,R
    case OpMode.RIY:      // (stack,R),Y
      // *** TODO
      break
    default:
      break
  }

  return { address, size, opcode: opDef }
}

//------------------------------------------------------------------------------
