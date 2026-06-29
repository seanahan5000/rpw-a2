
import { Point, Joystick } from "../../shared/types"
import { IInputEventHandler } from "../../shared/types"
import { EmulatorParams, Emulator, Machine } from "../machine"

import { AppleMachine, Apple, FileDiskImage, DisplaySource } from "./apple"
import { DisplayView } from "../../display/display_view"
import { MachineView, IconView, IconImages } from "../machine_view"
import * as Views from "../machine_view"
import { Text40Format } from "./formats/text"

//------------------------------------------------------------------------------

export class AppleView extends MachineView {

  private screensDiv!: HTMLDivElement

  constructor(
      parent: HTMLElement,
      machine: Machine,
      displayView: DisplayView,
      clickHook?: (type: string) => void) {
    super(parent, machine, displayView, clickHook)

    this.addView(new DiskIconView(this, 0))
    this.addView(new DiskIconView(this, 1))
    this.addView(new RebootIconView(this))
    this.addView(new Views.PauseIconView(this))
    this.addView(new Views.SoundIconView(this))
    this.addView(new ScreenIconView(this))
    this.addView(new Views.PaintIconView(this))
    this.addView(new Views.SnapshotIconView(this))
    this.addView(new Views.PrevNextIconView(this, 0))
    this.addView(new Views.PrevNextIconView(this, 1))
  }

  protected override addView(view: IconView) {
    if (view instanceof ScreenIconView) {
      this.screensDiv = view.screensDiv
    } else {
      view.iconDiv.addEventListener("pointerenter", () => {
        this.screensDiv.style.display = "none"
      })
    }
  }
}

//------------------------------------------------------------------------------
// MARK: Screen

const ScreenIconImages: string[] = [
  require("../../../media/icon-video-visible.svg"),
  require("../../../media/icon-video-active.svg"),
  require("../../../media/icon-video-primary.svg"),
  require("../../../media/icon-video-secondary.svg"),
]

const screenHelpTexts = [
  "Show visible page",
  "Show written-to page",
  "Show primary page",
  "Show secondary page"
]

class ScreenIconView extends IconView {

  private appleMachine: AppleMachine
  private iconPage: HTMLDivElement
  public screensDiv: HTMLDivElement

  constructor(machineView: MachineView) {
    super(machineView)

    this.appleMachine = <AppleMachine>this.machine

    this.screensDiv = <HTMLDivElement>document.createElement("div")
    this.screensDiv.classList.add("screens-div")

    for (let i = 0; i < 4; i += 1) {

      const iconHelp = document.createElement("div")
      iconHelp.classList.add("screens-help")
      iconHelp.textContent = screenHelpTexts[i]

      const iconDiv = <HTMLDivElement>document.createElement("div")
      iconDiv.classList.add("screens-icon")
      this.screensDiv.appendChild(iconDiv)

      iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault()
        this.appleMachine.displayClock.setDisplaySource(i)
        this.screensDiv!.style.display = "none"
        this.displayView.focus()
      })

      iconDiv.addEventListener("pointerenter", () => {
        iconDiv.classList.add("hilite")
      })

      iconDiv.addEventListener("pointerleave", () => {
        iconDiv.classList.remove("hilite")
      })

      const iconImage = <HTMLImageElement>document.createElement("img")
      iconImage.src = ScreenIconImages[i]
      iconDiv.appendChild(iconImage)

      iconDiv.appendChild(iconHelp)
      this.machineView.setHoverElement(iconDiv, iconHelp)
    }

    const iconPageWrapper = <HTMLDivElement>document.createElement("div")
    iconPageWrapper.classList.add("apple-icon-page-wrapper")
    this.iconDiv.appendChild(iconPageWrapper)

    this.iconPage = <HTMLDivElement>document.createElement("div")
    this.iconPage.classList.add("apple-icon-page")
    iconPageWrapper.appendChild(this.iconPage)

    this.iconDiv.classList.add("apple-screen")
    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      this.screensDiv.style.display = "flex"  // ***
      this.displayView.focus()
    })

    this.machineView.topDiv.appendChild(this.screensDiv)
    // *** this.iconDiv.appendChild(this.screensDiv)

    this.appleMachine.displayClock.setSourceListener((source: DisplaySource, isPaged: boolean, pageIndex: number) => {
      this.updateScreenInfo(source, isPaged, pageIndex)
    })
  }

  private updateScreenInfo(source: DisplaySource, isPaged: boolean, pageIndex: number) {
    this.iconImage.src = ScreenIconImages[source]
    let helpText = "Change page shown<br>"
    switch (source) {
      case DisplaySource.Visible:
        this.iconPage.textContent = ""
        if (isPaged) {
          helpText += `(Now showing visible page ${pageIndex + 1})`
          this.iconPage.textContent = (pageIndex + 1).toString()
        } else {
          this.iconPage.textContent = ""
        }
        break
      case DisplaySource.Active:
        this.iconPage.textContent = ""
        if (isPaged) {
          helpText += `(Now showing written-to page ${pageIndex + 1})`
          this.iconPage.textContent = (pageIndex + 1).toString()
        } else {
          this.iconPage.textContent = ""
        }
        break
      case DisplaySource.Primary:
        helpText += "(Now showing primary page)"
        this.iconPage.textContent = ""
        break
      case DisplaySource.Secondary:
        helpText += "(Now showing secondary page)"
        this.iconPage.textContent = ""
        break
    }
    this.iconHelp.innerHTML = helpText
    this.iconHelp.style.marginTop = "-42px"
  }
}

//------------------------------------------------------------------------------
// MARK: Disk

const DriveImages: string[] = [
  require("../../../media/icon-drive-off-empty.svg"),
  require("../../../media/icon-drive-on-empty.svg"),
  require("../../../media/icon-drive-off.svg"),
  require("../../../media/icon-drive-on.svg")
]

class DiskIconView extends IconView {

  constructor(machineView: MachineView, index: number) {
    super(machineView)

    this.iconDiv.classList.add("apple-drive")

    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault()
      if (this.machineView.clickHook) {
        this.machineView.clickHook("drive" + index)
      } else {
        this.onDriveClick(index, e)
        this.displayView.focus()
      }
    })

    if (this.machine instanceof AppleMachine) {
      this.machine.disk2Card.setListener(index, (diskImage, isActive) => {
        this.onDriveChanged(index, this.iconImage, this.iconHelp, diskImage, isActive)
      })
    }

    this.enableDragAndDrop(index)
  }

  override async onDrop(driveIndex: number, e: DragEvent) {
    if (e.dataTransfer) {
      for (const item of Array.from(e.dataTransfer.items)) {
        const fsHandle = await (item as any).getAsFileSystemHandle()
        if (fsHandle) {
          const image = await this.openDiskFile(fsHandle)
          if (image) {
            // TODO: factor out/generalize
            if (this.machine instanceof AppleMachine) {
              this.machine.disk2Card.setImage(driveIndex, image)
            }
            break
          }
        }
      }
    }
  }

  // NOTE: only used for standalone development work in browser
  private async onDriveClick(driveIndex: number, e: MouseEvent) {
    let obj: any = (window as any)
    if (obj) {
      if (typeof obj?.showOpenFilePicker === 'function') {
        try {
          const pickerOpts = {
            types: [{
              description: "Disks",
              accept: {
                "disks/*": [".dsk",".do",".po",".nib",".2mg"]
              }
            }],
            multiple: false
          }
          const fileList = await obj.showOpenFilePicker(pickerOpts)
          if (fileList.length > 0) {
            const image = await this.openDiskFile(fileList[0])
            if (image) {
              if (this.machine instanceof AppleMachine) {
                this.machine.disk2Card.setImage(driveIndex, image)
              }
              return
            }
          }
        } catch (e) {
          return // cancel
        }
      }
    }
  }

  // handle dragged-and-dropped file
  private async openDiskFile(fsHandle: FileSystemHandle): Promise<FileDiskImage | undefined> {
    if (fsHandle.kind == "directory") {
      return
    }
    const fileHandle: FileSystemFileHandle = <FileSystemFileHandle>fsHandle
    const fileName: string = fsHandle.name
    let suffix = ""
    const n = fileName.lastIndexOf(".")
    if (n > 0) {
      suffix = fileName.substring(n + 1).toLowerCase()
    }
    if (suffix == "do" || suffix == "po" || suffix == "dsk" || suffix == "nib" || suffix == "2mg") {
      const dataBlob = await fileHandle.getFile()
      const dataArray = await dataBlob.arrayBuffer()
      const data = new Uint8Array(dataArray)
      // NOTE: For now, make all drag-and-drop disk images read-only.
      //  If the AppleView is moved between columns or into a floating window
      //  with VSCode, the emulator instance is serialized and then recreated,
      //  losing the original file handle.  Even if the full path is still
      //  available, the webview may not have access to that path anymore.
      return new FileDiskImage(fileName, data)
    }
  }

  private onDriveChanged(
      driveIndex: number,
      imageElement: HTMLImageElement,
      helpElement: HTMLDivElement,
      diskImage: FileDiskImage | undefined,
      isActive: boolean) {
    let imageIndex = 0
    if (diskImage != undefined) {
      imageIndex += 2
    }
    if (isActive) {
      imageIndex += 1
    }
    imageElement.src = DriveImages[imageIndex]
    let helpText = `Drive ${driveIndex + 1}: `
    if (diskImage) {
      const n = diskImage.fileName.lastIndexOf("/")
      if (n >= 0) {
        helpText += diskImage.fileName.substring(n + 1)
      } else {
        helpText += diskImage.fileName
      }
    } else {
      helpText += "(empty)"
    }
    helpElement.innerHTML = helpText
  }
}

//------------------------------------------------------------------------------
// MARK: Reboot

class RebootIconView extends IconView {

  constructor(machineView: MachineView) {
    super(machineView)

    this.iconDiv.classList.add("apple-reboot")    // *** necesssary?
    this.iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
      // NOTE: preventDefault here and below prevent focus change
      e.preventDefault()
      this.machine.reset(false)
      // TODO: option to reset project instead?
      if (e.shiftKey) {
        // TODO: factor out
        if (this.machine instanceof AppleMachine) {
          // force reboot
          this.machine.write(0x3f3, 0, 0)
          this.machine.write(0x3f4, 0, 0)
        }
      }
      if (!e.ctrlKey) {
        this.machine.clock.start()
      }
      this.displayView.focus()
    })
    this.iconImage.src = IconImages[0]
    this.iconHelp.innerHTML = "Reset machine<br>Shift key to force reboot<br>Control key to stop CPU"
  }
}

//------------------------------------------------------------------------------

// TODO: how does this get shutdown notification?

export class AppleEmulator extends Emulator {

  private appleMachine!: AppleMachine
  private appleInput!: AppleInput
  private appleView: AppleView

  constructor(
      parent: HTMLElement | undefined,
      params: EmulatorParams,
      clickHook?: (type: string) => void) {

    super(parent, params)

    const displayView = new DisplayView(this.topDiv, new Text40Format(), this.appleInput)
    this.machine.setView(displayView)

    this.appleView = new AppleView(this.topDiv, this.appleMachine, displayView, clickHook)
    this.appleView.setVisible(true)

    this.startMachine(params)
  }

  protected createMachine(params: EmulatorParams): Machine {
    let appleType: Apple | undefined

    if (!params.saveState) {
      let typeName: string = params.variant?.toLowerCase() ?? "iie"
      if (typeName.startsWith("apple")) {
        typeName = typeName.substring(5)
      }
      typeName = typeName.replace("//", "ii")
      typeName = typeName.replace("plus", "p")
      typeName = typeName.replace("+", "p")
      typeName = typeName.replace("enhanced", "e")
      typeName = typeName.replace("enh", "e")

      switch (typeName) {
        case "ii":
          appleType = Apple.II
          break
        case "iip":
          appleType = Apple.IIp
          break
        case "iie":
          appleType = Apple.IIe
          break
        case "iiee":
          appleType = Apple.IIee
          break
        case "iic":
          appleType = Apple.IIc
          break
        case "iicp":
          appleType = Apple.IIcp
          break
        default:
          appleType = Apple.IIe
          break
      }
    }

    this.appleMachine = new AppleMachine(appleType)
    this.appleInput = new AppleInput(this.appleMachine)
    return this.appleMachine
  }
}

//------------------------------------------------------------------------------

class AppleInput implements IInputEventHandler {

  private joystick: Joystick
  private mousePt?: Point
  private lastMousePt?: Point

  constructor(private appleMachine: AppleMachine) {
    this.joystick = { x0: 0, y0: 0, button0: false, button1: false }
  }

  public setMousePt(mousePt?: Point, lastMousePt?: Point): void {
    this.mousePt = mousePt
    this.lastMousePt = lastMousePt
  }

  public onkeydown(e: KeyboardEvent): void {

    if (e.key == "Meta") {
      if (e.code == "MetaLeft") {
        this.joystick.button0 = true
      } else if (e.code == "MetaRight") {
        this.joystick.button1 = true
      }
      this.updateJoystick()
    }

    // ignore function keys here
    if (e.key[0] == "F" && e.key.length > 1) {
      return
    }

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
          appleCode = 0x60 + i
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
          if (code == 17) {
            code = 0  // ignore control key by itself
          } else {
            // NOTE: assuming lower case supported, so only forcing
            //  to upper case before applying control modifier
            if (code >= 0x61 && code <= 0x7a) {  // 'a' to 'z'
                code -= 0x20  // 'a' - 'A'
            }
            if (code >= 0x40 && code < 0x60) {
              code -= 0x40
            }
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
            case 16:      // shift
            case 18:      // option
            case 20:      // capslock
              code = 0    // ignore
              break
          }
        }
        if (e.key != "Meta") {
          appleCode = code
        }
      }
    }

    if (appleCode) {
      this.appleMachine.setKeyCode(appleCode)
      // eat everything (backspace, tab, escape, arrows)
      //  that goes to Apple 2
      e.preventDefault()
      e.stopPropagation()
    }
  }

  public onkeyup(e: KeyboardEvent): void {
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

  public onpointerenter(e: PointerEvent, hasFocus: boolean): void {
    if (hasFocus) {
      this.resetJoystick()
    }
  }

  public onpointerdown(e: PointerEvent, reset: boolean): void {
    if (reset) {
      this.resetJoystick()
    } else {
      if (e.which == 1) {
        this.joystick.button0 = true
      } else if (e.which == 3) {
        this.joystick.button1 = true
      }

      this.updateJoystick()
    }
  }

  public onpointermove(e: PointerEvent, hasFocus: boolean): void {
    if (hasFocus) {
      this.updateJoystick()
    }
  }

  public onpointerup(e: PointerEvent, hasFocus: boolean): void {
    if (e.which == 1) {
      this.joystick.button0 = false
    } else if (e.which == 3) {
      this.joystick.button1 = false
    }
    if (hasFocus) {
      this.updateJoystick()
    }
  }

  public onpointerleave(e: PointerEvent, hasFocus: boolean): void {
    this.joystick.button0 = false
    this.joystick.button1 = false
    if (hasFocus) {
      this.updateJoystick()
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
    this.appleMachine.setJoystickValues(this.joystick)
  }
}

//------------------------------------------------------------------------------
