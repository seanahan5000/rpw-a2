
export type BlockData = {
  index: number
  data: Uint8Array
}

export type SectorData = {
  track: number
  index: number     // not "sector" to avoid "sector.sector"
  data: Uint8Array
}

//------------------------------------------------------------------------------

enum TwoMGFormat {
  Dos33  = 0,
  Prodos = 1,
  Nib    = 2
}

export class TwoMGHeader {
  private data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  public verify() {
    this.check(this.id == "2IMG",
      `Invalid .2mg id "${this.id}"`)
    // NOTE: some images have the headerSize set to 52 instead of 64, so permit both
    this.check(this.headerSize == 64 || this.headerSize == 52,
      `Unexpected .2mg header size: ${this.headerSize}`)
    // NOTE: some images incorrectly have the version number set
    //  to 0 instead of 1, so permit that here
    this.check(this.versionNumber <= 1,
      `Unexpected .2mg version number: ${this.versionNumber}`)
    if (this.imageFormat == TwoMGFormat.Dos33) {
      this.check(this.dataSize == 143360,
        `Unexpected .2mg DOS 3.3 data size: ${this.dataSize}`)
    } else if (this.imageFormat == TwoMGFormat.Prodos) {
      this.check(this.dataSize == this.prodosBlocks * 512,
        `.2mg data size ${this.dataSize} != prodos blocks * 512 ${this.prodosBlocks * 512}`)
    } else if (this.imageFormat == TwoMGFormat.Nib) {
      // TODO: more here
    } else {
      this.check(this.imageFormat == 1,
        `Unexpected .2mg image format: ${this.imageFormat}`)
    }
  }

  public format() {
    this.data.fill(0)
    this.data.set([0x32, 0x49, 0x4D, 0x47], 0x00)   // "2IMG"
    this.data.set([0x52, 0x50, 0x57, 0x41], 0x04)   // "RPWA"
    this.data.set([0x40, 0x00], 0x08)               // header size
    this.data.set([0x01, 0x00], 0x0A)               // version 1
    this.data.set([0x01, 0x00, 0x00, 0x00], 0x0C)   // 01=Prodos
    this.data.set([0x40, 0x00, 0x00, 0x00], 0x18)   // offset to disk data
    const dataSize = this.data.length - 64
    this.dataSize = dataSize
    this.prodosBlocks = Math.floor(dataSize / 512)
  }

  public get id(): string {
    const nameBytes = this.data.subarray(0, 4)
    return String.fromCharCode(...nameBytes)
  }

  public get creator(): string {
    const nameBytes = this.data.subarray(4, 8)
    return String.fromCharCode(...nameBytes)
  }

  public get headerSize(): number {
    return this.data[0x08] + (this.data[0x09] << 8)
  }

  public get versionNumber(): number {
    return this.data[0x0A] + (this.data[0x0B] << 8)
  }

  public get imageFormat(): number {
    return this.data[0x0C] + (this.data[0x0D] << 8) +
      (this.data[0x0E] << 16) + (this.data[0x0F] << 24)
  }

  public get dos33Flags(): number {
    return this.data[0x10] + (this.data[0x11] << 8) +
      (this.data[0x12] << 16) + (this.data[0x13] << 24)
  }

  public get dos33Locked(): boolean {
    return (this.data[0x13] & 0x80) != 0
  }

  public get dos33Volume(): number {
    if (this.data[0x11] & 0x01) {
      return this.data[0x10]
    }
    return 254
  }

  public get prodosBlocks(): number {
    return this.data[0x14] + (this.data[0x15] << 8) +
      (this.data[0x16] << 16) + (this.data[0x17] << 24)
  }

  private set prodosBlocks(value: number) {
    this.data[0x14] = (value >>  0) & 0xff
    this.data[0x15] = (value >>  8) & 0xff
    this.data[0x16] = (value >> 16) & 0xff
    this.data[0x17] = (value >> 24) & 0xff
  }

  public get dataOffset(): number {
    return this.data[0x18] + (this.data[0x19] << 8) +
      (this.data[0x1A] << 16) + (this.data[0x1B] << 24)
  }

  public get dataSize(): number {
    let value = this.data[0x1C] + (this.data[0x1D] << 8) +
      (this.data[0x1E] << 16) + (this.data[0x1F] << 24)
    // NOTE: some images incorrectly leave dataSize 0
    if (value == 0) {
      value = this.prodosBlocks * 512
    }
    return value
  }

  private set dataSize(value: number) {
    this.data[0x1C] = (value >>  0) & 0xff
    this.data[0x1D] = (value >>  8) & 0xff
    this.data[0x1E] = (value >> 16) & 0xff
    this.data[0x1F] = (value >> 24) & 0xff
  }

  private check(test: boolean, message: string) {
    if (!test) {
      throw new Error(message)
    }
  }
}

//------------------------------------------------------------------------------

export enum SectorOrder {
  Unknown = 0,
  Dos33,
  Prodos
}

export class DiskImage {
  protected fullData: Uint8Array
  private diskData: Uint8Array
  public imageOrder: SectorOrder = SectorOrder.Unknown
  public dosOrder: SectorOrder = SectorOrder.Unknown
  protected workingData?: Uint8Array
  protected isReadOnly: boolean
  private tmg?: TwoMGHeader

  constructor(typeName: string, data: Uint8Array, isReadOnly = false) {
    this.fullData = data
    this.diskData = this.fullData
    this.isReadOnly = isReadOnly
    switch (typeName) {
      case "dsk":
        this.imageOrder = SectorOrder.Unknown
        this.dosOrder = SectorOrder.Unknown
        break
      case "do":
        this.imageOrder = SectorOrder.Dos33
        this.dosOrder = SectorOrder.Dos33
        break
      case "po":
      case "hdv":
        this.imageOrder = SectorOrder.Prodos
        this.dosOrder = SectorOrder.Prodos
        break
      case "2mg":
        this.tmg = new TwoMGHeader(this.fullData)
        this.tmg.verify()
        if (this.tmg.imageFormat == TwoMGFormat.Dos33) {
          this.imageOrder = SectorOrder.Dos33
          this.dosOrder = SectorOrder.Dos33
          // TODO: should the volume's lock be respected here?
          this.isReadOnly = this.tmg.dos33Locked
        } else if (this.tmg.imageFormat == TwoMGFormat.Prodos) {
          this.imageOrder = SectorOrder.Prodos
          this.dosOrder = SectorOrder.Prodos
          // TODO: anything else?
        } else if (this.tmg.imageFormat == TwoMGFormat.Nib) {
          throw new Error(".2mg NIB files not supported")
        }
        const offset = this.tmg.dataOffset
        const length = this.tmg.dataSize
        this.diskData = this.fullData.subarray(offset, offset + length)
        break
      default:
        throw new Error(`Unknown disk volume type "${typeName}"`)
    }
  }

  public getByteSize(): number {
    return this.diskData.length
  }

  public getBlockCount(): number {
    if (this.diskData.length % 512 != 0) {
      // TODO: investigate disk images that have a non-512 byte multiple length
      //  (somewhat common in Asimov images)
      // console.log(this.diskData.length % 512)
    }
    return Math.floor(this.diskData.length / 512)
  }

  // used by Dos 3.3

  public readTrackSector(t: number, s: number): SectorData {
    if (this.dosOrder != SectorOrder.Dos33) {
      throw new Error("readTrackSector not allowed on Prodos image")
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    const offset = (t * 16 + s) * 256
    if (offset >= this.workingData.length) {
      throw new Error(`readTrackSector of track ${t} sector ${s} failed`)
    }
    return { track: t, index: s, data: this.workingData.subarray(offset, offset + 256) }
  }

  // used by Prodos

  public readBlock(index: number): BlockData {
    if (this.dosOrder != SectorOrder.Prodos) {
      throw new Error("readBlock not allowed on DOS 3.3 image")
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    const offset = index * 512
    if (offset >= this.workingData.length) {
      throw new Error(`readBlock of block ${index} failed`)
    }
    return { index, data: this.workingData.subarray(offset, offset + 512) }
  }

  private readonly dos33ToLinear  = [ 0, 13, 11, 9, 7, 5, 3, 1, 14, 12, 10, 8, 6, 4, 2, 15 ]
  private readonly prodosToLinear = [ 0, 2, 4, 6, 8, 10, 12, 14, 1, 3, 5, 7, 9, 11, 13, 15 ]
  private readonly linearToDos33  = [ 0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15 ]
  private readonly linearToProdos = [ 0, 8, 1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15 ]

  private snapWorkingData(): Uint8Array {
    const workingData = new Uint8Array(this.diskData.length)
    if (this.imageOrder == this.dosOrder) {
      workingData.set(this.diskData)
    } else if (this.imageOrder == SectorOrder.Dos33) {
      this.deinterleaveTracks(this.diskData, workingData, this.prodosToLinear, this.linearToDos33)
    } else if (this.imageOrder == SectorOrder.Prodos) {
      this.deinterleaveTracks(this.diskData, workingData, this.dos33ToLinear, this.linearToProdos)
    } else {
      throw new Error("Unknown disk sector format")
    }
    return workingData
  }

  public commitChanges(): void {
    if (this.workingData) {
      if (!this.isReadOnly) {
        if (this.imageOrder == this.dosOrder) {
          this.diskData.set(this.workingData)
        } else if (this.imageOrder == SectorOrder.Dos33) {
          this.interleaveTracks(this.workingData, this.diskData, this.prodosToLinear, this.linearToDos33)
        } else if (this.imageOrder == SectorOrder.Prodos) {
          this.interleaveTracks(this.workingData, this.diskData, this.dos33ToLinear, this.linearToProdos)
        } else {
          throw new Error("Unknown disk sector format")
        }
      }
      this.workingData = undefined
    }
  }

  public revertChanges(): void {
    this.workingData = undefined
  }

  private deinterleaveTracks(srcData: Uint8Array, dstData: Uint8Array, toLinear: number[], toTarget: number[]) {
    let offset = 0
    for (let t = 0; t < 35; t += 1) {
      for (let s = 0; s < 16; s += 1) {
        const srcOffset = offset + toTarget[toLinear[s]] * 256
        const dstOffset = offset + s * 256
        const sectorData = srcData.subarray(srcOffset, srcOffset + 256)
        dstData.set(sectorData, dstOffset)
      }
      offset += 16 * 256
    }
  }

  private interleaveTracks(srcData: Uint8Array, dstData: Uint8Array, toLinear: number[], toTarget: number[]) {
    let offset = 0
    for (let t = 0; t < 35; t += 1) {
      for (let s = 0; s < 16; s += 1) {
        const srcOffset = offset + s * 256
        const dstOffset = offset + toTarget[toLinear[s]] * 256
        const sectorData = srcData.subarray(srcOffset, srcOffset + 256)
        dstData.set(sectorData, dstOffset)
      }
      offset += 16 * 256
    }
  }
}

//------------------------------------------------------------------------------
