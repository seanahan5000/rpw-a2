
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

const NibbleTrackSize = 6656
const NibbleFileSize = 35 * NibbleTrackSize

export class DiskImage {
  protected fullData: Uint8Array
  private diskData: Uint8Array
  public imageOrder: SectorOrder = SectorOrder.Unknown
  public dosOrder: SectorOrder = SectorOrder.Unknown
  protected workingData?: Uint8Array
  public isReadOnly: boolean
  public isNibFormat: boolean
  private tmg?: TwoMGHeader

  constructor(typeName: string, data: Uint8Array, isReadOnly = false) {
    this.fullData = data
    this.diskData = this.fullData
    this.isReadOnly = isReadOnly
    this.isNibFormat = false
    switch (typeName) {
      case "dsk":
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
          this.isReadOnly = this.tmg.dos33Locked
        } else if (this.tmg.imageFormat == TwoMGFormat.Prodos) {
          this.imageOrder = SectorOrder.Prodos
          this.dosOrder = SectorOrder.Prodos
        } else if (this.tmg.imageFormat == TwoMGFormat.Nib) {
          this.isNibFormat = true
        }
        const offset = this.tmg.dataOffset
        const length = this.tmg.dataSize
        this.diskData = this.fullData.subarray(offset, offset + length)
        break
      case "nib":
        this.isNibFormat = true
        break
      default:
        throw new Error(`Unknown disk volume type "${typeName}"`)
    }

    if (this.isNibFormat) {
      if (this.diskData.length != NibbleFileSize) {
        throw new Error(`Unexpected data size (expected ${NibbleFileSize}, got ${this.diskData.length})`)
      }
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
    if (this.isNibFormat) {
      throw new Error("readTrackSector not allowed on nibble image")
    }
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
    if (this.isNibFormat) {
      throw new Error("readTrackSector not allowed on nibble image")
    }
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

  //------------------------------------
  // image nibblizing
  //------------------------------------

  private buffer342?: number[]

  public nibblize(volume?: number): Uint8Array {

    if (!this.isNibFormat && this.dosOrder == SectorOrder.Unknown) {
      deduceFormat(this)
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    if (this.isNibFormat) {
      return this.workingData
    }

    let linearToDos: number[]
    if (this.dosOrder == SectorOrder.Prodos) {
      linearToDos = this.linearToProdos
      if (volume == undefined) {
        volume = 254
      }
    } else {
      linearToDos = this.linearToDos33
      if (volume == undefined) {
        if (this.tmg) {
          volume = this.tmg.dos33Volume
        } else {
          volume = 254
        }
      }
    }

    if (!this.buffer342) {
      this.buffer342 = new Array(342)
    }

    const outData = new Uint8Array(NibbleFileSize)

    let offset = 0
    for (let t = 0; t < 35; t += 1) {
      const trackData = outData.subarray(offset, offset + NibbleTrackSize)
      this.nibbilizeTrack(volume, t, trackData, linearToDos)
      offset += NibbleTrackSize
    }

    return outData
  }

  private nibbilizeTrack(volume: number, track: number, trackData: Uint8Array, linearToDos: number[]) {

    const dstBuffer = trackData
    let dstOffset = this.writeSync(48, dstBuffer, 0)

    for (let physSector = 0; physSector < 16; physSector += 1) {

      dstBuffer[dstOffset++] = 0xD5
      dstBuffer[dstOffset++] = 0xAA
      dstBuffer[dstOffset++] = 0x96
      dstOffset = this.writeOddEven(volume, dstBuffer, dstOffset)
      dstOffset = this.writeOddEven(track, dstBuffer, dstOffset)
      dstOffset = this.writeOddEven(physSector, dstBuffer, dstOffset)
      dstOffset = this.writeOddEven(volume ^ track ^ physSector, dstBuffer, dstOffset)
      dstBuffer[dstOffset++] = 0xDE
      dstBuffer[dstOffset++] = 0xAA
      dstBuffer[dstOffset++] = 0xEB

      dstOffset = this.writeSync(6, dstBuffer, dstOffset)

      dstBuffer[dstOffset++] = 0xD5
      dstBuffer[dstOffset++] = 0xAA
      dstBuffer[dstOffset++] = 0xAD

      const offset = (track * 16 + linearToDos[physSector]) * 256
      const sectorData = this.workingData!.subarray(offset, offset + 256)
      dstOffset = this.writeSectorData(sectorData, dstBuffer, dstOffset)

      dstBuffer[dstOffset++] = 0xDE
      dstBuffer[dstOffset++] = 0xAA
      dstBuffer[dstOffset++] = 0xEB

      dstOffset = this.writeSync(27, dstBuffer, dstOffset)
    }
  }

  private writeSync(count: number, buffer: Uint8Array, offset: number): number {
    const endOffset = offset + count
    buffer.fill(0xFF, offset, endOffset)
    return endOffset
  }

  private writeOddEven(value: number, buffer: Uint8Array, offset: number): number {
    buffer[offset++] = (value >> 1) | 0xAA
    buffer[offset++] = (value >> 0) | 0xAA
    return offset
  }

  private writeSectorData(sectorData: Uint8Array, dstBuffer: Uint8Array, dstOffset: number): number {

    this.buffer342!.fill(0)

    let j = 256 + 2
    for (let i = 256; --i >= 0; ) {
      let byte = sectorData[i]
      let outBits = this.buffer342![j]

      outBits <<= 1
      outBits |= byte & 1
      byte >>= 1

      outBits <<= 1
      outBits |= byte & 1
      byte >>= 1

      this.buffer342![j] = outBits
      this.buffer342![i ^ 255] = byte

      if (++j == 342) {
        j = 256
      }
    }

    let last = 0
    for (let i = 342; --i >= 0; ) {
      const value = this.buffer342![i]
      dstBuffer[dstOffset++] = DiskImage.WriteTranslateTable[value ^ last]
      last = value
    }
    dstBuffer[dstOffset++] = DiskImage.WriteTranslateTable[last]
    return dstOffset
  }

  private static readonly WriteTranslateTable = [
		0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6,
		0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3,
		0xB4, 0xB5, 0xB6, 0xB7, 0xB9, 0xBA, 0xBB, 0xBC,
		0xBD, 0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3,
		0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE,
		0xDF, 0xE5, 0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC,
		0xED, 0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6,
		0xF7, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF
  ]

  //------------------------------------
  // image denibblizing
  //------------------------------------

  private readTranslate?: Uint8Array

  // TODO: option to denibblize just a single track?
  public denibblize(nibbleData: Uint8Array) {

    if (this.isNibFormat) {
      // TODO: copy nibbleData instead?
      return
    }

    if (!this.workingData) {
      this.workingData = this.snapWorkingData()
    }

    if (!this.buffer342) {
      this.buffer342 = new Array(342)
    }

    if (!this.readTranslate) {
      this.readTranslate = new Uint8Array(256).fill(0xEE)
    }

    for (let i = 0; i < DiskImage.WriteTranslateTable.length; i += 1) {
      this.readTranslate[DiskImage.WriteTranslateTable[i]] = i
    }

    let linearToDos: number[]
    if (this.dosOrder == SectorOrder.Dos33) {
      linearToDos = this.linearToDos33
    } else {
      linearToDos = this.linearToProdos
    }

    // *** try/catch? return success boolean? ***

    let offset = 0
    for (let t = 0; t < 35; t += 1) {
      const trackData = nibbleData.subarray(offset, offset + NibbleTrackSize)
      this.denibbilizeTrack(t, trackData, linearToDos)
      offset += NibbleTrackSize
    }
  }

  private denibbilizeTrack(track: number, trackData: Uint8Array, linearToDos: number[]) {

    let offset = 0
    let sectorCount = 0
    const sectorData = new Uint8Array(256)

    while (true) {

      offset = this.findAddressHeader(trackData, offset)

      if (offset + 8 > trackData.length) {
        break
      }

      const volume = this.readEvenOdd(trackData, offset)
      offset += 2
      const strack = this.readEvenOdd(trackData, offset)
      offset += 2
      const sector = this.readEvenOdd(trackData, offset)
      offset += 2
      const checksum = this.readEvenOdd(trackData, offset)
      offset += 2
      if ((volume ^ strack ^ sector) != checksum) {
        throw new Error(`Denibblize error: Invalid address header checksum (t:${strack}, s:${sector})`)
      }
      if (strack != track) {
        throw new Error(`Denibblize error: Expected track ${track}, got ${strack}`)
      }

      // TODO: DOS doesn't check if 0xEB is valid here
      offset = this.expectValues([0xDE, 0xAA, 0xEB], trackData, offset)

      while (offset < trackData.length) {
        const value = trackData[offset]
        if (value != 0xFF) {
          break
        }
        offset += 1
      }

      offset = this.expectValues([0xD5, 0xAA, 0xAD], trackData, offset)

      if (offset + 343 > trackData.length) {
        break
      }

      let last = 0
      for (let i = 85; i >= 0; --i) {
        const value = this.readTranslate![trackData[offset++]] ^ last
        this.buffer342![256 + i] = value
        last = value
      }
      for (let i = 0; i < 256; ++i) {
        const value = this.readTranslate![trackData[offset++]] ^ last
        this.buffer342![i] = value
        last = value
      }
      last ^= this.readTranslate![trackData[offset++]]
      if (last != 0) {
        throw new Error(`Denibblize error: bad sector checksum`)
      }

      let j = 85
      for (let i = 0; i < 256; i += 1) {
        let bits = this.buffer342![256 + j]
        this.buffer342![256 + j] = bits >> 2

        let value = this.buffer342![i] << 2
        if (bits & 1) {
          value |= 2
        }
        if (bits & 2) {
          value |= 1
        }
        if (--j < 0) {
          j = 85
        }
        sectorData[i] = value
      }

      offset = this.expectValues([0xDE, 0xAA, 0xEB], trackData, offset)

      const sectorOffset = (track * 16 + linearToDos[sector]) * 256
      this.workingData!.set(sectorData, sectorOffset)
      sectorCount += 1
    }

    if (sectorCount < 16) {
      throw new Error(`Denibblize error: only ${sectorCount} sectors of 16 found`)
    }
  }

  private findAddressHeader(buffer: Uint8Array, offset: number): number {
    while (true) {
      while (true) {
        if (offset >= buffer.length) {
          return offset
        }
        if (buffer[offset++] == 0xD5) {
          break
        }
      }
      if (offset < buffer.length) {
        if (buffer[offset++] != 0xAA) {
          continue
        }
      }
      if (offset < buffer.length) {
        if (buffer[offset++] != 0x96) {
          continue
        }
      }
      break
    }
    return offset
  }

  private readEvenOdd(buffer: Uint8Array, offset: number): number {
    const value0 = buffer[offset + 0]
    const value1 = buffer[offset + 1]
    return ((value0 << 1) & 0xAA) | (value1 & 0x55)
  }

  private expectValues(expected: number[], buffer: Uint8Array, offset: number): number {
    if (offset + expected.length <= buffer.length) {
      for (const expect of expected) {
        const got = buffer[offset++]
        if (expect != got) {
          throw new Error(`Denibblize error: expected 0x${expect.toString(16)}, got 0x${got.toString(16)}`)
        }
      }
    }
    return offset
  }
}

//------------------------------------------------------------------------------

function deduceFormat(image: DiskImage) {
  if (image.imageOrder == SectorOrder.Unknown) {

    const dosOrders   = [ SectorOrder.Dos33, SectorOrder.Prodos, SectorOrder.Prodos, SectorOrder.Unknown ]
    const imageOrders = [ SectorOrder.Dos33, SectorOrder.Dos33,  SectorOrder.Prodos, SectorOrder.Unknown ]

    for (let i = 0; i < dosOrders.length; i += 1) {
      image.revertChanges()
      image.dosOrder = dosOrders[i]
      image.imageOrder = imageOrders[i]
      if (image.dosOrder == SectorOrder.Dos33) {
        if (checkDos33Image(image)) {
          return
        }
      } else if (image.dosOrder == SectorOrder.Prodos) {
        if (checkProdosImage(image)) {
          return
        }
      // } else {
      //   throw new Error(`Unknown disk volume sector order`)
      }
    }

    // if format can't be deduced, just assume DOS 3.3
    image.revertChanges()
    image.dosOrder = SectorOrder.Dos33
    image.imageOrder = SectorOrder.Dos33
  }
}

function checkDos33Image(image: DiskImage): boolean {
  try {
    const vtoc = image.readTrackSector(17, 0)
    if (vtoc.data[0x27] == 122) {
      const catTrack = vtoc.data[0x01]
      const catSector = vtoc.data[0x02]
      const numTracks = vtoc.data[0x34]
      const numSectors = vtoc.data[0x35]
      if (numTracks <= 35) {
        if (numSectors == 16 || numSectors == 13) {
          if (catTrack < numTracks && catSector < numSectors) {
            return true
          }
        }
      }
    }
  } catch (e: any) {
  }
  return false
}

function checkProdosImage(image: DiskImage): boolean {
  try {
    const block = image.readBlock(2)
    if (block.data[0] == 0x00 && block.data[1] == 0x00) {
      const entryLength = block.data[0x1F + 4]
      const entriesPerBlock = block.data[0x20 + 4]
      const entriesSize = entryLength * entriesPerBlock
      if (entriesSize > 0 && entriesSize <= 512) {
        // first entry must be allocated
        if ((block.data[0x00 + 4] & 0xF0) == 0xF0) {
          if ((block.data[0x00 + 4] & 0x0F) != 0) {
            // name starts with A->Z
            const char = block.data[0x01 + 4]
            if (char >= 0x41 && char <= 0x5A) {
              return true
            }
          }
        }
      }
    }
  } catch (e: any) {
  }
  return false
}

//------------------------------------------------------------------------------
