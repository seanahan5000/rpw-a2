
import { DisplayView } from "../display/display_view"
import { ViewApplesoft, ViewBinaryDisasm, ViewBinaryHex, ViewInteger, ViewText } from "../data_viewers"
import { IMachineDisplay, IHostHooks, PixelData } from "../shared"
import { HiresInterleave, TextLoresInterleave } from "../display/tables"
import { deinterleave40, deinterleave80 } from "../display/text"

// @ts-ignore
const vscode = acquireVsCodeApi()

class Webview implements IMachineDisplay, IHostHooks {

  private graphicsData?: Uint8Array
  private displayView?: DisplayView

  constructor() {
    window.addEventListener("message", async e => { this.handleMessage(e) })
  }

  async handleMessage(e: MessageEvent) {
    const { type, body, requestId } = e.data
    switch (type) {

      case "init": {
        const dataBlob = new Blob([ body.value ])
        const dataArray = await dataBlob.arrayBuffer()
        const dataBytes = new Uint8Array(dataArray)

        const topDiv = <HTMLDivElement>document.querySelector("#top-div")
        if (body.type == "PIC") {
          // TODO: remember size of original incoming data?
          // TODO: what about extra data? read-only?
          // TODO: support new/untitled document?
          this.graphicsData = dataBytes
          this.displayView = new DisplayView(topDiv, this)
          this.displayView.setHostHooks(this)
          this.displayView.update(false)
          //*** look at body.editable flag ***
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
        break
      }

      case "update": {
        if (body.editType == "undo") {
          this.displayView?.undo()
        } else if (body.editType == "redo") {
          this.displayView?.redo()
        } else if (body.editType == "revert") {
          this.graphicsData = body.contents
          this.displayView?.revertUndo(body.editIndex)
        }
        break
      }

      case "getFileData": {
        if (this.displayView && this.graphicsData) {
          vscode.postMessage({ type: "response", requestId, body: Array.from(this.graphicsData) })
        }
        break
      }
    }
  }

  // IHostHooks implementation

  capturedUndo(index: number) {
    vscode.postMessage({ type: "edit", body: { index: index }})
  }

  // IMachineDisplay implementation

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

  getVisibleDisplayPage(): number {
    return 0
  }

  getActiveDisplayPage(): number {
    return 0
  }

  // IMachineDisplay

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
      if (this.graphicsData.length == 0x0400) {         // lores
        let srcOffset = 0
        for (let y = 0; y < frame.bounds.height; y += 1) {
          const address = TextLoresInterleave[y]
          for (let x = 0; x < frame.byteWidth; x += 1) {
            this.graphicsData[address + x] = frame.bytes[srcOffset + x]
          }
          srcOffset += frame.byteWidth
        }
      } else if (this.graphicsData.length == 0x0800) {  // double-lores
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
      } else if (this.graphicsData.length == 0x2000) {  // hires
        let srcOffset = 0
        for (let y = 0; y < frame.bounds.height; y += 1) {
          const address = HiresInterleave[y]
          for (let x = 0; x < frame.byteWidth; x += 1) {
            this.graphicsData[address + x] = frame.bytes[srcOffset + x]
          }
          srcOffset += frame.byteWidth
        }
      } else if (this.graphicsData.length == 0x4000) {  // double-hires
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

const webview = new Webview()
vscode.postMessage({ type: "ready" })
