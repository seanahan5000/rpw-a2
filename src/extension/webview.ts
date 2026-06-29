
import * as base64 from 'base64-js'
import { EmulatorParams, Emulator } from "../machine/machine"
import { AppleEmulator } from "../machine/apple/apple_view"
import { AtariEmulator } from "../machine/atari/atari_view"
import { DisplayView } from "../display/display_view"
import { ViewApplesoft, ViewBinaryDisasm, ViewBinaryHex, ViewInteger, ViewText } from "../data_viewers"
import { IHostHooks, PixelData } from "../shared/types"
import { HiresInterleave, TextLoresInterleave } from "../machine/apple/formats/tables"
import { deinterleave40, deinterleave80 } from "../machine/apple/formats/text"
import { DisplayFormat, Bitmap } from "../display/format"
import { DoubleLoresFormat, LoresFormat } from "../machine/apple/formats/lores"
import { DoubleHiresFormat, HiresFormat } from "../machine/apple/formats/hires"

// @ts-ignore
const vscode = acquireVsCodeApi()

//------------------------------------------------------------------------------

class GraphicsView implements IHostHooks {

  private bitmap: Bitmap
  public display: DisplayView

  constructor(topDiv: HTMLDivElement, public graphicsData: Uint8Array) {
    this.bitmap = this.readFrame()
    this.display = new DisplayView(topDiv, this.bitmap.format)
    this.display.setFrame(this.bitmap, undefined, (frame: Bitmap, altFrame?: Bitmap) => {
      this.writeFrame(frame)
    })
    this.display.setHostHooks(this)
  }

  public update(body: any) {
    if (body.editType == "undo") {
      this.display.undo()
    } else if (body.editType == "redo") {
      this.display.redo()
    } else if (body.editType == "revert") {
      this.graphicsData = body.contents
      this.display.revertUndo(body.editIndex)
    }
  }

  private readFrame(): Bitmap {
    let format: DisplayFormat
    let frame: PixelData
    let bitmap: Bitmap
    const size = this.graphicsData.length
    if (size == 0x0400) {
      format = new LoresFormat()
      frame = format.createFramePixelData()
      deinterleave40(this.graphicsData, frame, TextLoresInterleave)
      bitmap = format.createFrameBitmap()
    } else if (size == 0x0800) {
      format = new DoubleLoresFormat()
      frame = format.createFramePixelData()
      deinterleave80(this.graphicsData, frame, TextLoresInterleave)
    } else if (size >= 0x1ff8 && size <= 0x2000) {
      format = new HiresFormat()
      frame = format.createFramePixelData()
      deinterleave40(this.graphicsData, frame, HiresInterleave)
    } else if (size == 0x4000) {
      format = new DoubleHiresFormat()
      frame = format.createFramePixelData()
      deinterleave80(this.graphicsData, frame, HiresInterleave)
    } else {
      throw new Error("Bad bitmap data format")
    }
    bitmap = format.createFrameBitmap()
    bitmap.decode(frame)
    return bitmap
  }

  private writeFrame(bitmap: Bitmap) {
    const frame = bitmap.encode()
    const size = this.graphicsData.length
    if (size == 0x0400) {         // lores
      let srcOffset = 0
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = TextLoresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          this.graphicsData[address + x] = frame.bytes[srcOffset + x]
        }
        srcOffset += frame.byteWidth
      }
    } else if (size == 0x0800) {  // double-lores
      let srcOffset = 0
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = TextLoresInterleave[y]
        let srcIndex = srcOffset
        for (let x = 0; x < frame.byteWidth / 2; x += 1) {
          this.graphicsData[0x0000 + address + x] = frame.bytes[srcIndex++]
          this.graphicsData[0x0400 + address + x] = frame.bytes[srcIndex++]
        }
        srcOffset += frame.byteWidth
      }
    } else if (size >= 0x1FF8 && size <= 0x2000) {    // hires
      let srcOffset = 0
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = HiresInterleave[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          this.graphicsData[address + x] = frame.bytes[srcOffset + x]
        }
        srcOffset += frame.byteWidth
      }
    } else if (size == 0x4000) {  // double-hires
      let srcOffset = 0
      for (let y = 0; y < frame.bounds.height; y += 1) {
        const address = HiresInterleave[y]
        let srcIndex = srcOffset
        for (let x = 0; x < frame.byteWidth / 2; x += 1) {
          this.graphicsData[0x0000 + address + x] = frame.bytes[srcIndex++]
          this.graphicsData[0x2000 + address + x] = frame.bytes[srcIndex++]
        }
        srcOffset += frame.byteWidth
      }
    }
  }

  // IHostHooks implementation

  capturedUndo(index: number) {
    vscode.postMessage({ type: "edit", body: { index: index }})
  }
}

//------------------------------------------------------------------------------

class Webview {

  private emulator?: Emulator
  private graphicsView?: GraphicsView

  constructor(private state?: any) {
    window.addEventListener("message", async e => {
      this.handleMessage(e)
    })
  }

  async handleMessage(e: MessageEvent) {
    const { type, body, requestId } = e.data

    switch (type) {

      // test for problem where Chromium sometimes throttles timers
      case "ping": {
        const startTime = Date.now()
        setTimeout(() => {
          const delay = Date.now() - startTime
          vscode.postMessage({ type: "ping", delay })
        }, 1)
        break
      }

      case "init": {
        const topDiv = <HTMLDivElement>document.querySelector("#top-div")
        if (body.type == "emu") {
          const params: EmulatorParams = {
            debugPort: body.debugPort ?? 6502,
            stopOnEntry: body.stopOnEntry ?? false,
            saveState: this.state
          }
          if (body.machine == "7800") {
            this.emulator = new AtariEmulator(topDiv, params, (type: string) => {
              if (type == "cart") {
                vscode.postMessage({ type: "driveClick", driveIndex: -1 })
              }
            })
          } else {
            params.variant = body.machine ?? "iie"
            this.emulator = new AppleEmulator(topDiv, params, (type: string) => {
              if (type == "drive0") {
                vscode.postMessage({ type: "driveClick", driveIndex: 0 })
              } else if (type == "drive1") {
                vscode.postMessage({ type: "driveClick", driveIndex: 1 })
              } else if (type == "paint") {
                // TODO: capture the data here? in AppleView?
                vscode.postMessage({ type: "snapshot" })
              }
            })
          }
        } else {
          const dataBlob = new Blob([ body.value ])
          const dataArray = await dataBlob.arrayBuffer()
          const dataBytes = new Uint8Array(dataArray)

          if (body.type == "PIC") {
            // TODO: remember size of original incoming data?
            // TODO: what about extra data? read-only?
            // TODO: support new/untitled document?
            // TODO: look at body.editable flag
            this.graphicsView = new GraphicsView(topDiv, dataBytes)
          } else if (body.type == "BAS") {
            topDiv.innerHTML = ViewApplesoft.asText(dataBytes, true)
          } else if (body.type == "INT") {
            topDiv.innerHTML = ViewInteger.asText(dataBytes, true)
          } else if (body.type == "TXT") {
            topDiv.innerHTML = ViewText.asText(dataBytes, false, true)
          } else if (body.type == "LST") {
            topDiv.innerHTML = ViewBinaryDisasm.asText(dataBytes, body.auxType, 0, true)
          } else { // if (body.type == "BIN")
            topDiv.innerHTML = ViewBinaryHex.asText(dataBytes, body.auxType, true)
          }
        }
        break
      }

      case "saveState": {
        if (this.emulator) {
          const saveState = this.emulator.machine.getState()
          await this.emulator.machine.flattenState(saveState)
          vscode.setState(saveState)
        }
        break
      }

      case "update": {
        if (this.graphicsView) {
          this.graphicsView.update(body)
        }
        break
      }

      case "getFileData": {
        if (this.graphicsView) {
          vscode.postMessage({ type: "response", requestId, body: Array.from(this.graphicsView.graphicsData) })
        }
        break
      }

      case "setDataImage": {
        if (this.emulator && body.dataString && body.fullPath) {
          const dataBytes = base64.toByteArray(body.dataString)
          const driveIndex = body.driveIndex ?? 0
          const isWriteProtected = body.writeProtected ?? true
          const onWrite = isWriteProtected ? undefined : (newDataBytes: Uint8Array) => {
            vscode.postMessage({
              type: "dataWrite",
              requestId,
              body: {
                fullPath: body.fullPath,
                dataString: base64.fromByteArray(newDataBytes)
              }
            })
          }

          this.emulator.machine.setDiskCartImage(body.fullPath, dataBytes, driveIndex, onWrite)

          // *** repair this ***
          // this.emulator.machine.displayView.focus()
        }
        break
      }
    }
  }
}

//------------------------------------------------------------------------------

const state = vscode.getState()
vscode.setState(undefined)
const webview = new Webview(state)
vscode.postMessage({ type: "ready" })
