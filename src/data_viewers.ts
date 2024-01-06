
import { Isa6502 } from "./isa6502"
import { HiresTable } from "./shared"
import { HiresDisplay } from "./display"

// TODO: open viewer with a common interface from a name string? Get rid of exports?

//------------------------------------------------------------------------------

export class ViewApplesoft {

  static readonly tokens: string[] = [
    "END",   "FOR",    "NEXT",    "DATA",   "INPUT",   "DEL",    "DIM",     "READ",
    "GR",    "TEXT",   "PR#",     "IN#",    "CALL",    "PLOT",   "HLIN",    "VLIN",
    "HGR2",  "HGR",    "HCOLOR=", "HPLOT",  "DRAW",    "XDRAW",  "HTAB",    "HOME",
    "ROT=",  "SCALE=", "SHLOAD",  "TRACE",  "NOTRACE", "NORMAL", "INVERSE", "FLASH",
    "COLOR=","POP",    "VTAB",    "HIMEM:", "LOMEM:",  "ONERR",  "RESUME",  "RECALL",
    "STORE", "SPEED=", "LET",     "GOTO",   "RUN",     "IF",     "RESTORE", "&",
    "GOSUB", "RETURN", "REM",     "STOP",   "ON",      "WAIT",   "LOAD",    "SAVE",
    "DEF",   "POKE",   "PRINT",   "CONT",   "LIST",    "CLEAR",  "GET",     "NEW",
    "TAB(",  "TO",     "FN",      "SPC(",   "THEN",    "AT",     "NOT",     "STEP",
    "+",     "-",      "*",       "/",      "^",       "AND",    "OR",      ">",
    "=",     "<",      "SGN",     "INT",    "ABS",     "USR",    "FRE",     "SCRN(",
    "PDL",   "POS",    "SQR",     "RND",    "LOG",     "EXP",    "COS",     "SIN",
    "TAN",   "ATN",    "PEEK",    "LEN",    "STR$",    "VAL",    "ASC",     "CHR$",
    "LEFT$", "RIGHT$", "MID$",    "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",
    "ERROR", "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",
    "ERROR", "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR",  "ERROR",   "ERROR"
  ]

  static asHtml(data: Uint8Array): string {
    let offset = 0
    let out = ""

    while (offset < data.length) {
      let nextAddress = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2
      // NOTE: this allows basic code to hide code/data at the end of the file
      if (nextAddress == 0) {
        let extra = data.length - offset
        if (extra > 1) {
          out += "<br>"
          out += ViewBinaryDisasm.asHtml(data, 0x801, offset)
        }
        break
      }

      let lineNumber = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2
      if (offset >= data.length) {
        break
      }

      out += `<span class="as-linenum">${lineNumber.toString()} </span>`

      let inString = false
      let inComment = false
      while (true) {
        let byte = data[offset]
        offset += 1
        if (byte == 0) {
          break
        }
        if (byte & 0x80) {
          let s = this.tokens[byte & 0x7f]
          if (s == "REM") {
            out += '<span class="as-comment"> REM '
            inComment = true
          } else if (s.length > 1) {
            out += `<span class="as-token"> ${s} </span>`
          } else {
            out += ` ${s} `
          }
        } else {
          let s = String.fromCharCode(byte)
          if (s == ":") {
            s = `<span class="as-colon">:</span>`
          } else if (s == '"') {
            if (inString) {
              s = '"</span>'
              inString = false
            } else {
              inString = true
              s = '<span class="as-string">"'
            }
          } else if (s == " ") {
            s = "\xa0"
          }
          out += s
        }
      }
      if (inComment) {
        out += "</span>"
      }
      out += "<br>"
    }

    return out
  }
}

//------------------------------------------------------------------------------

export class ViewLisa2 {

  static readonly tokens: string[] = [
    "BGE", "BLT", "BMI", "BCC", "BCS", "BPL", "BNE", "BEQ",
    "BVS", "BVC", "BSB", "BNM", "BM1", "BNZ", "BIZ", "BIM",
    "BIP", "BIC", "BNC", "BRA", "BTR", "BFL", "BRK", "BKS",
    "CLV", "CLC", "CLD", "CLI", "DEX", "DEY", "INX", "INY",
    "NOP", "PHA", "PLA", "PHP", "PLP", "RTS", "RTI", "RSB",
    "RTN", "SEC", "SEI", "SED", "TAX", "TAY", "TSX", "TXA",
    "TXS", "TYA", "ADD", "CPR", "DCR", "INR", "SUB", "LDD",
    "POP", "PPD", "STD", "STP", "LDR", "STO", "SET", "???",
    "ADC", "AND", "ORA", "BIT", "CMP", "CPX", "CPY", "DEC",
    "EOR", "INC", "JMP", "JSR", "???", "LDA", "LDX", "LDY",
    "STA", "STX", "STY", "XOR", "LSR", "ROR", "ROL", "ASL",
    "ADR", "EQU", "ORG", "OBJ", "EPZ", "STR", "DCM", "ASC",
    "ICL", "END", "LST", "NLS", "HEX", "BYT", "HBY", "PAU",
    "DFS", "DCI", "...", "PAG", "INV", "BLK", "DBY", "TTL",
    "SBC", "???", "LET", ".IF", ".EL", ".FI", "=  ", "PHS",
    "DPH", ".DA", "GEN", "NOG", "USR", "???", "???", "???"
  ]

  static asHtml(data: Uint8Array): string {
    let offset = 0
    let out = ""

    // let version = data[offset] + (data[offset + 1] << 8)
    // offset += 2

    // let length = data[offset] + (data[offset + 1] << 8)
    // offset += 2

    while (offset < data.length) {
      let lineLength = data[offset]
      offset += 1

      if (lineLength == 0 || lineLength == 0xff) {
        break
      }

      let line = ""
      let byte = data[offset]
      while (byte < 0x80) {
        offset += 1
        if (byte == 0x0d) {
          break
        }
        line += String.fromCharCode(byte)
        byte = data[offset]
      }
      line = line.padEnd(8, " ")

      if (byte != 0x0d) {
        let count = 0
        while (count++ < lineLength) {
          byte = data[offset++]
          if (byte == 0x0d) {
            break
          }
          if (byte >= 0x80) {
            line += this.tokens[byte & 0x7f]
          } else if (byte < 0x20) {
            line += " "
          } else {
            line += String.fromCharCode(byte)
          }
        }
      }
      line = line.trimEnd()
      line = line.replace(/ /g, "\xa0")
      out += line
      out += "<br>"
    }

    return out
  }
}

//------------------------------------------------------------------------------

export class ViewInteger {

  static readonly tokens: string[] = [
    "HIMEM:", "<EOL>",  "_",       ":",      "LOAD",  "SAVE",  "CON",    "RUN",
    "RUN",    "DEL",   ", ",       "NEW",    "CLR",   "AUTO",  ",",      "MAN",
    "HIMEM:", "LOMEM:", "+",       "-",      "*",     "/",     "=",      "#",
    ">=",     ">",      "<=",      "<>",     "<",     "AND",   "OR",     "MOD",
    "^",      "+",      "(",       ",",      "THEN",  "THEN",  ",",      ",",
    "\"",     "\"",     "(",       "!",      "!",     "(",     "PEEK",   "RND",
    "SGN",    "ABS",    "PDL",     "RNDX",   "(",     "+",     "-",      "NOT",
    "(",      "=",      "#",       "LEN(",   "ASC(",  "SCRN(", ",",      "(",
    "$",      "$",      "(",       ",",      ",",     ";",     ";",      ";",
    ",",      ",",      ",",       "TEXT",   "GR",    "CALL",  "DIM",    "DIM",
    "TAB",    "END",    "INPUT",   "INPUT",  "INPUT", "FOR",   "=",      "TO",
    "STEP",   "NEXT",   ",",       "RETURN", "GOSUB", "REM",   "LET",    "GOTO",
    "IF",     "PRINT",  "PRINT",   "PRINT",  "POKE",  ",",     "COLOR=", "PLOT",
    ",",      "HLIN",   ",",       "AT",     "VLIN",  ",",     "AT",     "VTAB",
    "=",      "=",      ")",       ")",      "LIST",  ",",     "LIST",   "POP",
    "NODSP",  "NODSP",  "NOTRACE", "DSP",    "DSP",   "TRACE", "PR#",    "IN#"
  ]

  static asHtml(data: Uint8Array): string {
    let offset = 0
    let out = ""

    while (offset < data.length) {

      let lineLength = data[offset]
      offset += 1

      let lineNumber = data[offset + 0] + (data[offset + 1] << 8)
      offset += 2

      out += `<span class="as-linenum">${lineNumber.toString().padStart(5, "\xa0")}</span>`

      let wasToken = true
      while (true) {
        let byte = data[offset]
        if (byte == 0x01) {
          offset += 1
          out += "<br>"
          break
        }

        let isToken = (byte < 0x80) && (this.tokens[byte].length > 1)
        if (wasToken && !isToken) {
          out += " "
        }
        wasToken = isToken

        if (byte == 0x28) {  // opening quote token
          out += '<span class="as-string">"'
          offset += 1
          while (offset < data.length) {
            byte = data[offset]
            offset += 1
            if (byte == 0x29) {  // closing quote token
              break
            }
            // TODO: filter out control characters?
            out += String.fromCharCode(byte & 0x7f)
          }
          out += '"</span>'
        } else if (byte == 0x5d) {
          offset += 1
          out += '<span class="as-comment"> REM '
          while (offset < data.length) {
            byte = data[offset]
            if (byte == 0x01) {  // end of line
              break
            }
            offset += 1
            let s = String.fromCharCode(byte & 0x7f)
            if (s == " ") {
              s = "\xa0"
            }
            out += s
          }
          out += '"</span>'
        } else if (byte >= 0xb0 && byte <= 0xb9) {
          offset += 1
          let value = data[offset + 0] + (data[offset + 1] << 8)
          offset += 2
          out += value.toString()
        } else if (byte >= 0xc1 && byte <= 0xda) {
          offset += 1
          out += String.fromCharCode(byte & 0x7f)
          while (offset < data.length) {
            byte = data[offset]
            if ((byte >= 0xc1 && byte <= 0xda) || (byte >= 0xb0 && byte <= 0xb9)) {
              offset += 1
              out += String.fromCharCode(byte & 0x7f)
            } else {
              break
            }
          }
        } else if (byte < 0x80) {
          offset += 1
          if (byte == 0x03) {
            out += `<span class="as-colon">:</span>`
          } else {
            let token = this.tokens[byte]
            if (token.length > 1) {
              out += " "
            }
            out += `<span class="as-token">${token}</span>`
          }
        } else {
          console.log("Unkown token 0x" + byte.toString(16))
          offset += 1
          out += String.fromCharCode(byte & 0x7f)
        }
      }
    }

    return out
  }
}

//------------------------------------------------------------------------------

export class ViewText {
  static asHtml(data: Uint8Array, padSource: boolean): string {
    let out = ""
    let line = ""
    const tabStops = [16, 20, 40]
    for (let i = 0; i < data.length; i += 1) {
      if ((data[i] & 0x7f) == 0x0d) {
        if (padSource) {
          let paddedLine = ""
          if (line != "") {
            if (line[0] == "*") {
              paddedLine = line
            } else {
              let columnIndex = 0
              while (line != "") {
                if (line[0] == ";") {
                  paddedLine = paddedLine.padEnd(tabStops[2], "\xa0")
                  paddedLine += line
                  break
                }
                let pos = line.indexOf(" ")
                if (pos == -1) {
                  paddedLine += line
                  break
                }
                if (pos > 0) {
                  paddedLine += line.substring(0, pos)
                }
                line = line.substring(pos + 1)
                if (paddedLine.length < tabStops[columnIndex] - 1) {
                  paddedLine = paddedLine.padEnd(tabStops[columnIndex] - 1, "\xa0")
                }
                paddedLine += "\xa0"
                columnIndex += 1
                if (columnIndex == tabStops.length) {
                  paddedLine += line
                  break
                }
              }
            }
            line = paddedLine
          }
        }
        out += line
        line = ""
        out += "<br>"
      } else {
        let char = String.fromCharCode(data[i] & 0x7f)
        if (char == "<") {
          char = "&lt;"
        } else if (char == ">") {
          char = "&gt;"
        }
        line += char
      }
    }
    if (line != "") {
      out += line
      out += "<br>"
    }
    return out
  }
}

//------------------------------------------------------------------------------

export class ViewBinaryHex {
  static asHtml(data: Uint8Array, address: number): string {
    let out = ""
    let line = ""
    let offset = 0
    let startOffset = 0
    while (offset < data.length) {
      if (line == "") {
        line = `<span class="bin-addr">${(address + offset).toString(16).toUpperCase().padStart(4, "0")}:</span>`
      }
      line += " " + data[offset].toString(16).toUpperCase().padStart(2, "0")
      offset += 1
      if ((offset & 0xf) == 0) {
        if (line != "") {
          //*** pad partial line ***
          let asciiStr = ""
          for (let i = startOffset; i < offset; i += 1) {
            let byte = data[i]
            if (byte >= 0x00 && byte <= 0x1f) {
              byte ^= 0x40
            } else if (byte >= 0xc0 && byte <= 0xdf) {
              byte ^= 0xa0
            } else if (byte >= 0xe0 && byte <= 0xff) {
              byte ^= 0xc0
            }

            let char = String.fromCharCode(byte & 0x7f)
            if (char == "<") {
              char = "&lt;"
            } else if (char == ">") {
              char = "&gt;"
            }
            asciiStr += char
          }
          startOffset = offset
          out += `${line}\xa0\xa0\xa0\xa0${asciiStr}<br>`
          line = ""
        }
      }
    }
    if (line != "") {
      out += line + "<br>"
    }
    return out
  }
}


export class ViewBinaryDisasm {
  static asHtml(data: Uint8Array, address: number, startOffset = 0): string {
    let out = ""
    let offset = startOffset
    while (offset < data.length) {
      out += `<span class="bin-addr">${(address + offset).toString(16).toUpperCase().padStart(4, "0")}:</span>`
      let opByte = data[offset]
      let opLength = Isa6502.ops[opByte].bc
      let opcode: string
      let opArgs: string

      if (offset + opLength <= data.length) {
        opcode = Isa6502.ops[opByte].op.toUpperCase()
        opArgs = Isa6502.DisassembleArgs(data, offset, address + offset).toUpperCase()
      } else {
        opLength = 1
        opcode = "???"
        opArgs = ""
      }

      out += "\xa0"
      for (let i = 0; i < 3; i += 1) {
        if (i < opLength) {
          let value = data[offset + i]
          out += "\xa0"
          out += value.toString(16).padStart(2, "0").toUpperCase()
        } else {
          out += "\xa0\xa0\xa0"
        }
      }

      out += `\xa0\xa0\xa0\xa0${opcode}\xa0\xa0\xa0${opArgs}<br>`
      offset += opLength
    }
    return out
  }
}


export class ViewBinaryHires {
  static asCanvas(data: Uint8Array): HTMLCanvasElement {
    let canvas = <HTMLCanvasElement>document.createElement("canvas")
    canvas.width = 560
    canvas.height = 384
    let display = new HiresDisplay(canvas)
    display.setFrameMemory(data)
    return canvas
  }
}


export class ViewBinaryNajaPackedHires {

  static asCanvas(packedData: Uint8Array): HTMLCanvasElement | undefined {
    let hiresData = ViewBinaryNajaPackedHires.asHiresData(packedData)
    if (hiresData) {
      return ViewBinaryHires.asCanvas(hiresData)
    }
  }

  static asHiresData(packedData: Uint8Array): Uint8Array | undefined {
    if (packedData.length < 4) {
      return
    }
    let top = packedData[0]
    let bottom = packedData[1]
    let left = packedData[2]
    let right = packedData[3]
    if (top > bottom || left > right) {
      return
    }

    let hiresData = new Uint8Array(0x2000)
    hiresData.fill(0)

    let x = right
    let count = 0
    let value = 0
    let offset = 4
    while (x >= left) {
      let y = bottom
      while (y >= top) {
        if (count == 0) {
          if (offset == packedData.length) {
            return
          }
          value = packedData[offset]
          offset += 1
          if (value == 0xFE) {
            if (offset + 2 > packedData.length) {
              return
            }
            count = packedData[offset + 0]
            value = packedData[offset + 1]
            offset += 2
          } else {
            count = 1
          }
        }
        hiresData[HiresTable[y] + x] = value
        count -= 1
        y -= 1
      }
      x -= 1
    }

    return hiresData
  }
}

//------------------------------------------------------------------------------
