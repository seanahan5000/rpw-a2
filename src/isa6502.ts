// TODO: dbug-only
// import { Machine } from "./machine"
// import { SourceLine } from "./source_doc"

// TODO: add 65c02 instructions
// TODO: abstract Machine and SourceLine use

//------------------------------------------------------------------------------

type OpInfo = {
  type: string,
  address: number,
  size: number
}

export abstract class Isa6502 {

  // TODO: dbug-only
  // public static getRegIndex(machine: Machine, sourceLine: SourceLine): number {
  //   switch (Isa6502.ops[sourceLine.objBuffer[sourceLine.objOffset + 0]].ad) {
  //     case "zpx":
  //       return machine.getX()
  //     case "zpy":
  //       return machine.getY()
  //     case "abx":
  //       return machine.getX()
  //     case "aby":
  //       return machine.getY()
  //     case "iny":
  //       return machine.getY()
  //     default:
  //       break
  //   }
  // }

  // TODO: dbug-only
  // public static computeAddress(machine: Machine, sourceLine: SourceLine, useIndex: boolean = true): OpInfo {
  //   let data0 = sourceLine.objBuffer[sourceLine.objOffset + 0]
  //   let data1 = sourceLine.objLength >= 1 ? sourceLine.objBuffer[sourceLine.objOffset + 1] : 0
  //   let data2 = sourceLine.objLength >= 2 ? sourceLine.objBuffer[sourceLine.objOffset + 2] : 0
  //   let type = Isa6502.ops[data0].ad
  //   let address = -1
  //   let size = 0
  //   switch (type) {
  //     case "zp":
  //       address = data1
  //       size = 2
  //       break
  //     case "zpx":
  //       address = data1
  //       if (useIndex) {
  //         address = (address + machine.getX()) & 0xff
  //       }
  //       size = 2
  //       break
  //     case "zpy":
  //       address = data1
  //       if (useIndex) {
  //         address = (address + machine.getY()) & 0xff
  //       }
  //       size = 2
  //       break
  //     case "jab":
  //     case "jsr":
  //     case "abs":
  //       address = data1 + (data2 << 8)
  //       size = 4
  //       break
  //     case "abx":
  //       address = data1 + (data2 << 8)
  //       if (useIndex) {
  //         address = (address + machine.getX()) & 0xffff
  //       }
  //       size = 4
  //       break
  //     case "aby":
  //       address = data1 + (data2 << 8)
  //       if (useIndex) {
  //         address = (address + machine.getY()) & 0xffff
  //       }
  //       size = 4
  //       break
  //     case "inx":
  //       // always use index, even if useIndex is false
  //       let zaddr = data1 + machine.getX()
  //       address = machine.readConst(zaddr & 0xff) + (machine.readConst((zaddr + 1) & 0xff) << 8)
  //       size = 4
  //       break
  //     case "iny":
  //       address = machine.readConst(data1) + (machine.readConst((data1 + 1) & 0xff) << 8)
  //       if (useIndex) {
  //         address = (address + machine.getY()) & 0xffff
  //       }
  //       size = 4
  //       break
  //     default:
  //       break
  //   }
  //
  //   return { type: type, address: address, size: size }
  // }

  // TODO: share with disassembler
  public static DisassembleArgs(dataBytes: Uint8Array, offset: number, address: number): string {
    let result = ""
    let opByte = dataBytes[offset + 0]
    let adMode = Isa6502.ops[opByte].ad
    if (adMode.startsWith("ab") || adMode == "jsr" || adMode == "jab") {
      let value = dataBytes[offset + 1] + (dataBytes[offset + 2] * 256)
      result = "$" + value.toString(16).padStart(4, "0")
      if (adMode == "abx") {
        result += ",x"
      } else if (adMode == "aby") {
        result += ",y"
      }
    } else if (adMode == "rel") {
      let value = dataBytes[offset + 1]
      if (value >= 128) {
        value = -((value ^ 0xff) + 1)
      }
      value += address + 2
      result = "$" + value.toString(16).padStart(4, "0")
    } else if (adMode != "") {
      if (Isa6502.ops[opByte].bc == 2) {
        result = "$" + dataBytes[offset + 1].toString(16).padStart(2, "0")
      }
      if (adMode == "imm") {
        result = "#" + result
      } else if (adMode == "zpx") {
        result += ",x"
      } else if (adMode == "zpy") {
        result += ",y"
      } else if (adMode == "iny") {
        result = "(" + result + "),y"
      } else if (adMode == "inx") {
        result = "(" + result + ",x)"
      }
      // TODO: jsr, jab, jin, a
    }
    return result
  }

  // Return true for any opcode that will change PC
  //  to anything other than the next instruction.
  public static isFlowControl(opByte: number): boolean {
    return Isa6502.ops[opByte].fc == true
  }

  public static isIllegal(opByte: number): boolean {
    return Isa6502.ops[opByte].op == "???"
  }

  // used for coverage marking as branch target
  public static isBranch(opByte: number): boolean {
    return Isa6502.ops[opByte].ad == "rel"
  }

  // used for StepOver and coverage marking as call target
  public static isCall(opByte: number): boolean {
    return opByte == 0x20  // jsr
  }

  // used for StepOut
  public static isReturn(opByte: number): boolean {
    return opByte == 0x60 || opByte == 0x40  // rts || rti
  }

  // used for coverage marking as jump target
  public static isJump(opByte: number): boolean {
    // jump absolute or indirect
    return opByte == 0x4C || opByte == 0x6C
  }

  public static ops = [
    { op: "brk", ad: "",    bc: 1, fc: true }, // 00
    { op: "ora", ad: "inx", bc: 2           }, // 01
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ora", ad: "zp",  bc: 2           }, // 05
    { op: "asl", ad: "zp",  bc: 2           }, // 06
    { op: "???", ad: "",    bc: 1           },
    { op: "php", ad: "",    bc: 1           }, // 08
    { op: "ora", ad: "imm", bc: 2           }, // 09
    { op: "asl", ad: "a",   bc: 1           }, // 0A
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ora", ad: "abs", bc: 3           }, // 0D
    { op: "asl", ad: "abs", bc: 3           }, // 0E
    { op: "???", ad: "",    bc: 1           },
    { op: "bpl", ad: "rel", bc: 2, fc: true }, // 10
    { op: "ora", ad: "iny", bc: 2           }, // 11
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ora", ad: "zpx", bc: 2           }, // 15
    { op: "asl", ad: "zpx", bc: 2           }, // 16
    { op: "???", ad: "",    bc: 1           },
    { op: "clc", ad: "",    bc: 1           }, // 18
    { op: "ora", ad: "aby", bc: 3           }, // 19
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ora", ad: "abx", bc: 3           }, // 1D
    { op: "asl", ad: "abx", bc: 3           }, // 1E
    { op: "???", ad: "",    bc: 1           },
    { op: "jsr", ad: "jsr", bc: 3, fc: true }, // 20        // ad: "abs" instead?
    { op: "and", ad: "inx", bc: 2           }, // 21
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "bit", ad: "zp",  bc: 2           }, // 24
    { op: "and", ad: "zp",  bc: 2           }, // 25
    { op: "rol", ad: "zp",  bc: 2           }, // 26
    { op: "???", ad: "",    bc: 1           },
    { op: "plp", ad: "",    bc: 1           }, // 28
    { op: "and", ad: "imm", bc: 2           }, // 29
    { op: "rol", ad: "a",   bc: 1           }, // 2A
    { op: "???", ad: "",    bc: 1           },
    { op: "bit", ad: "abs", bc: 3           }, // 2C
    { op: "and", ad: "abs", bc: 3           }, // 2D
    { op: "rol", ad: "abs", bc: 3           }, // 2E
    { op: "???", ad: "",    bc: 1           },
    { op: "bmi", ad: "rel", bc: 2, fc: true }, // 30
    { op: "and", ad: "iny", bc: 2           }, // 31
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "and", ad: "zpx", bc: 2           }, // 35
    { op: "rol", ad: "zpx", bc: 2           }, // 36
    { op: "???", ad: "",    bc: 1           },
    { op: "sec", ad: "",    bc: 1           }, // 38
    { op: "and", ad: "aby", bc: 3           }, // 39
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "and", ad: "abx", bc: 3           }, // 3D
    { op: "rol", ad: "abx", bc: 3           }, // 3E
    { op: "???", ad: "",    bc: 1           },
    { op: "rti", ad: "",    bc: 1, fc: true }, // 40
    { op: "eor", ad: "inx", bc: 2           }, // 41
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "eor", ad: "zp",  bc: 2           }, // 45
    { op: "lsr", ad: "zp",  bc: 2           }, // 46
    { op: "???", ad: "",    bc: 1           },
    { op: "pha", ad: "",    bc: 1           }, // 48
    { op: "eor", ad: "imm", bc: 2           }, // 49
    { op: "lsr", ad: "a",   bc: 1           }, // 4A
    { op: "???", ad: "",    bc: 1           },
    { op: "jmp", ad: "jab", bc: 3, fc: true }, // 4C       // ad: "abs" instead?
    { op: "eor", ad: "abs", bc: 3           }, // 4D
    { op: "lsr", ad: "abs", bc: 3           }, // 4E
    { op: "???", ad: "",    bc: 1           },
    { op: "bvc", ad: "rel", bc: 2, fc: true }, // 50
    { op: "eor", ad: "iny", bc: 2           }, // 51
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "eor", ad: "zpx", bc: 2           }, // 55
    { op: "lsr", ad: "zpx", bc: 2           }, // 56
    { op: "???", ad: "",    bc: 1           },
    { op: "cli", ad: "",    bc: 1           }, // 58
    { op: "eor", ad: "aby", bc: 3           }, // 59
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "eor", ad: "abx", bc: 3           }, // 5D
    { op: "lsr", ad: "abx", bc: 3           }, // 5E
    { op: "???", ad: "",    bc: 1           },
    { op: "rts", ad: "",    bc: 1, fc: true }, // 60
    { op: "adc", ad: "inx", bc: 2           }, // 61
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "adc", ad: "zp",  bc: 2           }, // 65
    { op: "ror", ad: "zp",  bc: 2           }, // 66
    { op: "???", ad: "",    bc: 1           },
    { op: "pla", ad: "",    bc: 1           }, // 68
    { op: "adc", ad: "imm", bc: 2           }, // 69
    { op: "ror", ad: "a",   bc: 1           }, // 6A
    { op: "???", ad: "",    bc: 1           },
    { op: "jmp", ad: "jin", bc: 3, fc: true }, // 6C       // ad: "abi" instead?
    { op: "adc", ad: "abs", bc: 3           }, // 6D
    { op: "ror", ad: "abs", bc: 3           }, // 6E
    { op: "???", ad: "",    bc: 1           },
    { op: "bvs", ad: "rel", bc: 2, fc: true }, // 70
    { op: "adc", ad: "iny", bc: 2           }, // 71
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "adc", ad: "zpx", bc: 2           }, // 75
    { op: "ror", ad: "zpx", bc: 2           }, // 76
    { op: "???", ad: "",    bc: 1           },
    { op: "sei", ad: "",    bc: 1           }, // 78
    { op: "adc", ad: "aby", bc: 3           }, // 79
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "adc", ad: "abx", bc: 3           }, // 7D
    { op: "ror", ad: "abx", bc: 3           }, // 7E
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sta", ad: "inx", bc: 2           }, // 81
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sty", ad: "zp",  bc: 2           }, // 84
    { op: "sta", ad: "zp",  bc: 2           }, // 85
    { op: "stx", ad: "zp",  bc: 2           }, // 86
    { op: "???", ad: "",    bc: 1           },
    { op: "dey", ad: "",    bc: 1           }, // 88
    { op: "???", ad: "",    bc: 1           },
    { op: "txa", ad: "",    bc: 1           }, // 8A
    { op: "???", ad: "",    bc: 1           },
    { op: "sty", ad: "abs", bc: 3           }, // 8C
    { op: "sta", ad: "abs", bc: 3           }, // 8D
    { op: "stx", ad: "abs", bc: 3           }, // 8E
    { op: "???", ad: "",    bc: 1           },
    { op: "bcc", ad: "rel", bc: 2, fc: true }, // 90
    { op: "sta", ad: "iny", bc: 2           }, // 91
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sty", ad: "zpx", bc: 2           }, // 94
    { op: "sta", ad: "zpx", bc: 2           }, // 95
    { op: "stx", ad: "zpy", bc: 2           }, // 96
    { op: "???", ad: "",    bc: 1           },
    { op: "tya", ad: "",    bc: 1           }, // 98
    { op: "sta", ad: "aby", bc: 3           }, // 99
    { op: "txs", ad: "",    bc: 1           }, // 9A
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sta", ad: "abx", bc: 3           }, // 9D
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ldy", ad: "imm", bc: 2           }, // A0
    { op: "lda", ad: "inx", bc: 2           }, // A1
    { op: "ldx", ad: "imm", bc: 2           }, // A2
    { op: "???", ad: "",    bc: 1           },
    { op: "ldy", ad: "zp",  bc: 2           }, // A4
    { op: "lda", ad: "zp",  bc: 2           }, // A5
    { op: "ldx", ad: "zp",  bc: 2           }, // A6
    { op: "???", ad: "",    bc: 1           },
    { op: "tay", ad: "",    bc: 1           }, // A8
    { op: "lda", ad: "imm", bc: 2           }, // A9
    { op: "tax", ad: "",    bc: 1           }, // AA
    { op: "???", ad: "",    bc: 1           },
    { op: "ldy", ad: "abs", bc: 3           }, // AC
    { op: "lda", ad: "abs", bc: 3           }, // AD
    { op: "ldx", ad: "abs", bc: 3           }, // AE
    { op: "???", ad: "",    bc: 1           },
    { op: "bcs", ad: "rel", bc: 2, fc: true }, // B0
    { op: "lda", ad: "iny", bc: 2           }, // B1
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "ldy", ad: "zpx", bc: 2           }, // B4
    { op: "lda", ad: "zpx", bc: 2           }, // B5
    { op: "ldx", ad: "zpy", bc: 2           }, // B6
    { op: "???", ad: "",    bc: 1           },
    { op: "clv", ad: "",    bc: 1           }, // B8
    { op: "lda", ad: "aby", bc: 3           }, // B9
    { op: "tsx", ad: "",    bc: 1           }, // BA
    { op: "???", ad: "",    bc: 1           },
    { op: "ldy", ad: "abx", bc: 3           }, // BC
    { op: "lda", ad: "abx", bc: 3           }, // BD
    { op: "ldx", ad: "aby", bc: 3           }, // BE
    { op: "???", ad: "",    bc: 1           },
    { op: "cpy", ad: "imm", bc: 2           }, // C0
    { op: "cmp", ad: "inx", bc: 2           }, // C1
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "cpy", ad: "zp",  bc: 2           }, // C4
    { op: "cmp", ad: "zp",  bc: 2           }, // C5
    { op: "dec", ad: "zp",  bc: 2           }, // C6
    { op: "???", ad: "",    bc: 1           },
    { op: "iny", ad: "",    bc: 1           }, // C8
    { op: "cmp", ad: "imm", bc: 2           }, // C9
    { op: "dex", ad: "",    bc: 1           }, // CA
    { op: "???", ad: "",    bc: 1           },
    { op: "cpy", ad: "abs", bc: 3           }, // CC
    { op: "cmp", ad: "abs", bc: 3           }, // CD
    { op: "dec", ad: "abs", bc: 3           }, // CE
    { op: "???", ad: "",    bc: 1           },
    { op: "bne", ad: "rel", bc: 2, fc: true }, // D0
    { op: "cmp", ad: "iny", bc: 2           }, // D1
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "cmp", ad: "zpx", bc: 2           }, // D5
    { op: "dec", ad: "zpx", bc: 2           }, // D6
    { op: "???", ad: "",    bc: 1           },
    { op: "cld", ad: "",    bc: 1           }, // D8
    { op: "cmp", ad: "aby", bc: 3           }, // D9
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "cmp", ad: "abx", bc: 3           }, // DD
    { op: "dec", ad: "abx", bc: 3           }, // DE
    { op: "???", ad: "",    bc: 1           },
    { op: "cpx", ad: "imm", bc: 2           }, // E0
    { op: "sbc", ad: "inx", bc: 2           }, // E1
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "cpx", ad: "zp",  bc: 2           }, // E4
    { op: "sbc", ad: "zp",  bc: 2           }, // E5
    { op: "inc", ad: "zp",  bc: 2           }, // E6
    { op: "???", ad: "",    bc: 1           },
    { op: "inx", ad: "",    bc: 1           }, // E8
    { op: "sbc", ad: "imm", bc: 2           }, // E9
    { op: "nop", ad: "",    bc: 1           }, // EA
    { op: "???", ad: "",    bc: 1           },
    { op: "cpx", ad: "abs", bc: 3           }, // EC
    { op: "sbc", ad: "abs", bc: 3           }, // ED
    { op: "inc", ad: "abs", bc: 3           }, // EE
    { op: "???", ad: "",    bc: 1           },
    { op: "beq", ad: "rel", bc: 2, fc: true }, // F0
    { op: "sbc", ad: "iny", bc: 2           }, // F1
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sbc", ad: "zpx", bc: 2           }, // F5
    { op: "inc", ad: "zpx", bc: 2           }, // F6
    { op: "???", ad: "",    bc: 1           },
    { op: "sed", ad: "",    bc: 1           }, // F8
    { op: "sbc", ad: "aby", bc: 3           }, // F9
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "???", ad: "",    bc: 1           },
    { op: "sbc", ad: "abx", bc: 3           }, // FD
    { op: "inc", ad: "abx", bc: 3           }, // FE
    { op: "???", ad: "",    bc: 1           }
  ]
}

//------------------------------------------------------------------------------
