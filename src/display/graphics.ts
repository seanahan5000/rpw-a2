
import { Point, Rect } from "../shared/types"
import { Bitmap } from "./format"

//------------------------------------------------------------------------------

// Frame or fill an ellipse into a mask bitmap, clipped to mask bounds.
//  NOTE: This is not written for speed.  For example, clipAndFillSpan is called
//  multiple times for the same scan line instead of waiting for y to change.

export function drawEllipse(rect: Rect, bitmap: Bitmap, doFill: boolean) {

  let a = rect.width - 1
  let b = rect.height - 1
  let b1 = b & 1
  let dx = 4 * (1 - a) * b * b
  let dy = 4 * (b1 + 1) * a * a
  let err = dx + dy + b1 * a * a
  let x0 = rect.x
  let x1 = rect.x + a
  let y0 = rect.y + Math.floor(b / 2)
  let y1 = y0 + b1
  a *= 8 * a
  b1 = 8 * b * b
  do {
    if (doFill) {
      clipAndFillSpan(x0, x1, y0, bitmap)
      clipAndFillSpan(x0, x1, y1, bitmap)
    } else {
      clipAndSetPixel(x1, y0, bitmap)
      clipAndSetPixel(x0, y0, bitmap)
      clipAndSetPixel(x0, y1, bitmap)
      clipAndSetPixel(x1, y1, bitmap)
    }
    const e2 = 2 * err
    if (e2 <= dy) {
      y0 -= 1
      y1 += 1
      dy += a
      err += dy
    }
    if (e2 >= dx || 2 * err > dy) {
      x0 += 1
      x1 -= 1
      dx += b1
      err += dx
    }
  } while (x0 <= x1)

  while (y1 - y0 < b) {
    if (doFill) {
      clipAndFillSpan(x0 - 1, x1 + 1, y0, bitmap)
      clipAndFillSpan(x0 - 1, x1 + 1, y1, bitmap)
    } else {
      clipAndSetPixel(x0 - 1, y0, bitmap)
      clipAndSetPixel(x1 + 1, y0, bitmap)
      clipAndSetPixel(x0 - 1, y1, bitmap)
      clipAndSetPixel(x1 + 1, y1, bitmap)
    }
    y0 -= 1
    y1 += 1
  }
}

function clipAndFillSpan(x1: number, x2Inc: number, y: number, bitmap: Bitmap) {
  if (y < 0 || y >= bitmap.height) {
    return
  }
  if (x1 < 0) {
    x1 = 0
  }
  if (x2Inc >= bitmap.width) {
    x2Inc = bitmap.width - 1
  }
  if (x1 > x2Inc) {
    return
  }
  const yoffset = y * bitmap.stride
  for (let x = x1; x <= x2Inc; x += 1) {
    bitmap.data[yoffset + x] = 0x7F
  }
}

function clipAndSetPixel(x: number, y: number, bitmap: Bitmap) {
  if (y < 0 || y >= bitmap.height) {
    return
  }
  if (x < 0 || x >= bitmap.width) {
    return
  }
  bitmap.data[y * bitmap.stride + x] = 0x7F
}

//------------------------------------------------------------------------------

type Span = {
  x1: number  // inclusive
  x2: number  // exclusive
  y: number
}

export class FloodFill {

  private mask: Bitmap
  private result: Bitmap
  private stack: Span[]

  constructor(mask: Bitmap) {
    this.mask = mask
    this.result = this.mask.format.createBitmap({x: 0, y: 0, ...mask.size})
    this.stack = []
  }

  public fill(pt: Point): Bitmap {
    let entry: Span | undefined
    entry = {
      x1: this.scanLeftToClosed(pt.x, pt.y),
      x2: this.scanRightToClosed(pt.x, pt.y),
      y: pt.y
    }
    do {
      if (this.fillSpanLeftToRight(entry.x1, entry.x2, entry.y)) {
        if (entry.y > 0) {
          this.processSpan(entry.x1, entry.x2, entry.y - 1)
        }
        if (entry.y + 1 < this.mask.height) {
          this.processSpan(entry.x1, entry.x2, entry.y + 1)
        }
      }
      entry = this.stack.pop()
    } while (entry)

    return this.result
  }

  private fillSpanLeftToRight(x1: number, x2: number, y: number): boolean {
    const offset = y * this.mask.stride
    if (this.result.data[offset + x1] == 0) {
      while (x1 < x2) {
        this.result.data[offset + x1] = 0x7F
        x1 += 1
      }
      return true
    }
    return false
  }

  private processSpan(left: number, right: number, y: number) {
    let x1
    if (this.isOpen(left, y)) {
      x1 = this.scanLeftToClosed(left, y)
    } else {
      x1 = this.scanRightToOpen(left, y, right)
      if (x1 >= right) {
        return
      }
    }
    while (true) {
      let x2 = this.scanRightToClosed(x1, y)
      this.stack.push({x1, x2, y})
      if (x2 >= right) {
        break
      }
      x1 = this.scanRightToOpen(x2, y, right)
      if (x1 >= right) {
        break
      }
    }
  }

  private isOpen(x1: number, y: number) {
    const offset = y * this.mask.stride
    return (this.mask.data[offset + x1] | this.result.data[offset + x1]) == 0
  }

  private scanLeftToClosed(x1: number, y: number) {
    const offset = y * this.mask.stride
    while (x1 > 0) {
      if ((this.mask.data[offset + x1 - 1] | this.result.data[offset + x1 - 1]) != 0) {
        break
      }
      x1 -= 1
    }
    return x1
  }

  private scanRightToClosed(x2: number, y: number) {
    const offset = y * this.mask.stride
    while (x2 < this.mask.width) {
      x2 += 1
      if ((this.mask.data[offset + x2] | this.result.data[offset + x2]) != 0) {
        break
      }
    }
    return x2
  }

  private scanRightToOpen(x1: number, y: number, right: number) {
    const offset = y * this.mask.stride
    while (x1 < right) {
      if ((this.mask.data[offset + x1] | this.result.data[offset + x1]) == 0) {
        break
      }
      x1 += 1
    }
    return x1
  }
}

//------------------------------------------------------------------------------

class Edge {
  public y1: number = 0
  public y2: number = 0
  public x1: number = 0
  public x2: number = 0
  public x: number = 0
  public dx: number = 0
}

export class Polygon {

  private edgeList: Edge[] = []
  private activeEdges: Edge[] = []

  public scanEdges(points: Point[], bitmap: Bitmap) {

    this.buildEdges(points)

    for (let y = 0; y <= bitmap.height; y += 1) {

      while (this.edgeList.length > 0 && this.edgeList[0].y1 == y) {
        const edge = this.edgeList.shift()
        this.activeEdges.push(edge!)
      }

      this.activeEdges.sort((a: Edge, b: Edge) => {
        if (a.x < b.x) {
          return -1
        } else if (a.x > b.x) {
          return 1
        } else {
          return 0
        }
      })

      let parity = 0
      let startX = 0
      for (let edge of this.activeEdges) {
        if (y != edge.y2) {
          parity ^= 1
        }
        if (parity) {
          startX = Math.floor(edge.x)
        } else {
          const endX = Math.floor(edge.x)
          const offsetY = y * bitmap.stride
          for (let x = startX; x <= endX; x += 1) {
            bitmap.data[offsetY + x] = 0x7F
          }
        }
      }

      for (let i = 0; i < this.activeEdges.length; i += 1) {
        const edge = this.activeEdges[i]
        if (edge.y2 == y + 1) {
          this.activeEdges.splice(i, 1)
          i -= 1
          continue
        }
        edge.x += edge.dx
      }
    }

    return bitmap
  }

  private buildEdges(points: Point[]) {
    this.edgeList = []
    this.activeEdges = []
    let start = points[points.length - 1]
    for (let point of points) {
      const y1 = Math.floor(start.y)
      const y2 = Math.floor(point.y)
      if (y1 != y2) {
        const edge = new Edge()
        if (y1 < y2) {
          edge.y1 = y1
          edge.y2 = y2
          edge.x1 = Math.floor(start.x)
          edge.x2 = Math.floor(point.x)
        } else {
          edge.y1 = y2
          edge.y2 = y1
          edge.x1 = Math.floor(point.x)
          edge.x2 = Math.floor(start.x)
        }
        edge.x = edge.x1
        edge.dx = (edge.x2 - edge.x1) / (edge.y2 - edge.y1)
        this.edgeList.push(edge)
      }
      start = point
    }

    this.edgeList.sort((a: Edge, b: Edge) => {
      if (a.y1 < b.y1) {
        return -1
      } else if (a.y1 > b.y1) {
        return 1
      } else {
        return 0
      }
    })
  }
}

//------------------------------------------------------------------------------

// build selection geometry from mask bitmap

export function drawMaskEdges(ctx: CanvasRenderingContext2D, mask: Bitmap, scale: Point, offset: Point) {
  const prevLine = new Uint8Array(mask.width + 1).fill(0)
  const vlinesActive = new Array(mask.width + 1).fill(-1)

  let offsetY = 0
  for (let y = 0; y <= mask.height; y += 1) {
    const isLastLine = (y == mask.height)
    let prevCol = 0
    let hlineActive = false

    for (let x = 0; x <= mask.width; x += 1) {
      const isLastCol = (x == mask.width)
      const curCol = (isLastLine || isLastCol) ? 0 : mask.data[offsetY + x]

      if (curCol != prevLine[x]) {
        if (!hlineActive) {
          ctx.moveTo(x * scale.x + offset.x, y * scale.y + offset.y)
          hlineActive = true
        }
        prevLine[x] = curCol
      } else if (hlineActive) {
        ctx.lineTo(x * scale.x + offset.x, y * scale.y + offset.y)
        hlineActive = false
      }

      if (curCol != prevCol) {
        if (vlinesActive[x] == -1) {
          vlinesActive[x] = y
        }
        prevCol = curCol
      } else if (vlinesActive[x] != -1) {
        ctx.moveTo(x * scale.x + offset.x, vlinesActive[x] * scale.y + offset.y)
        ctx.lineTo(x * scale.x + offset.x, y * scale.y + offset.y)
        vlinesActive[x] = -1
      }
    }
    offsetY += mask.stride
  }
}

//------------------------------------------------------------------------------
