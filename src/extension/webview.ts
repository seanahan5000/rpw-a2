
import { DisplayView } from "../display_view"

// @ts-ignore
const vscode = acquireVsCodeApi()

// <div class="drawing-canvas"></div>
// <canvas tabindex="-1" id="hires-canvas" width="560px" height="384px" style="image-rendering: pixelated"></canvas>

// this.hiresCanvas = <HTMLCanvasElement>this.displayDiv.querySelector("#hires-canvas")

let displayView: DisplayView

window.addEventListener("message", async e => {
  const { type, body, requestId } = e.data
  switch (type) {
    case "init": {

      const dataBlob = new Blob([ body.value ])
      const dataArray = await dataBlob.arrayBuffer()
      const hiresData = new Uint8Array(dataArray)

      const topDiv = <HTMLDivElement>document.querySelector("#top-div")
      displayView = new DisplayView(topDiv)
      displayView.setFrameMemory(hiresData)

      // editor.setEditable(body.editable);
      // if (body.untitled) {
      //   await editor.resetUntitled();
      //   return;
      // } else {
      //   // Load the initial image into the canvas.
      //   await editor.reset(body.value);
      //   return;
      // }

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
