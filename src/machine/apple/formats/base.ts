
import { CoordinateInfo } from "../../../display/display"
import { DisplayFormat } from "../../../display/format"
import { Tool } from "../../../display/tools"
import { AppleMachine } from "../apple"

//------------------------------------------------------------------------------

export abstract class AppleDisplayFormat extends DisplayFormat {

  protected apple?: AppleMachine

  constructor(apple?: AppleMachine) {
    super()
    this.apple = apple
  }

  public getDisplayInfo(coordInfo: CoordinateInfo, tool: Tool, defaultStr: string): string {

    const x1 = coordInfo.start?.x ?? 0
    const y1 = coordInfo.start?.y ?? 0
    const width = coordInfo.size?.width ?? 0
    const height = coordInfo.size?.height ?? 0

    let str = defaultStr
    if (this.apple && !coordInfo.end && width == 0 && height == 0) {
      if (y1 >= 0 && y1 < this.frameSize.height && x1 >= 0 && x1 < this.frameSize.width) {
        let suffix = ""
        let address = this.calcAddress(x1, y1, this.apple.displayClock.getPageIndex())
        const byteColumn = this.calcByteColumn(x1)
        if (this.name.startsWith("dlores") || this.name.startsWith("dhires")) {
          if (address >= 0x10000) {
            suffix = " aux"
            address -= 0x10000
          } else {
            suffix = " main"
          }
        }
        str += `<br>Address: $${address.toString(16).toUpperCase()}` + suffix
        str += `<br>Column:\xa0\xa0${byteColumn}`
      }
    }

    return str
  }
}

//------------------------------------------------------------------------------
