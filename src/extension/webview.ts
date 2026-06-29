
import * as base64 from 'base64-js'
import { EmulatorParams, Emulator } from "../machine/machine"
import { AppleEmulator } from "../machine/apple/apple_view"
import { AtariEmulator } from "../machine/atari/atari_view"
import { FileDiskImage, AppleMachine } from "../machine/apple/apple"
import { DisplayView } from "../display/display_view"
import { ViewApplesoft, ViewBinaryDisasm, ViewBinaryHex, ViewInteger, ViewText } from "../data_viewers"
import { IDisplay, IHostHooks, PixelData } from "../shared/types"
import { HiresInterleave, TextLoresInterleave } from "../machine/apple/formats/tables"
import { deinterleave40, deinterleave80 } from "../machine/apple/formats/text"
import { DisplayFormat } from "../display/format"
import { appleFormatMap } from "../machine/apple/apple"

// @ts-ignore
const vscode = acquireVsCodeApi()

//------------------------------------------------------------------------------

class GraphicsView implements IDisplay, IHostHooks {

  public display: DisplayView

  constructor(topDiv: HTMLDivElement, public graphicsData: Uint8Array) {
    this.display = new DisplayView(topDiv, this)
    this.display.setHostHooks(this)
    this.display.update()
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

  // IHostHooks implementation

  capturedUndo(index: number) {
    vscode.postMessage({ type: "edit", body: { index: index }})
  }

  // IMachineDisplay implementation

  public setView(view: any) {
  }

  public getFormat(formatName: string): DisplayFormat {
    return appleFormatMap.get(formatName)!
  }

  public getDisplayMode(): string {
    const size = this.graphicsData?.length ?? 0
    if (size == 0x0400) {
      return "lores"
    }
    if (size == 0x0800) {
      return "dlores"
    }
    if (size >= 0x1ff8 && size <= 0x2000) {
      return "hires"
    }
    if (size == 0x4000) {
      return "dhires"
    }
    return "unknown"
  }

  public getVisibleDisplayPage(): number {
    return 0
  }

  public getActiveDisplayPage(): number {
    return 0
  }

  public getDisplayMemory(frame: PixelData, page: number): void {
    if (this.graphicsData) {
      const size = this.graphicsData.length
      if (size == 0x0400) {                           // lores
        deinterleave40(this.graphicsData, frame, TextLoresInterleave)
      } else if (size == 0x0800) {                    // double-lores
        deinterleave80(this.graphicsData, frame, TextLoresInterleave)
      } else if (size >= 0x1ff8 && size <= 0x2000) {  // hires
        deinterleave40(this.graphicsData, frame, HiresInterleave)
      } else if (size == 0x4000) {                    // double-hires
        deinterleave80(this.graphicsData, frame, HiresInterleave)
      }
    }
  }

  // TODO: wouldn't be needed if formats did interleave
  // TODO: too much copy/paste here
  public setDisplayMemory(frame: PixelData, page: number): void {
    if (this.graphicsData) {
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
            this.emulator = new AtariEmulator(topDiv, params)
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

      case "setDiskImage": {
        if (this.emulator && body.dataString) {
          if (this.emulator.machine instanceof AppleMachine) {
            // TODO: call appleEmu and have it do most of this instead
            const dataBytes = base64.toByteArray(body.dataString)
            const onWrite = body.writeProtected ? undefined : (newDataBytes: Uint8Array) => {
              vscode.postMessage({
                type: "diskWrite",
                requestId,
                body: {
                  fullPath: body.fullPath,
                  dataString: base64.fromByteArray(newDataBytes)
                }
              })
            }
            const diskImage = new FileDiskImage(body.fullPath, dataBytes, onWrite)
            const driveIndex = body.driveIndex ?? 0
            this.emulator.machine.setDiskImage(driveIndex, diskImage)
            this.emulator.machine.displayGen.displayView.focus()
          }
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
