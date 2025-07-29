import * as base64 from 'base64-js'
import { IMachine } from "../shared/types"
import { StackEntry, StackRegister, BreakpointEntry } from "../shared/types"
import { OpMode } from "./isa65xx"

// TODO: clean these up (setting disk images)
import { Machine, FileDiskImage } from "./machine"

//------------------------------------------------------------------------------

// NOTE: duplicated in lsp_debugger.ts

const ProtocolVersion = 1

type RequestHeader = {
  command: string
  id?: number
}

type AcknowledgeResponse = RequestHeader & {
  error?: string
}

type LaunchRequest = RequestHeader & {
  version: number
  stopOnEntry: boolean
}

type AttachRequest = RequestHeader & {
  version: number
  stopOnEntry: boolean
}

type SetBreakpointsRequest = RequestHeader & {
  entries: BreakpointEntry[]
}

type StackResponse = RequestHeader & {
  entries: StackEntry[]
}

type StopNotification = RequestHeader & {
  reason: string
  pc: number
  dataAddress?: number
  dataString?: string
}

type SetRegisterRequest = RequestHeader & StackRegister

type ReadOpMemoryRequest = RequestHeader & {
  opBytes: number[]     // instruction bytes, to determine addressing mode
  typeSize?: number     // number of bytes to read beyond index
}

type ReadOpMemoryResponse = RequestHeader & {
  dataAddress: number   // effective read address (baseAddress if indexAddress present)
  indexAddress?: number // read address including index register
  dataString: string    // actual data read in base64
}

type ReadMemoryRequest = RequestHeader & {
  dataAddress: number   // direct read address, ignoring opMode, opBytes
  readOffset?: number   // offset applied after final address is computed
  readLength?: number   // number of bytes to read (default 1)
}

type ReadMemoryResponse = RequestHeader & {
  dataAddress: number   // effective read address
  dataLength: number    // number of bytes actually read
  dataString: string    // actual data read in base64, possibly < readLength
}

type WriteMemoryRequest = RequestHeader & {
  dataAddress: number     // direct write address
  dataBank?: number       // optional bank 0, 1, or 2
  dataString: string      // bytes to write in base64
  partialAllowed: boolean // can write just some of the bytes
}

type WriteMemoryResponse = RequestHeader & {
  bytesWritten: number  // bytes successfully written
}

type WriteRamRequest = RequestHeader & {
  dataAddress: number     // direct write address
  dataString: string      // bytes to write in base64
}

type SetDiskImageRequest = RequestHeader & {
  fullPath?: string     // no path means set drive as empty
  dataString: string    // disk contents in base64
  driveIndex: number
  writeProtected: boolean
}

//------------------------------------------------------------------------------

export class SocketDebugger {

  // number of bytes around PC to return along with cpuStopped and getStack
  private dataRangeSize = 64

  private socket?: WebSocket
  protected machine!: IMachine

  constructor(port?: number) {
    this.startSocket(port)
  }

  public setMachine(machine: IMachine) {
    this.machine = machine
    this.machine.clock.on("start", () => { this.onStart() })
    this.machine.clock.on("stop", (reason: string) => { this.onStop(reason) })
  }

  private startSocket(port: number = 6502) {
    this.socket = new WebSocket(`ws://localhost:${port}`)

    this.socket.onopen = (e: Event) => {
    }

    this.socket.onmessage = (e: MessageEvent) => {
      const request = <RequestHeader>JSON.parse(e.data.toString())
      this.onRequest(request)
    }

    this.socket.onclose = (e: CloseEvent) => {
      this.startSocket()
    }

    this.socket.onerror = (e: Event) => {
      const socket = this.socket
      this.socket = undefined
      socket!.close()
    }
  }

  private onRequest(request: RequestHeader) {

    if (!this.machine) {
      return
    }

    switch (request.command) {

      case "hardReset":
        this.machine.reset(true)
        this.sendAcknowledge(request)
        break

      case "launch": {
        const req = <LaunchRequest>request
        let error: string | undefined
        if (req.version == ProtocolVersion) {
          this.machine.update(0, true)
          if (req.stopOnEntry) {
            this.machine.clock.stop("launch")
          } else {
            this.machine.clock.start()
          }
        } else {
          error = `Unexpected protocol version ${req.version}. Update RPW extensions.`
        }
        this.sendAcknowledge(request, error)
        break
      }

      case "attach": {
        const req = <AttachRequest>request
        let error: string | undefined
        if (req.version == ProtocolVersion) {
          if (req.stopOnEntry || !this.machine.clock.isRunning) {
            this.machine.clock.stop("attach")
          }
        } else {
          error = `Unexpected protocol version ${req.version}. Update RPW extensions.`
        }
        this.sendAcknowledge(request, error)
        break
      }

      case "disconnect":
        this.machine.clock.stop("disconnect")
        break

      case "startCpu":
        this.machine.clock.start()
        break
      case "stopCpu":
        this.machine.clock.stop("requested")
        break
      case "stepCpuInto":
        this.machine.clock.stepInto()
        break
      case "stepCpuOver":
        this.machine.clock.stepOver()
        break
      case "stepCpuOutOf":
        this.machine.clock.stepOutOf()
        break
      case "stepCpuForward":
        this.machine.clock.stepForward()
        break

      case "setBreakpoints": {
        const req = <SetBreakpointsRequest>request
        this.machine.clock.setBreakpoints(req.entries)
        this.sendAcknowledge(request)
        break
      }

      case "getStack": {
        const response = this.onGetStack(request)
        this.sendResponse(request, response)
        break
      }

      case "setRegister": {
        const req = <SetRegisterRequest>request
        this.machine.cpu.setRegister(req)
        if (this.machine.clock.isRunning) {
          if (req.name == "PC") {
            this.onStop("requested")
          }
        }
        this.sendAcknowledge(request)
        break
      }

      case "readOpMemory": {
        const response = this.onReadOpMemory(<ReadOpMemoryRequest>request)
        this.sendResponse(request, response)
        break
      }

      case "readMemory": {
        const response = this.onReadMemory(<ReadMemoryRequest>request)
        this.sendResponse(request, response)
        break
      }

      case "writeMemory": {
        const response = this.onWriteMemory(<WriteMemoryRequest>request)
        this.sendResponse(request, response)
        break
      }

      case "writeRam": {
        this.onWriteRam(<WriteRamRequest>request)
        this.sendAcknowledge(request)
        break
      }

      case "setDiskImage": {
        this.onSetDiskImage(<SetDiskImageRequest>request)
        this.sendAcknowledge(request)
        break
      }

      default: {
        this.sendAcknowledge(request, "Unsupported request")
        break
      }

      // TODO: other message commands
      // "readRegisters"
      // "writeRegisters"
    }
  }

  private sendResponse(request: RequestHeader, response: RequestHeader) {
    if (this.socket && this.socket.readyState == WebSocket.OPEN) {
      response.id = request.id
      this.socket.send(JSON.stringify(response))
    }
  }

  // send back generic response
  private sendAcknowledge(request: RequestHeader, error?: string) {
    if (this.socket && this.socket.readyState == WebSocket.OPEN) {
      const response: AcknowledgeResponse = {
        command: request.command,
        error
      }
      this.sendResponse(request, response)
    }
  }

  protected onStart(): void {
    if (this.socket && this.socket.readyState == WebSocket.OPEN) {
      this.socket.send('{"command":"cpuStarted"}')
    }
  }

  protected onStop(stopReason: string): void {
    if (this.socket && this.socket.readyState == WebSocket.OPEN) {
      const response: StopNotification = {
        command: "cpuStopped",
        reason: stopReason,
        pc: this.machine.cpu.getPC()
      }
      this.applyData(response, response.pc - this.dataRangeSize / 2, this.dataRangeSize)
      this.socket.send(JSON.stringify(response))
    }
  }

  private onGetStack(request: RequestHeader): StackResponse {
    // capture current data around PC for each stack frame
    // TODO: should this be at the time of call instead of current?
    const entries = this.machine.cpu.getCallStack()
    for (let entry of entries) {
      const pc = entry.regs[0].value
      this.applyData(entry, pc - this.dataRangeSize / 2, this.dataRangeSize)
    }
    const response: StackResponse = {
      command: request.command,
      entries: entries
    }
    return response
  }

  private applyData(entry: StackEntry | StopNotification, address: number, rangeSize: number) {
    const byteData = new Uint8Array(rangeSize)
    for (let i = 0; i < byteData.length; i += 1) {
      byteData[i] = this.machine.memory.readConst(address + i)
    }
    entry.dataString = base64.fromByteArray(byteData)
    entry.dataAddress = address
  }

  private onReadOpMemory(request: ReadOpMemoryRequest): ReadOpMemoryResponse {
    const opInfo = this.machine.cpu.computeAddress(request.opBytes, false)
    let dataAddress = opInfo.address
    let indexAddress: number | undefined
    let dataLength = request.typeSize ?? 1

    // don't return bytes for jmp/jsr/bcc or immediate ops
    if (opInfo.opcode.fc || opInfo.opcode.mode == OpMode.IMM) {
      dataLength = 0
    } else {
      const indexOffset = this.machine.cpu.getRegIndex(request.opBytes[0])
      if (indexOffset != undefined) {
        indexAddress = dataAddress + indexOffset
        dataLength = ((indexOffset + (request.typeSize ?? 1) + 15) >> 4) << 4
      }
    }

    const dataBytes = new Uint8Array(dataLength)
    for (let i = 0; i < dataLength; i += 1) {
      dataBytes[i] = this.machine.memory.readConst(dataAddress + i)
    }

    const response: ReadOpMemoryResponse = {
      command: request.command,
      indexAddress,
      dataAddress,
      dataString: base64.fromByteArray(dataBytes)
    }
    return response
  }

  // TODO: eventually need to figure out multiple banks
  //  (maybe look for 24-bit addresses?)
  private onReadMemory(request: ReadMemoryRequest): ReadMemoryResponse {
    let dataAddress = request.dataAddress
    let dataLength = request.readLength ?? 1

    // this extra offset is just to support the VS code API
    dataAddress += request.readOffset ?? 0

    // NOTE: For now, allow soft switch area reads but
    //  don't allow reading past end of 64K.
    if (dataAddress + dataLength >= 0x10000) {
      dataLength = 0x10000 - dataAddress
    }

    const dataBytes = new Uint8Array(dataLength)
    for (let i = 0; i < dataLength; i += 1) {
      dataBytes[i] = this.machine.memory.readConst(dataAddress + i)
    }

    const response: ReadMemoryResponse = {
      command: request.command,
      dataAddress,
      dataLength,
      dataString: base64.fromByteArray(dataBytes)
    }
    return response
  }

  // TODO: eventually need to figure out multiple banks
  //  (maybe look for 24-bit addresses?)
  private onWriteMemory(request: WriteMemoryRequest): WriteMemoryResponse {
    const data = base64.toByteArray(request.dataString)
    const address = request.dataAddress
    let length = data.length

    // don't allow writing to any potential soft switches
    // *** what if it starts inside soft switches? ***
    if (address < 0xC000 && address + length > 0xC000) {
      if (request.partialAllowed) {
        length = 0xC000 - address
      } else {
        length = 0
      }
    }
    const cycleCount = this.machine.cpu.getCycles()
    for (let i = 0; i < length; i += 1) {
      this.machine.memory.write(address + i, data[i], cycleCount)
    }

    // *** return offset to start of write, if partial ***

    const response: WriteMemoryResponse = {
      command: request.command,
      bytesWritten: length
    }
    return response
  }

  private onWriteRam(request: WriteRamRequest): void {
    const data = base64.toByteArray(request.dataString)
    this.machine.memory.writeRam(request.dataAddress, data)
  }

  private onSetDiskImage(request: SetDiskImageRequest): void {
    let diskImage: FileDiskImage | undefined

    if (request.fullPath) {
      diskImage = new FileDiskImage(
        request.fullPath,
        base64.toByteArray(request.dataString),
        request.writeProtected)
    }

    // TODO: add to interface? find device?
    const machine = <Machine>this.machine
    machine.setDiskImage(request.driveIndex, diskImage)
  }
}

//------------------------------------------------------------------------------
