
export type BlockData = {
  index: number
  data: Uint8Array
}

export class DiskImage {
  private data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  private atTrackSector(t: number, s: number): Uint8Array {
    let start = (t * 16 + s) * 256
    return this.data.subarray(start, start + 256)
  }

  // TODO: consider single index
  public readTrackSector(t: number, s: number): Uint8Array {
    let sector = new Uint8Array(256)
    let sector0 = this.atTrackSector(t, s)
    sector.set(sector0)
    return sector
  }

  public readBlock(index: number): Uint8Array {
    let block = new Uint8Array(512)
    let t = index >> 3
    let s = (index & 0x7) * 2
    let sector0 = this.atTrackSector(t, s + 0)
    let sector1 = this.atTrackSector(t, s + 1)
    block.set(sector0)
    block.set(sector1, 256)
    return block
  }
}

export class ProdosDateTime {
  year: number
  month: number
  day: number
  hours: number
  minutes: number

  constructor(date: number, time: number) {
    this.year = (date >> 9) + 1900
    this.month = (date >> 5) & 0xF
    this.day = date & 0x1F
    this.hours = (time >> 8) & 0x1F
    this.minutes = time & 0x3F
  }

  asDate(): string {
    const months = ["???",
      "JAN","FEB","MAR","APR","MAY","JUN",
      "JUL","AUG","SEP","OCT","NOV","DEC"]
    let str = this.day.toString().padStart(2, "\xa0")
    str += `-${months[this.month]}-`
    str += (this.year % 100).toString().padStart(2, "0")
    return str
  }

  asDateTime(): string {
    let str = this.asDate()
    str += " " + this.hours.toString().padStart(2, "\xa0")
    str += ":"
    str += this.minutes.toString().padStart(2, "0")
    return str
  }
}

enum StorageType {
  Seedling = 0x1,
  Sapling  = 0x2,
  Tree     = 0x3,
  Dir      = 0xD,
  SubDir   = 0xE,
  VolDir   = 0xF
}

export enum ProdosFileType {
  PTX = 0x03,    // Pascal text
  TXT = 0x04,
  BIN = 0x06,
  DIR = 0x0F,
  AWP = 0x1A,    // AppleWorks Word Processing
  BAS = 0xFC,
  VAR = 0xFD,
  REL = 0xFE,    // EDASM relocatable
  SYS = 0xFF
}

export interface FileEntry {
  name: string
  type: string
  auxType: number

  getContents(): Uint8Array
}

type ProdosDataProc = (block: Uint8Array, offset: number) => boolean
type ProdosFileProc = (fileEntry: ProdosFileEntry) => boolean

export class ProdosFileEntry implements FileEntry {
  name: string
  type: string
  auxType: number

  storageType: number
  typeByte: number
  keyPointer: number
  blocksInUse: number
  eof: number
  creation: ProdosDateTime
  version: number
  minVersion: number
  access: number
  lastMod: ProdosDateTime
  headerPointer: number

  private volume: ProdosVolume
  blockIndex: number
  entryOffset: number

  constructor(volume: ProdosVolume, blockIndex: number, block: Uint8Array, entryOffset: number) {
    this.volume = volume
    this.blockIndex = blockIndex
    this.entryOffset = entryOffset
    let entry = block.subarray(entryOffset, entryOffset + 0x27)
    this.storageType = entry[0x0] >> 4
    let nameLength = entry[0x0] & 0xf
    let nameBytes = []
    for (let i = 0; i < nameLength; i += 1) {
      nameBytes.push(entry[0x1 + i])
    }
    this.name = String.fromCharCode(...nameBytes)
    this.typeByte = entry[0x10]
    this.keyPointer = entry[0x11] + (entry[0x12] << 8)
    this.blocksInUse = entry[0x13] + (entry[0x14] << 8)
    this.eof = entry[0x15] + (entry[0x16] << 8) + (entry[0x17] << 16)
    let creationDate = entry[0x18] + (entry[0x19] << 8)
    let creationTime = entry[0x1A] + (entry[0x1B] << 8)
    this.creation = new ProdosDateTime(creationDate, creationTime)
    this.version = entry[0x1C]
    this.minVersion = entry[0x1D]
    this.access = entry[0x1E]
    this.auxType = entry[0x1F] + (entry[0x20] << 8)
    let lastModDate = entry[0x21] + (entry[0x22] << 8)
    let lastModTime = entry[0x23] + (entry[0x24] << 8)
    this.lastMod = new ProdosDateTime(lastModDate, lastModTime)
    this.headerPointer = entry[0x25] + (entry[0x26] << 8)

    this.type = ProdosFileType[this.typeByte]
    if (!this.type) {
      this.type = "$" + this.typeByte.toString(16).toUpperCase().padStart(2, "0")
    }
  }

  getContents(): Uint8Array {
    return this.volume.getFileContents(this)
  }
}

export class ProdosDirEntry {
  storageType: number
  dirName: string
  creation: ProdosDateTime
  version: number
  minVersion: number
  access: number
  entryLength: number
  entiesPerBlock: number
  fileCount: number

  // sub-directory
  parentPointer = -1
  parentEntNum = -1
  parentEntLen = -1

  // volume
  bitmapPointer = -1
  totalBlocks = -1

  private volume: ProdosVolume

  constructor(volume: ProdosVolume, entry: Uint8Array) {
    this.volume = volume
    this.storageType = entry[0x4] >> 4
    let nameLength = entry[0x4] & 0xf
    let nameBytes = []
    for (let i = 0; i < nameLength; i += 1) {
      nameBytes.push(entry[0x5 + i])
    }
    this.dirName = String.fromCharCode(...nameBytes)
    let creationDate = entry[0x1C] + (entry[0x1D] << 8)
    let creationTime = entry[0x1E] + (entry[0x1F] << 8)
    this.creation = new ProdosDateTime(creationDate, creationTime)
    this.version = entry[0x20]
    this.minVersion = entry[0x21]
    this.access = entry[0x22]
    this.entryLength = entry[0x23]
    this.entiesPerBlock = entry[0x24]
    this.fileCount = entry[0x25]

    if (this.storageType == StorageType.SubDir) {
      this.parentPointer = entry[0x27] + (entry[0x28] << 8)
      this.parentEntNum = entry[0x29]
      this.parentEntLen = entry[0x2A]
    } else if (this.storageType == StorageType.VolDir) {
      this.bitmapPointer = entry[0x27] + (entry[0x28] << 8)
      this.totalBlocks = entry[0x29] + (entry[0x2A] << 8)
    }
  }
}

export class ProdosVolume {

  readonly blockSize = 512
  readonly volumeHeaderBlock = 2
  private image: DiskImage
  private volumeDirEntry: ProdosDirEntry

  constructor(image: DiskImage) {
    this.image = image
    let block = this.image.readBlock(this.volumeHeaderBlock)
    this.volumeDirEntry = new ProdosDirEntry(this, block)
  }

  protected forEachFileBlock(fileEntry: ProdosFileEntry, dataProc: ProdosDataProc) {
    let block = this.image.readBlock(fileEntry.keyPointer)
    let length = fileEntry.eof
    let offset = 0

    if (fileEntry.storageType == StorageType.Seedling) {
      dataProc(length < this.blockSize ? block.subarray(0, length) : block, offset)
      return
    }

    let masterIndexBlock: Uint8Array | undefined
    let masterIndexOffset: number
    let indexBlock: Uint8Array | undefined
    let indexOffset: number
    if (fileEntry.storageType == StorageType.Tree) {
      masterIndexBlock = block
      masterIndexOffset = 0
      indexOffset = 256
    } else if (fileEntry.storageType == StorageType.Sapling) {
      masterIndexOffset = 256
      indexBlock = block
      indexOffset = 0
    } else {
      // TODO: report error
      return
    }

    while (length > 0) {
      if (indexOffset >= 256) {
        let masterIndex = block[masterIndexOffset] + (block[masterIndexOffset + 256] << 8)
        masterIndexOffset += 1
        if (masterIndexOffset >= 256) {
          // TODO: report error
          break
        }
        if (masterIndex != 0) {
          indexBlock = this.image.readBlock(masterIndex)
          indexOffset = 0
        } else {
          offset += this.blockSize * 256
          length -= this.blockSize * 256
          continue
        }
      }
      if (indexBlock) {
        let index = indexBlock[indexOffset] + (indexBlock[indexOffset + 256] << 8)
        if (index != 0) {
          let dataBlock = this.image.readBlock(index)
          dataProc(length < this.blockSize ? dataBlock.subarray(0, length) : dataBlock, offset)
        }
      }
      offset += this.blockSize
      length -= this.blockSize
      indexOffset += 1
    }
  }

  forEachAllocatedFile(fileProc: ProdosFileProc, dirFileEntry?: ProdosFileEntry) {
    let dirEntry: ProdosDirEntry | undefined
    let prevBlock = 0
    let nextBlock = dirFileEntry ? dirFileEntry.keyPointer : this.volumeHeaderBlock
    while (nextBlock) {
      let curBlock = nextBlock
      let blockData = this.image.readBlock(curBlock)
      let entryOffset = 4
      if (!dirEntry) {
        dirEntry = new ProdosDirEntry(this, blockData)
        entryOffset += 0x27
      }
      prevBlock = blockData[0x0] + (blockData[0x1] << 8)
      nextBlock = blockData[0x2] + (blockData[0x3] << 8)
      while (entryOffset <= this.blockSize - 0x27) {
        let fileEntry = new ProdosFileEntry(this, curBlock, blockData, entryOffset)
        if (fileEntry.storageType != 0) {
          //*** check result ***
          fileProc(fileEntry)
        }
        entryOffset += 0x27
      }
    }
  }

  private setDirty() {
    // TODO: put something behind this
  }

  //*** isFileSparse
  //*** isFileTree

  // resizeFile(entry: FileEntry, dataLength: number) {
  //   let fileEntry = entry as ProdosFileEntry
  //   if (fileEntry.storageType == StorageType.Seedling) {
  //     if (dataLength > 512) {
  //       let blocks = this.allocateBlock()
  //       if (!blocks) {
  //         //*** disk full ***
  //         return false  //***???
  //       }
  //       blocks.data[0] = fileEntry.keyPointer & 0xff
  //       blocks.data[0 + 256] = fileEntry.keyPointer >> 8
  //       fileEntry.storageType = StorageType.Sapling
  //       fileEntry.keyPointer = blocks.index
  //       this.setDirty()
  //     }
  //   }
  //   if (fileEntry.storageType == StorageType.Sapling) {
  //     if (dataLength > 256 * 512) {
  //       let blocks = this.allocateBlock()
  //       if (!blocks) {
  //         //*** disk full ***
  //         return false  //***???
  //       }
  //       blocks.data[0] = fileEntry.keyPointer & 0xff
  //       blocks.data[0 + 256] = fileEntry.keyPointer >> 8
  //       fileEntry.storageType = StorageType.Tree
  //       fileEntry.keyPointer = blocks.index
  //       this.setDirty()
  //     }
  //   }
  //
  //   //*** compute new block count
  //   //*** fail if disk full
  //   //*** copy blocks
  //   //*** mark as dirty
  // }

  private allocateBlock(): BlockData | undefined {
    let bitBlockIndex = this.volumeDirEntry.bitmapPointer
    let blockData = this.image.readBlock(bitBlockIndex)
    let index = 0
    while (index < this.volumeDirEntry.totalBlocks) {
      for (let i = 0; i < 512; i += 1) {
        if (blockData[i] == 0) {
          index += 8
          continue
        }
        let mask = 0x80
        for (let j = 0; j < 8; j += 1) {
          if (blockData[i] & mask) {
            blockData[i] &= ~mask
            this.setDirty()
            //*** force block clear here ***
            return { index: index, data: this.image.readBlock(index) }
          }
          mask >>= 1
          index += 1
        }
      }
    }
  }

  private freeBlock(index: number) {
    // 512 bytes * 8 blocks (9 + 3 bits)
    let bitBlockIndex = this.volumeDirEntry.bitmapPointer
    let blockData = this.image.readBlock(bitBlockIndex + index >> 12)
    blockData[index >> 3] |= 0x80 >> (index & 7)
    this.setDirty()
  }

  private freeBlockOfBlocks(index: number) {
    let blocksData = this.image.readBlock(index)
    for (let i = 0; i < 256; i += 1) {
      let subIndex = blocksData[i] + (blocksData[i + 256] << 8)
      if (subIndex) {
        this.freeBlock(subIndex)
      }
    }
    this.freeBlock(index)
  }

  freeFile(entry: FileEntry) {
    let fileEntry = entry as ProdosFileEntry
    if (fileEntry.storageType == StorageType.Seedling) {
      this.freeBlock(fileEntry.keyPointer)
    } else if (fileEntry.storageType == StorageType.Sapling) {
      this.freeBlockOfBlocks(fileEntry.keyPointer)
    } else if (fileEntry.storageType == StorageType.Tree) {
      let blocksData = this.image.readBlock(fileEntry.keyPointer)
      for (let i = 0; i < 256; i += 1) {
        let subIndex = blocksData[i] + (blocksData[i + 256] << 8)
        if (subIndex) {
          this.freeBlockOfBlocks(subIndex)
        }
      }
      this.freeBlock(fileEntry.keyPointer)
    } else {
      return
    }
    let blockData = this.image.readBlock(fileEntry.blockIndex)
    blockData[fileEntry.entryOffset + 0x0] = 0
  }

  getFileContents(entry: FileEntry): Uint8Array {
    let fileEntry = entry as ProdosFileEntry
    // TODO: consider caching contents in the FileEntry
    // TODO: validate eof before allocating
    // TODO: handle sparse files?
    let offset = 0
    let length = fileEntry.eof
    let fileData = new Uint8Array(length)
    this.forEachFileBlock(fileEntry, (blockData: Uint8Array, offset: number) => {
      fileData.set(blockData, offset)
      return true
    })
    return fileData
  }
}
