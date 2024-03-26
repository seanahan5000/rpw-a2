
import { Point, Rect } from "./shared"
import { IMachineDisplay, Joystick } from "./shared"
import { IHostHooks } from "./shared"
import { HiresTable } from "./shared"
import { Tool, getModifierKeys } from "./display"
import { ZoomHiresDisplay } from "./display"

// TODO: fixme
// import { Project } from "./project"
type Project = any

// TODO: fixme
// import tippy from "tippy.js"
function tippy(a: string, b: any) {}

// TODO: what about these?
// import "@vscode/codicons/dist/codicon.css"
// TODO: is this needed for extension?
// import "./display_view.css"

enum DisplaySource {
  ACTIVE    = 0,
  VISIBLE   = 1,
  PRIMARY   = 2,
  SECONDARY = 3,
}

const displayTemplate = `
  <div id="display-grid">
    <div id="tool-palette">
      <div class="tool-btn" id="tool0"></div>
      <div class="tool-btn" id="tool1"></div>
      <div class="tool-btn" id="tool2"></div>
      <div class="tool-btn" id="tool3"></div>
      <div class="tool-btn" id="tool4"></div>
    </div>
    <div id="display-div" class="screen-tabs">
      <ul class="tabs-list">
        <li id="li0" class="active"><a>Active(0)</a></li>
        <li id="li1"><a>Visible(1)</a></li>
        <li id="li2"><a>Primary</a></li>
        <li id="li3"><a>Secondary</a></li>
      </ul>
      <div class="edit-btn codicon codicon-edit" id="screen-edit"></div>
      <div id="screen-div" class="screen-tab">
        <canvas tabindex="-1" id="hires-canvas" width="560px" height="384px" style="image-rendering: pixelated"></canvas>
      </div>
    </div>
    <div id="color-xy">
      <div id="color-palette">
        <div class="color-btn" id="clr0"></div>
        <div class="color-btn" id="clr1"></div>
        <div class="color-btn" id="clr2"></div>
        <div class="color-btn" id="clr3"></div>
        <div class="color-btn" id="clr4"></div>
        <div class="color-btn" id="clr5"></div>
        <div class="color-btn" id="clr6"></div>
        <div class="color-btn" id="clr7"></div>
      </div>
      <div id="xy-palette">
        <div class="coord"></div>
      </div>
      <div id="help-button-div">
        <button id="help-button">?</button>
      </div>
    </div>
    <div id="help-palette">
      <div id="help-col1"></div>
      <div id="help-col2"></div>
    </div>
  </div>`

const helpText1 = `
  <u>Tools</u><br>
  s: selection<br>
  p: pencil<br>
  r: rectangle<br>
  f: framed rectangle<br>
  ?: toggle this help<br>
  <br>
  <u>Colors</u><br>
  c#: select foreground color<br>
  cx: swap between color sets<br>
  x: xor with foreground color<br>
`

const helpText2 = `
  <u>Selection Tool</u><br>
  control-select: minimize selection<br>
  arrows: move selection<br>
  backspace: delete selection<br>
  option-drag: stamp selection<br>
  t: toggle selection transparency<br>
  cmd-shift-h: flip horizontal<br>
  cmd-shift-v: flip vertical<br>
  <br>
  <u>Zoom Mode</u><br>
  1-6: zoom in/out at cursor<br>
  g: toggle zoom grid<br>
  drag actual-size box center: move<br>
  drag actual-size box corner: resize<br>
`

const toolNames: string[] = [
  require("../media/tool-move.png"),
  require("../media/tool-marquee.png"),
  require("../media/tool-pencil.png"),
  require("../media/tool-rectfill.png"),
  require("../media/tool-rectframe.png")
]

export class DisplayView {
  public topDiv?: HTMLDivElement
  private project?: Project
  private machineDisplay?: IMachineDisplay
  private showPages: boolean
  private allowToggleEdit: boolean
  private startInEditMode: boolean
  private displayGrid: HTMLDivElement
  private displayDiv: HTMLDivElement
  private toolPalette: HTMLDivElement
  private colorPalette: HTMLDivElement
  private xyPalette: HTMLDivElement
  private helpButton: HTMLDivElement
  private showHelp = false
  private helpPalette: HTMLDivElement
  private hiresCanvas: HTMLCanvasElement
  private hiresDisplay: ZoomHiresDisplay
  private displaySource: DisplaySource
  private projectName?: string
  private hostHooks?: IHostHooks

  private hasFocus = false
  private isEditing = false
  private leftButtonIsDown = false
  private rightButtonIsDown = false
  private mousePt?: Point
  private lastMousePt?: Point
  private focusClick = false
  private joystick: Joystick
  private lastKey = ""
  private startWidth?: number
  private startHeight?: number
  private editWidth?: number
  private editHeight?: number
  private editTool = Tool.Move

  private foreColorIndex = 3

  constructor(parent: HTMLElement, machineDisplay: IMachineDisplay, project?: Project) {

    this.machineDisplay = machineDisplay
    this.project = project

    // TODO: base these on something real
    this.showPages = (this.project != undefined)
    this.allowToggleEdit = (this.project != undefined)
    this.startInEditMode = (this.project == undefined)

    this.topDiv = <HTMLDivElement>document.createElement("div")
    // TODO: there's security issue with doing this within a VSCode webview
    this.topDiv.innerHTML = displayTemplate
    parent.appendChild(this.topDiv)

    this.displayGrid = <HTMLDivElement>this.topDiv.querySelector("#display-grid")
    let screenTab = <HTMLDivElement>this.displayGrid.querySelector("#screen-div")
    let resizeObserver = new ResizeObserver(() => {
      // TODO: get padding values from somewhere
      this.onResize(screenTab.clientWidth - 8, screenTab.clientHeight - 8)
    })
    resizeObserver.observe(screenTab)

    this.displayDiv = <HTMLDivElement>this.displayGrid.querySelector("#display-div")
    this.hiresCanvas = <HTMLCanvasElement>this.displayDiv.querySelector("#hires-canvas")
    this.hiresDisplay = new ZoomHiresDisplay(this.hiresCanvas, machineDisplay)

    // TODO: clean all this up
    this.toolPalette = <HTMLDivElement>this.displayGrid.querySelector("#tool-palette")
    this.colorPalette = <HTMLDivElement>this.displayGrid.querySelector("#color-palette")
    this.xyPalette = <HTMLDivElement>this.displayGrid.querySelector("#xy-palette")
    this.helpButton = <HTMLDivElement>this.displayGrid.querySelector("#help-button-div")
    this.helpButton.onmousedown = (e: MouseEvent) => {
      this.toggleHelp()
    }

    this.helpPalette = <HTMLDivElement>this.displayGrid.querySelector("#help-palette")
    const helpCol1 = <HTMLDivElement>this.helpPalette.querySelector("#help-col1")
    helpCol1.innerHTML = helpText1
    const helpCol2 = <HTMLDivElement>this.helpPalette.querySelector("#help-col2")
    helpCol2.innerHTML = helpText2

    for (let i = 0; i < toolNames.length; i += 1) {
      const image = document.createElement("img")
      image.className = "tool-img"
      image.src = toolNames[i]
      const div = <HTMLDivElement>this.toolPalette.querySelector("#tool" + i)
      div.appendChild(image)
    }

    if (this.showPages) {
      this.displaySource = DisplaySource.ACTIVE
    } else {
      this.displaySource = DisplaySource.PRIMARY
      let list = <HTMLElement>this.displayDiv.querySelector(".tabs-list")
      list.style.display = "none"

      // TODO: replace these hacks to clean up margin when screen tabs are hidden
      //  with real css classes
      this.toolPalette.style.marginTop = "4px"
      this.displayGrid.style.marginLeft = "0px"
      let screenTabs = <HTMLDivElement>this.displayGrid.querySelector(".screen-tabs")
      screenTabs.style.marginTop = "4px"
    }

    tippy('#screen-edit', { content: 'Edit Screen (\u2318E)' })

    this.hiresDisplay.onToolChanged = (toolIndex: Tool) => {
      this.onToolChanged(toolIndex)
    }

    this.hiresDisplay.onToolRectChanged = (toolRect: Rect) => {
      this.onToolRectChanged(toolRect)
    }

    // Chrome doesn't support oncopy/onpaste of canvas elements
    //  so manually redirect here

    document.oncut = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.oncut) {
          element.oncut(e)
        }
      }
    }

    document.oncopy = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.oncopy) {
          element.oncopy(e)
        }
      }
    }

    document.onpaste = (e: ClipboardEvent) => {
      if (document.activeElement) {
        let element: HTMLElement = document.activeElement as HTMLElement
        if (element && element.onpaste) {
          element.onpaste(e)
        }
      }
    }

    document.onselectstart = (e: Event) => {
      if (document.activeElement == this.hiresCanvas) {
        if (this.isEditing) {
          this.hiresDisplay.selectAll(false)
        }
      }
    }

    document.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key == "F5" && !e.shiftKey && !e.ctrlKey) {
        this.hiresCanvas.focus()
      }
    })

    let editButton = <HTMLDivElement>this.displayGrid.querySelector("#screen-edit")
    if (this.showPages) {
      editButton.onmousedown = (e: MouseEvent) => {
        e.preventDefault()
        this.toggleEditMode()
        this.hiresCanvas.focus()
      }
    } else {
      editButton.style.display = "none"
    }

    this.hiresCanvas.oncut = (e: ClipboardEvent) => {
      this.hiresDisplay.cutSelection(false)
    }

    this.hiresCanvas.oncopy = (e: ClipboardEvent) => {
      this.hiresDisplay.copySelection(false)
    }

    this.hiresCanvas.onpaste = (e: ClipboardEvent) => {
      navigator.clipboard.readText().then(clipText => {
        if (this.isEditing) {
          this.hiresDisplay.pasteSelection(clipText, this.mousePt)
        }
      })
    }

    this.hiresCanvas.onkeydown = (e: KeyboardEvent) => {

      if (!this.isEditing) {
        if (e.key == "Meta") {
          if (e.code == "MetaLeft") {
            this.joystick.button0 = true
          } else if (e.code == "MetaRight") {
            this.joystick.button1 = true
          }
          this.updateJoystick()
        }
      }

      let curKey = e.key.toLowerCase()

      if (e.metaKey && curKey == "e") {
        if (this.allowToggleEdit) {
          this.toggleEditMode()
          e.preventDefault()
        }
        return
      }

      // ignore function keys here
      if (!this.isEditing) {
        if (e.key[0] == "F" && e.key.length > 1) {
          return
        }
      }

      if (!this.isEditing) {
        let appleCode = 0
        if (!e.ctrlKey) {
          let ascii40 = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ\[\\\]\^\_"
          let i = ascii40.indexOf(e.key)
          if (i >= 0) {
            appleCode = 0x40 + i
          } else {
            let ascii60 = "\`abcdefghijklmnopqrstuvwxyz\{\|\}\~"
            let i = ascii60.indexOf(e.key)
            if (i >= 0) {
              appleCode = 0x40 + i
            } else {
              let ascii20 = " \!\"\#\$\%\&\'\(\)\*\+\,\-\.\/0123456789\:\;\<\=\>\?"
              let i = ascii20.indexOf(e.key)
              if (i >= 0) {
                appleCode = 0x20 + i
              }
            }
          }
        }
        if (appleCode == 0) {
          let code = e.which
          if (code < 0x80) {
            if (e.ctrlKey) {
              // NOTE: assuming lower case supported, so only forcing
              //  to upper case before applying control modifier
              if (code >= 0x61 && code <= 0x7a) {  // 'a' to 'z'
                  code -= 0x20  // 'a' - 'A'
              }
              if (code >= 0x40 && code < 0x60) {
                code -= 0x40
              }
            } else {
              switch (code) {
                case 37:
                  code = 8    // left arrow
                  break
                case 38:
                  code = 11   // up arrow
                  break
                case 39:
                  code = 21   // right arrow
                  break
                case 40:
                  code = 10   // down arrow
                  break
              }
            }
            if (e.key != "Meta") {
              appleCode = code
            }
          }
        }

        if (appleCode) {
          this.project?.machine.setKeyCode(appleCode)
          // eat everything (backspace, tab, escape, arrows)
          //  that goes to Apple 2
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }

      // isEditing true after this point

      let direction = -1
      if (e.key == "ArrowUp") {
        direction = 0
      } else if (e.key == "ArrowRight") {
        direction = 1
      } else if (e.key == "ArrowDown") {
        direction = 2
      } else if (e.key == "ArrowLeft") {
        direction = 3
      }
      if (direction >= 0) {
        this.hiresDisplay.toolArrow(direction, getModifierKeys(e))
        return
      }

      if (e.metaKey) {
        if (curKey == "x") {
          if (!this.hostHooks) {
            this.hiresDisplay.cutSelection(e.shiftKey)
            e.preventDefault()
          }
        } else if (curKey == "c") {
          if (!this.hostHooks) {
            this.hiresDisplay.copySelection(e.shiftKey)
            e.preventDefault()
          }
        } else if (curKey == "v") {
          if (e.shiftKey) {
            this.hiresDisplay.flipSelection(false, true)
            e.preventDefault()
          } else {
            if (!this.hostHooks) {
              navigator.clipboard.readText().then(clipText => {
                if (this.isEditing) {
                  this.hiresDisplay.pasteSelection(clipText, this.mousePt)
                }
              })
            }
            e.preventDefault()
          }
        } else if (curKey === "a") {
          // NOTE: do this even if hostHooks is present
          this.hiresDisplay.selectAll(e.ctrlKey)
          e.preventDefault()
        } else if (curKey === "z") {
          if (!this.hostHooks) {
            if (e.shiftKey) {
              this.hiresDisplay.redo()
            } else {
              this.hiresDisplay.undo()
            }
            e.preventDefault()
          }
        } else if (curKey == "h") {
          if (e.shiftKey) {
            this.hiresDisplay.flipSelection(true, false)
          }
          e.preventDefault()
        }
        return
      }

      if (curKey === "c" || curKey === "b") {
        if (this.lastKey == "") {
          this.lastKey = curKey
          return
        }
      }

      if (this.lastKey === "c" || this.lastKey === "b") {
        if (curKey == "x") {
          // toggle color between sets
          this.setForeColor(this.foreColorIndex ^ 4)
          this.lastKey = ""
          return
        }

        let keySet = "bgvwaoui"
        let color = keySet.search(curKey)
        if (color != -1) {
          if (this.lastKey == "c") {
            this.setForeColor(color)
          } else /*if (this.lastKey == "b")*/ {
            this.setBackColor(color)
          }
          this.lastKey = ""
          return
        }
      }

      let n = parseInt(curKey)
      if (n >= 0 && n <= 9) {
        if (this.lastKey == "c") {
          this.setForeColor(n)
        } else if (this.lastKey == "b") {
          this.setBackColor(n)
        } else {
          this.hiresDisplay.setZoomScale(1 << (n - 1), this.mousePt)
        }
        this.lastKey = ""
        return
      }

      if (curKey == "backspace") {
        this.hiresDisplay.clearSelection()
        // TODO: possibly update cursor
      } else if (curKey == "s") {
        this.setTool(Tool.Select)
      } else if (curKey == "p" || curKey == ".") {
        this.setTool(Tool.Pencil)
      } else if (curKey == "r") {
        this.setTool(Tool.FillRect)
      } else if (curKey == "f") {
        this.setTool(Tool.FrameRect)
      } else if (curKey == "g") {
        this.hiresDisplay.toggleGrid()
      } else if (curKey == "t") {
        this.hiresDisplay.toggleTransparency()
      } else if (curKey == "x") {
        this.hiresDisplay.toggleColor()
      } else if (curKey == "?") {
        this.toggleHelp()
      }

      this.lastKey = ""
    }

    this.hiresCanvas.onkeyup = (e: KeyboardEvent) => {
      if (!this.isEditing) {
        if (e.key == "Meta") {
          if (e.code == "MetaLeft") {
            this.joystick.button0 = false
          } else if (e.code == "MetaRight") {
            this.joystick.button1 = false
          }
          if (this.mousePt) {
            this.updateJoystick()
          }
        }
      }
    }

    this.hiresCanvas.onwheel = (e: WheelEvent) => {
      this.hiresDisplay.scroll(e.deltaX, e.deltaY)
      e.preventDefault()
    }

    this.hiresCanvas.onfocus = (e: FocusEvent) => {
      this.hasFocus = true
      if (!this.isEditing) {
        this.hiresCanvas.style.cursor = "none"
      }
    }

    this.hiresCanvas.onblur = (e: FocusEvent) => {
      this.hasFocus = false
      if (!this.isEditing) {
        this.hiresCanvas.style.cursor = "default"
      }
    }

    this.hiresCanvas.onpointerenter = (e: PointerEvent) => {
      this.mousePt = this.canvasFromClient(e)
      this.lastMousePt = this.mousePt
      if (!this.isEditing && this.hasFocus) {
        this.resetJoystick()
      }
    }

    this.hiresCanvas.onpointerdown = (e: PointerEvent) => {
      this.lastMousePt = this.mousePt
      this.mousePt = this.canvasFromClient(e)
      // ignore click that puts element into focus
      if (!this.hasFocus) {
        this.focusClick = true
        if (!this.isEditing) {
          this.resetJoystick()
        }
        return
      }

      this.focusClick = false
      if (e.which == 1) {
        this.hiresCanvas.setPointerCapture(e.pointerId)
        this.leftButtonIsDown = true
        this.joystick.button0 = true
        if (this.isEditing) {
          this.hiresDisplay.toolDown(this.mousePt, getModifierKeys(e))
        }
      } else if (e.which == 3) {
        this.rightButtonIsDown = true
        this.joystick.button1 = true
      }
      if (!this.isEditing) {
        this.updateJoystick()
      }
    }

    this.hiresCanvas.oncontextmenu = (e: MouseEvent) => {
      // suppress all right-click context menus
      return false
    }

    this.hiresCanvas.onpointermove = (e: PointerEvent) => {
      let canvasPt = this.canvasFromClient(e)
      if (canvasPt.x < 0) {
        canvasPt.x = 0
      }
      if (canvasPt.y < 0) {
        canvasPt.y = 0
      }
      this.lastMousePt = this.mousePt
      this.mousePt = canvasPt
      if (this.isEditing) {
        if (this.leftButtonIsDown) {
          this.hiresDisplay.toolMove(this.mousePt, getModifierKeys(e))
        }
      } else {
        if (this.hasFocus) {
          this.updateJoystick()
        }
      }
    }

    this.hiresCanvas.onpointerup = (e: PointerEvent) => {
      if (this.focusClick) {
        return
      }
      this.lastMousePt = this.mousePt
      this.mousePt = this.canvasFromClient(e)
      if (e.which == 1) {
        this.hiresCanvas.releasePointerCapture(e.pointerId)
        this.leftButtonIsDown = false
        this.joystick.button0 = false
        if (this.isEditing) {
          this.hiresDisplay.toolUp(this.mousePt, getModifierKeys(e))
        }
      } else if (e.which == 3) {
        this.rightButtonIsDown = false
        this.joystick.button1 = false
      }
      if (!this.isEditing && this.hasFocus) {
        this.updateJoystick()
      }
    }

    this.hiresCanvas.onpointerleave = (e: PointerEvent) => {
      this.leftButtonIsDown = false
      this.rightButtonIsDown = false
      this.joystick.button0 = false
      this.joystick.button1 = false
      if (this.isEditing) {
        this.mousePt = undefined
        this.lastMousePt = undefined
      } else {
        if (this.hasFocus) {
          this.updateJoystick()
        }
      }
    }

    for (let i = 0; i < 4; i += 1) {
      let liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + i)
      liElement.onmousedown = () => {
        this.onclickDisplaySource(i)
      }
    }

    for (let i = 0; i < 8; i += 1) {
      let toolButton = <HTMLDivElement>this.toolPalette.querySelector("#tool" + i)
      if (toolButton == undefined) {
        break
      }
      toolButton.onmousedown = (e: MouseEvent) => {
        // NOTE: stops button from taking focus away from this.hiresCanvas
        e.preventDefault()
        // e.stopPropagation()
        this.setTool(i)
        this.hiresCanvas.focus()
      }
    }

    for (let i = 0; i < 8; i += 1) {
      let colorButton = <HTMLDivElement>this.colorPalette.querySelector("#clr" + i)
      if (colorButton == undefined) {
        break
      }
      colorButton.style.backgroundColor = this.hiresDisplay.getRgbColorString(i)
      colorButton.onmousedown = (e: MouseEvent) => {
        // NOTE: stops button from taking focus away from this.hiresCanvas
        e.preventDefault()
        this.setForeColor(i)
        this.hiresCanvas.focus()
      }
    }

    this.colorPalette.onmousedown = (e: MouseEvent) => {
      // NOTE: stops button from taking focus away from this.hiresCanvas
      e.preventDefault()
    }

    if (this.startInEditMode) {
      this.toggleEditMode()
      // force this once to initialize xy-palette contents
      this.onToolRectChanged()
    }

    this.joystick = { x0: 0, y0: 0, button0: false, button1: false }

    // default to green
    this.setForeColor(1)
  }

  public setHostHooks(hostHooks: IHostHooks) {
    this.hostHooks = hostHooks
    this.hiresDisplay.setHostHooks(hostHooks)
  }

  public undo() {
    this.hiresDisplay.undo()
  }

  public redo() {
    this.hiresDisplay.redo()
  }

  public revertUndo(index: number) {
    this.hiresDisplay.revertUndo(index)
  }

  private canvasFromClient(e: PointerEvent): Point {
    let canvas = <HTMLCanvasElement>e.target
    let rect = canvas.getBoundingClientRect()
    // TODO: eliminate these hard-coded values
    const padding = 0
    const border = 4
    let canvasPt: Point = {
      x: e.clientX - rect.left - padding - border,
      y: e.clientY - rect.top - padding - border
    }
    return canvasPt
  }

  loadSettings(projectName: string) {
    this.projectName = projectName

    let itemName = this.projectName + "/display"
    let settingsJSON = localStorage.getItem(itemName)
    if (settingsJSON) {
      let settings = JSON.parse(settingsJSON)
      this.onclickDisplaySource(settings.source)
    }
  }

  private resetJoystick() {
    // choose initial joystickPt based entering location in canvas
    // TODO: just use initial mouse point, scaled?
    // TODO: don't use constants here
    this.joystick.x0 = (this.mousePt?.x ?? 0) < 280 ? 0 : 255
    this.joystick.y0 = (this.mousePt?.y ?? 0) < 192 ? 0 : 255
    this.joystick.button0 = false
    this.joystick.button1 = false
  }

  private updateJoystick() {
    if (!this.mousePt || !this.lastMousePt) {
      return
    }
    this.joystick.x0 += (this.mousePt.x - this.lastMousePt.x)
    if (this.joystick.x0 < 0) {
      this.joystick.x0 = 0
    } else if (this.joystick.x0 > 255) {
      this.joystick.x0 = 255
    }
    this.joystick.y0 += (this.mousePt.y - this.lastMousePt.y)
    if (this.joystick.y0 < 0) {
      this.joystick.y0 = 0
    } else if (this.joystick.y0 > 255) {
      this.joystick.y0 = 255
    }
    this.project?.machine.setJoystickValues(this.joystick)
  }

  onResize(width: number, height: number) {
    this.hiresDisplay.resizeDisplay(width, height)
  }

  onclickDisplaySource(displaySource: DisplaySource) {
    for (let i = 0; i < 4; i += 1) {
      let liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + i)
      liElement.className = i == displaySource ? "active" : ""
    }
    this.displaySource = displaySource

    if (this.projectName) {
      // save display source setting
      let itemName = this.projectName + "/display"
      let settings = { source: this.displaySource }
      let settingsJSON = JSON.stringify(settings)
      localStorage.setItem(itemName, settingsJSON)
    }

    this.update(this.project?.isCpuRunning() || false)
    this.hiresCanvas.focus()
  }

  private setTool(toolIndex: Tool) {
    this.hiresDisplay.setTool(toolIndex)
  }

  private onToolChanged(toolIndex: Tool) {
    for (let i = 0; i < 8; i += 1) {
      let toolButton = <HTMLButtonElement>this.toolPalette.querySelector("#tool" + i)
      if (toolButton == undefined) {
        break
      }
      if (i == toolIndex) {
        toolButton.classList.add("active")
      } else {
        toolButton.classList.remove("active")
      }
    }

    // TODO: set different cursor for each tool type
    // TODO: should this be in this.hiresDisplay instead?
    if (toolIndex == Tool.Select || toolIndex == Tool.FillRect || toolIndex == Tool.FrameRect) {
      this.hiresCanvas.style.cursor = "crosshair"
    } else {
      this.hiresCanvas.style.cursor = "default"
    }
  }

  private getTool(): Tool {
    return this.hiresDisplay.getTool()
  }

  private setForeColor(colorIndex: number) {
    for (let i = 0; i < 8; i += 1) {
      let colorButton = <HTMLButtonElement>this.colorPalette.querySelector("#clr" + i)
      if (colorButton == undefined) {
        break
      }
      colorButton.className = "color-btn" + (i == colorIndex ? " active" : "")
    }

    this.hiresDisplay.setForeColor(colorIndex)
    this.foreColorIndex = colorIndex
  }

  private setBackColor(colorIndex: number) {
    this.hiresDisplay.setBackColor(colorIndex)
  }

  private toggleEditMode() {
    this.isEditing = !this.isEditing
    if (this.isEditing) {
      this.project?.stopCpu()
      this.hiresCanvas.focus()
    }

    let screenDiv = <HTMLDivElement>this.displayGrid.querySelector("#screen-div")
    if (this.isEditing) {
      if (this.startWidth == undefined) {
        this.startWidth = screenDiv.clientWidth
        this.startHeight = screenDiv.clientHeight
      }
      if (this.editWidth == undefined) {
        this.editWidth = screenDiv.clientWidth
        this.editHeight = screenDiv.clientHeight
      }
    } else {
      this.editWidth = screenDiv.clientWidth
      this.editHeight = screenDiv.clientHeight
    }

    screenDiv.style.width = (this.isEditing ? this.editWidth : this.startWidth) + "px"
    screenDiv.style.height = (this.isEditing ? this.editHeight : this.startHeight) + "px"
    screenDiv.style.resize = this.isEditing ? "both" : "none"

    // TODO: add/remove on classList
    this.displayGrid.className = this.isEditing ? "editing" : ""
    this.toolPalette.className = this.isEditing ? "visible" : ""
    this.colorPalette.className = this.isEditing ? "visible" : ""
    this.xyPalette.className = this.isEditing ? "visible" : ""
    this.helpButton.className = this.isEditing ? "visible" : ""
    this.helpPalette.className = this.isEditing && this.showHelp ? "visible" : ""

    if (this.isEditing) {
      this.setTool(this.editTool)
    } else {
      this.editTool = this.getTool()
      if (this.hasFocus) {
        this.hiresCanvas.style.cursor = "none"
      }
      // TODO: don't use constants here
      this.hiresDisplay.resizeDisplay(560, 384)
      this.hiresDisplay.setZoomScale(1, this.mousePt)
      this.hiresDisplay.selectNone()
    }
  }

  private toggleHelp() {
    this.showHelp = !this.showHelp
    this.helpPalette.className = this.isEditing && this.showHelp ? "visible" : ""
  }

  private getPageIndex(): number {
    if (this.displaySource == DisplaySource.PRIMARY) {
      return 0
    } else if (this.displaySource == DisplaySource.SECONDARY) {
      return 1
    } else if (this.displaySource == DisplaySource.VISIBLE) {
      return this.machineDisplay?.getVisibleDisplayPage() ?? 0
    } else if (this.displaySource == DisplaySource.ACTIVE) {
      return this.machineDisplay?.getActiveDisplayPage() ?? 0
    } else {
      return 0
    }
  }

  update(isRunning: boolean) {
    // TODO: should this look at isRunning or not?
    // if (!isRunning)
    {
      for (let i = 0; i < 2; i += 1) {
        let liElement = <HTMLLIElement>this.displayDiv.querySelector("#li" + i)
        let anchorElement = <HTMLAnchorElement>liElement.children[0]
        let liText = anchorElement.innerHTML
        if (liText.endsWith(")")) {
          liText = liText.substring(0, liText.length - 3)
        }
        if (i == 0) {
          let activePage = this.machineDisplay?.getActiveDisplayPage() ?? 0
          anchorElement.innerHTML = liText + `(${1 + activePage})`
        } else {
          let visiblePage = this.machineDisplay?.getVisibleDisplayPage() ?? 0
          anchorElement.innerHTML = liText + `(${1 + visiblePage})`
        }
      }
    }

    this.hiresDisplay.setPageIndex(this.getPageIndex())
    this.hiresDisplay.updateFromMemory()
  }

  private onToolRectChanged(toolRect?: Rect) {
    if (this.isEditing) {
      const x1 = toolRect?.x || 0
      const y1 = toolRect?.y || 0
      const width = toolRect?.width || 0
      const height = toolRect?.height || 0
      let str = ""
      if (this.project && this.project.isNaja) {
        str = `PictMoveTo ${x1};${y1}`
        if (width != 0 || height != 0) {
          const x2 = x1 + width
          const y2 = y1 + height
          str += "<br>"
          str += `PictRect ${x1.toString()};${y1.toString()};${(x2 - 1).toString()};${(y2 - 1).toString()}`
          const xb1 = Math.floor(x1 / 7)
          const xb2 = Math.floor((x2 + 6) / 7)
          str += "<br>"
          str += `PictClear ${xb1.toString()};${y1.toString()};${xb2.toString()};${y2.toString()}`
        }
      } else {
        str = `X: ${x1}, Y: ${y1}`
        if (width != 0 || height != 0) {
          str += "<br>"
          str += `W: ${width}, H: ${height}`
        }
      }
      if (width == 0 && height == 0) {
        if (y1 < 192) {
          const xb1 = Math.floor(x1 / 7)
          const address = 0x2000 + this.getPageIndex() * 0x2000 + HiresTable[y1] + xb1
          str += "<br>"
          str += `Address: $${address.toString(16).toUpperCase()}`
        }
      }
      this.xyPalette.innerHTML = str
    } else {
      this.xyPalette.innerHTML = ""
    }
  }
}
