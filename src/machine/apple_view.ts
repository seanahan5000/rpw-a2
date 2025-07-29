import { Machine, Apple, FileDiskImage } from "./machine"
import { DisplayView, DisplaySource } from "../display/display_view"
// import "./apple_view.css"
// import "../display/display_view.css"

const DriveImages: string[] = [
  require("../../media/icon-drive-off-empty.svg"),
  require("../../media/icon-drive-on-empty.svg"),
  require("../../media/icon-drive-off.svg"),
  require("../../media/icon-drive-on.svg")
]

// https://www.svgrepo.com/collection/adwaita-tiny-circular-icons
const IconImages: string[] = [
  require("../../media/icon-reboot.svg"),
  require("../../media/icon-speaker-off.svg"),
  require("../../media/icon-speaker-on.svg"),
  // require("../../media/icon-screenshot.svg"),
  require("../../media/icon-paint.svg"),
  require("../../media/icon-pause.svg"),
  require("../../media/icon-resume.svg"),
  require("../../media/icon-previous.svg"),
  require("../../media/icon-next.svg")
]

const ScreenIconImages: string[] = [
  require("../../media/icon-video-visible.svg"),
  require("../../media/icon-video-active.svg"),
  require("../../media/icon-video-primary.svg"),
  require("../../media/icon-video-secondary.svg"),
]

//------------------------------------------------------------------------------

export enum AppleIcon {
  Drive0 = 0,
  Drive1 = 1,
  Reboot = 2,
  Pause = 3,
  Sound  = 4,
  Screen = 5,
  Snapshot = 6,
  Previous = 7,
  Next = 8
}

type Icon = {
  div: HTMLDivElement
  image: HTMLImageElement
  help: HTMLDivElement

  // AppleIcon.Screen only
  page?: HTMLDivElement
}

export class AppleView {

  private topDiv: HTMLDivElement
  private icons: Icon[] = []

  constructor(
      parent: HTMLElement,
      private machine: Machine,
      displayView: DisplayView,
      clickHook?: (index: number) => void) {

    this.topDiv = <HTMLDivElement>document.createElement("div")
    this.topDiv.classList.add("apple-div")
    parent.appendChild(this.topDiv)

    for (let i = 0; i < 9; i += 1) {
      const iconDiv = <HTMLDivElement>document.createElement("div")
      iconDiv.classList.add("apple-icon")
      iconDiv.id = i.toString()

      const iconImage = <HTMLImageElement>document.createElement("img")
      iconDiv.appendChild(iconImage)

      const iconHelp = document.createElement("div")
      iconHelp.classList.add("apple-help")

      const icon: Icon = { div: iconDiv, image: iconImage, help: iconHelp }
      this.icons.push(icon)

      iconDiv.addEventListener("pointerenter", () => {
        if (!iconDiv.classList.contains("drag")) {
          iconDiv.classList.add("hilite")
        }
      })

      iconDiv.addEventListener("pointerleave", () => {
        iconDiv.classList.remove("hilite")
      })

      if (i < 2) {
        iconDiv.classList.add("apple-drive")

        iconDiv.addEventListener("dragenter", (e: DragEvent) => {
          e.preventDefault()
          iconDiv.classList.add("drag")
        })

        iconDiv.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault()
          e.stopPropagation()
          iconDiv.classList.add("drag")
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "link"
          }
        })

        iconDiv.addEventListener("dragleave", (e: DragEvent) => {
          iconDiv.classList.remove("drag")
        })

        iconDiv.addEventListener("dragend", (e: DragEvent) => {
          iconDiv.classList.remove("drag")
        })

        iconDiv.addEventListener("drop", (e: DragEvent) => {
          e.preventDefault()
          iconDiv.classList.remove("drag")
          this.onDriveDrop(i, e)
          displayView.focus()
        })

        iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
          e.preventDefault()
          if (clickHook) {
            clickHook(i)
          } else {
            this.onDriveClick(i, e)
            displayView.focus()
          }
        })

        iconDiv.appendChild(iconHelp)
        this.setHoverElement(iconDiv, iconHelp)

        this.machine.disk2Card.setListener(i, (diskImage, isActive) => {
          const driveIndex = i
          this.onDriveChanged(driveIndex, iconImage, iconHelp, diskImage, isActive)
        })
      } else {

        const iconPageWrapper = <HTMLDivElement>document.createElement("div")
        iconPageWrapper.classList.add("apple-icon-page-wrapper")
        iconDiv.appendChild(iconPageWrapper)

        const iconPage = <HTMLDivElement>document.createElement("div")
        iconPage.classList.add("apple-icon-page")
        iconPageWrapper.appendChild(iconPage)

        icon.page = iconPage

        switch (i) {
          case AppleIcon.Reboot:
            iconDiv.classList.add("apple-reboot")
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              // NOTE: preventDefault here and below prevent focus change
              e.preventDefault()
              this.machine.reset(false)
              // force reboot
              // TODO: option to reset project instead?
              this.machine.write(0x3f3, 0, 0)
              this.machine.write(0x3f4, 0, 0)
              if (!e.ctrlKey) {
                this.machine.clock.start()
              }
              displayView.focus()
            })
            iconImage.src = IconImages[0]
            iconHelp.innerHTML = "Reboot" //"<br>(Use control key to stop CPU)"
            break

          case AppleIcon.Sound:
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault()
              machine.speaker.isEnabled = !machine.speaker.isEnabled
              iconImage.src = IconImages[machine.speaker.isEnabled ? 2 : 1]
              displayView.focus()
            })
            iconImage.src = IconImages[1]
            iconHelp.textContent = "Enable/disable speaker sound"
            break

          case AppleIcon.Screen:
            iconDiv.classList.add("apple-screen")
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault()
              displayView.nextDisplaySource(e.shiftKey)
              displayView.focus()
            })
            displayView.setSourceListener((source: DisplaySource, isPaged: boolean, pageIndex: number) => {
              this.updateScreenInfo(source, isPaged, pageIndex)
            })
            displayView.setDisplaySource(DisplaySource.Visible)
            break

          case AppleIcon.Snapshot:
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault()
              // TODO: call clickHook for snapshot instead?
              // if (clickHook) {
              //   clickHook(i)
              // } else {
                const isEditing = displayView.toggleEditMode()
                this.topDiv.style.marginLeft = isEditing ? "72px" : "0px"
              // }
              displayView.focus()
            })
            iconImage.src = IconImages[3]
            // iconHelp.textContent = "Snapshot screen for editing"
            iconHelp.textContent = "Edit display"
            break

          case AppleIcon.Pause:
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault()
              if (machine.clock.isRunning) {
                machine.clock.stop("requested")
              } else {
                machine.clock.start()
              }
              iconImage.src = IconImages[machine.clock.isRunning ? 4 : 5]
              displayView.focus()
            })
            machine.clock.on("start", () => {
              iconImage.src = IconImages[4]
              displayView.focus()
            })
            machine.clock.on("stop", () => {
              iconImage.src = IconImages[5]
            })
            iconImage.style.scale = "80%"
            iconImage.src = IconImages[machine.clock.isRunning ? 4 : 5]
            iconHelp.textContent = "Pause/resume"
            break

          case AppleIcon.Previous:
          case AppleIcon.Next:
            let firstTimerId: NodeJS.Timeout | undefined
            let repeatTimerId: NodeJS.Timeout | undefined
            const forward = (i == AppleIcon.Next)
            iconDiv.addEventListener("mousedown", (e: MouseEvent) => {
              e.preventDefault()
              if (machine.advanceState(forward, e.metaKey)) {
                machine.clock.stop("requested")
              }
              firstTimerId = setTimeout(() => {
                repeatTimerId = setInterval(() => {
                  if (machine.advanceState(forward, false)) {
                    machine.clock.stop("requested")
                  }
                }, 100)
              }, 500)
            })
            iconDiv.addEventListener("mouseup", (e: MouseEvent) => {
              clearTimeout(firstTimerId)
              clearInterval(repeatTimerId)
            })
            iconImage.src = IconImages[forward ? 7 : 6]
            this.updateStepInfo(icon, forward)

            machine.clock.on("start", () => {
              this.updateStepInfo(icon, forward)
            })
            machine.clock.on("stop", () => {
              this.updateStepInfo(icon, forward)
            })
            break
        }
        iconDiv.appendChild(iconHelp)
        this.setHoverElement(iconDiv, iconHelp)
      }

      this.topDiv.appendChild(iconDiv)
    }
  }

  private updateScreenInfo(source: DisplaySource, isPaged: boolean, pageIndex: number) {
    const icon = this.icons[AppleIcon.Screen]
    icon.page = icon.page!
    icon.image.src = ScreenIconImages[source]
    let helpText = "Change page shown<br>"
    switch (source) {
      case DisplaySource.Visible:
        icon.page.textContent = ""
        if (isPaged) {
          helpText += `(Now showing visible page ${pageIndex + 1})`
          icon.page.textContent = (pageIndex + 1).toString()
        } else {
          icon.page.textContent = ""
        }
        break
      case DisplaySource.Active:
        icon.page.textContent = ""
        if (isPaged) {
          helpText += `(Now showing written-to page ${pageIndex + 1})`
          icon.page.textContent = (pageIndex + 1).toString()
        } else {
          icon.page.textContent = ""
        }
        break
      case DisplaySource.Primary:
        helpText += "(Now showing primary page)"
        icon.page.textContent = ""
        break
      case DisplaySource.Secondary:
        helpText += "(Now showing secondary page)"
        icon.page.textContent = ""
        break
    }
    icon.help.innerHTML = helpText
    icon.help.style.marginTop = "-42px"
  }

  private updateStepInfo(icon: Icon, forward: boolean) {
    const isRunning = this.machine.clock.isRunning
    let helpText = `${forward ? "Next" : "Previous"} snapshot`
    if (!isRunning) {
      const result = this.machine.getStateInfo()
      if (result.count > 0) {
        helpText += `<br>(Now ${result.index}/${result.count})`
      }
    }
    icon.help.innerHTML = helpText
  }

  public setVisible(visible: boolean) {
    this.topDiv.style.display = visible ? "block" : "none"
  }

  public update(isRunning: boolean) {
    // TODO: update non-drive info
  }

  private async onDriveDrop(driveIndex: number, e: DragEvent) {
    if (e.dataTransfer) {
      for (const item of Array.from(e.dataTransfer.items)) {
        const fsHandle = await (item as any).getAsFileSystemHandle()
        if (fsHandle) {
          const image = await this.openDiskFile(fsHandle)
          if (image) {
            this.machine.disk2Card.setImage(driveIndex, image)
            break
          }
        }
      }
    }
  }

  //----------------------------------------------------------------------------

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
              this.machine.disk2Card.setImage(driveIndex, image)
              return
            }
          }
        } catch (e) {
          return // cancel
        }
      }
    }
  }

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
      // NOTE: For now, make all disk images read-only.
      //  If the AppleView is moved between columns or into a floating window
      //  with VSCode, the emulator instance is serialized and then recreated,
      //  losing the original file handle.  Even if the full path is still
      //  available, the webview may not have access to that path anymore.
      const isReadOnly = true
      return new FileDiskImage(fileName, data, isReadOnly)
    }
  }

  //----------------------------------------------------------------------------

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

  private hoverShortTimerId?: NodeJS.Timeout
  private hoverLongTimerId?: NodeJS.Timeout
  private hoverVisibleDiv?: HTMLElement

  private setHoverElement(parent: HTMLElement, child: HTMLElement) {

    child.classList.add("help")

    parent.addEventListener("mousedown", () => {
      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      // clear short timer
      if (this.hoverShortTimerId) {
        clearTimeout(this.hoverShortTimerId)
        this.hoverShortTimerId = undefined
      }
      // hide div
      if (this.hoverVisibleDiv) {
        this.hoverVisibleDiv.style.visibility = "hidden"
        this.hoverVisibleDiv.style.opacity = "0"
        this.hoverVisibleDiv = undefined
      }
    })

    parent.addEventListener("pointerenter", () => {
      if (parent.classList.contains("drag")) {
        parent.classList.add("hilite")
      }

      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      if (this.hoverShortTimerId) {
        clearTimeout(this.hoverShortTimerId)
        this.hoverShortTimerId = undefined
        // show hover div
        this.hoverVisibleDiv = child
        this.hoverVisibleDiv.style.visibility = "visible"
        this.hoverVisibleDiv.style.opacity = "1"
        return
      }
      // set long timer
      this.hoverLongTimerId = setTimeout(() => {
        // show hover div
        this.hoverVisibleDiv = child
        this.hoverVisibleDiv.style.visibility = "visible"
        this.hoverVisibleDiv.style.opacity = "1"
      }, 1000)
    })

    parent.addEventListener("pointerleave", () => {
      // clear long timer
      if (this.hoverLongTimerId) {
        clearTimeout(this.hoverLongTimerId)
        this.hoverLongTimerId = undefined
      }
      // if hover div visible
      if (this.hoverVisibleDiv) {
        // hide it
        this.hoverVisibleDiv.style.visibility = "hidden"
        this.hoverVisibleDiv.style.opacity = "0"
        this.hoverVisibleDiv = undefined
        // start short timer
        this.hoverShortTimerId = setTimeout(() => {
          // clear short timer
          this.hoverShortTimerId = undefined
        }, 100)
      }
    })
  }
}

//------------------------------------------------------------------------------

import { SocketDebugger } from "./debugger"

// TODO: how does this get shutdown notification?

// TODO: add disk images?
export type AppleParams = {
  machine?: string
  debugPort?: number
  stopOnEntry?: boolean
  saveState?: any
}

export class AppleEmulator {

  public topDiv: HTMLDivElement
  private debugger: SocketDebugger
  public machine: Machine
  public displayView: DisplayView
  private appleView: AppleView

  constructor(
      parent: HTMLElement | undefined,
      params: AppleParams,
      clickHook?: (index: number) => void,
      showControls: boolean = true) {

    let appleType: Apple | undefined

    if (!params.saveState) {
      let typeName: string = params.machine?.toLowerCase() ?? "iie"
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

    this.debugger = new SocketDebugger(params.debugPort)
    this.machine = new Machine(appleType)
    if (params.saveState) {
      this.machine.setState(params.saveState)
    }
    this.debugger.setMachine(this.machine)

    this.topDiv = document.createElement("div")
    parent?.appendChild(this.topDiv)

    this.displayView = new DisplayView(this.topDiv, this.machine, this.machine, !showControls)
    this.machine.setDisplayView(this.displayView)

    this.appleView = new AppleView(this.topDiv, this.machine, this.displayView, clickHook)
    this.appleView.setVisible(showControls)

    if (params.saveState) {
      // *** this.machine.clock.stop/start based on state? ***
    } else {
      this.machine.reset(true)

      const stopOnEntry = params.stopOnEntry ?? false
      if (stopOnEntry) {
        this.machine.clock.stop("launch")
      } else {
        this.machine.clock.start()
      }
    }
  }

  public close() {
    // ***
  }
}

//------------------------------------------------------------------------------
