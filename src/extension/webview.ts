
import { DisplayView } from "../display_view"
import { ViewApplesoft, ViewBinaryDisasm, ViewBinaryHex, ViewInteger, ViewText } from "../data_viewers"
import { HiresFrame, HiresTable, IMachineDisplay, IUndoHooks } from "../shared"

// @ts-ignore
const vscode = acquireVsCodeApi()

class Webview implements IMachineDisplay, IUndoHooks {

  // in hires display order, 0x1FF8 to 0x2000 in size
  private frameData?: Uint8Array
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
          this.frameData = dataBytes
          this.displayView = new DisplayView(topDiv, this, this)
          this.displayView.update(false)
          //*** look at body.editable flag ***
        } else if (body.type == "BAS") {
          topDiv.innerHTML = ViewApplesoft.asHtml(dataBytes)
        } else if (body.type == "INT") {
          topDiv.innerHTML = ViewInteger.asHtml(dataBytes)
        } else if (body.type == "TXT") {
          topDiv.innerHTML = ViewText.asHtml(dataBytes, false)
        } else if (body.type == "LST") {
          topDiv.innerHTML = ViewBinaryDisasm.asHtml(dataBytes, body.auxType)
        } else { // if (body.type == "BIN")
          topDiv.innerHTML = ViewBinaryHex.asHtml(dataBytes, body.auxType)
        }
        break
      }

      // *** called on redo? ***
      case "update": {
        console.log("update") // ***
        // const strokes = body.edits.map(edit => new Stroke(edit.color, edit.stroke))
        // await editor.reset(body.content, strokes)
        break
      }

      case "getFileData": {
        if (this.displayView && this.frameData) {
          vscode.postMessage({ type: 'response', requestId, body: Array.from(this.frameData) })
        }
        break
      }
    }
  }

  // IUndoHooks implementation

  capturedUndo(index: number) {
    vscode.postMessage({
      type: 'stroke'      // ***
    })
  }

  didUndo(index: number) {
  }

  didRedo(index: number) {
  }

  // IMachineDisplay implementation

  getVisibleDisplayPage(): number {
    return 0
  }

  getActiveDisplayPage(): number {
    return 0
  }

  // IMachineDisplay

  public getDisplayMemory(frame: HiresFrame, page: number): void {
    if (this.frameData) {
      let offset = 0
      const pageAddress = 0x0000
      for (let y = 0; y < frame.height; y += 1) {
        let address = pageAddress + HiresTable[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          frame.bytes[offset + x] = this.frameData[address + x]
        }
        offset += frame.byteWidth
      }
    }
  }

  public setDisplayMemory(frame: HiresFrame, page: number): void {
    if (this.frameData) {
      let offset = 0
      const pageAddress = 0x0000
      for (let y = 0; y < frame.height; y += 1) {
        let address = pageAddress + HiresTable[y]
        for (let x = 0; x < frame.byteWidth; x += 1) {
          this.frameData[address + x] = frame.bytes[offset + x]
        }
        offset += frame.byteWidth
      }
    }
  }
}

const webview = new Webview()
vscode.postMessage({ type: 'ready' })
