
import { DisplayView } from "../display_view"
import { ViewApplesoft, ViewBinaryDisasm, ViewBinaryHex, ViewInteger, ViewText } from "../data_viewers"

// @ts-ignore
const vscode = acquireVsCodeApi()

let displayView: DisplayView

window.addEventListener("message", async e => {
  const { type, body, requestId } = e.data
  switch (type) {
    case "init": {

      const dataBlob = new Blob([ body.value ])
      const dataArray = await dataBlob.arrayBuffer()
      const dataBytes = new Uint8Array(dataArray)

      const topDiv = <HTMLDivElement>document.querySelector("#top-div")
      if (body.type == "PIC") {
        displayView = new DisplayView(topDiv)
        displayView.setFrameMemory(dataBytes)
        //*** look at body.editable flag ***
      } else if (body.type == "BAS") {
        topDiv.innerHTML = ViewApplesoft.asHtml(dataBytes)
      } else if (body.type == "INT") {
        topDiv.innerHTML = ViewInteger.asHtml(dataBytes)
      } else if (body.type == "TXT") {
        topDiv.innerHTML = ViewText.asHtml(dataBytes, false)
      } else if (body.type == "LST") {
        const address = 0x1000  // ***
        topDiv.innerHTML = ViewBinaryDisasm.asHtml(dataBytes, address)
      } else { // if (body.type == "BIN")
        const address = 0x1000  // ***
        topDiv.innerHTML = ViewBinaryHex.asHtml(dataBytes, address)
      }
      break
    }
    case "update": {
      break
    }
    case "getFileData": {
      break
    }
  }
})

vscode.postMessage({ type: 'ready' })
