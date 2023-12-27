
import { DiskImage, FileEntry } from "./prodos"

// import { Dos33NoDosImage, Dos33Image } from "./dos33_image"

// TODO: just use index and share prodos BlockData structure instead
export type SectorData = {
  track: number
  index: number
  data: Uint8Array
}

type Dos33DataProc = (sector: SectorData) => boolean
type Dos33TlsProc = (sector: SectorData) => boolean
type Dos33FileProc = (fileEntry: Dos33FileEntry) => boolean

export class Dos33FileEntry implements FileEntry {
  name: string
  type: string
  auxType = -1

  catTrack: number
  catSector: number
  catOffset: number
  tslTrack: number
  tslSector: number
  typeByte = -1
  isLocked: boolean
  sectorLength: number

  private volume: Dos33Volume

  constructor(volume: Dos33Volume, cat: SectorData, offset: number) {
    this.volume = volume
    this.catTrack = cat.track
    this.catSector = cat.index
    this.catOffset = offset
    this.tslTrack = cat.data[offset + 0x00]
    // check for never used (0x00) or deleted (0xff)
    if (this.tslTrack == 0x00 || this.tslTrack == 0xFF) {
      this.tslSector = 0
      this.isLocked = false
      this.type = ""
      this.name = ""
      this.sectorLength = 0
    } else {
      this.tslSector = cat.data[offset + 0x01]
      this.typeByte = cat.data[offset + 0x02]
      this.isLocked = (this.typeByte & 0x80) != 0
      let index = 0
      let value = this.typeByte & 0x7F
      while (value != 0) {
        index += 1
        value >>= 1
      }
      this.type = "TIABSRXY?"[index]
      let nameBytes = cat.data.slice(offset + 0x03, offset + 0x03 + 30)
      for (let i = 0; i < nameBytes.length; i += 1) {
        nameBytes[i] = nameBytes[i] & 0x7f
      }
      this.name = String.fromCharCode(...nameBytes).trim()
      this.sectorLength = cat.data[offset + 0x21] + (cat.data[offset + 0x22] << 8)
    }
  }

  getContents(): Uint8Array {
    return this.volume.getFileContents(this)
  }

  lock() {
    this.isLocked = true
    this.typeByte |= 0x80
    let cat = this.volume.image.readTrackSector(this.catTrack, this.catSector)
    cat[this.catOffset + 0x02] = this.typeByte
  }

  unlock() {
    this.isLocked = false
    this.typeByte &= ~0x80
    let cat = this.volume.image.readTrackSector(this.catTrack, this.catSector)
    cat[this.catOffset + 0x02] = this.typeByte
  }

  rename(newName: string) {
    this.name = newName.toUpperCase()
    let cat = this.volume.image.readTrackSector(this.catTrack, this.catSector)
    let upperName = this.name.padEnd(30)
    let utf8Encode = new TextEncoder()
    let name30 = utf8Encode.encode(upperName)
    for (let i = 0; i < name30.length; i += 1) {
      cat[this.catOffset + 0x03 + i] = name30[i] | 0x80
    }
  }

  updateCat() {
    let cat = this.volume.image.readTrackSector(this.catTrack, this.catSector)
    cat[this.catOffset + 0x00] = this.tslTrack
    cat[this.catOffset + 0x01] = this.tslSector
    cat[this.catOffset + 0x02] = this.typeByte
    cat[this.catOffset + 0x21] = this.sectorLength & 0xff
    cat[this.catOffset + 0x22] = this.sectorLength >> 8
    this.rename(this.name)
  }
}

export class Dos33Volume {
  image: DiskImage

  readonly TracksPerDisk = 35
  readonly SectorsPerTrack = 16
  readonly BytesPerSector = 256

  constructor(image: DiskImage) {
    this.image = image
  }

  private getVTOC(): Uint8Array {
    return this.image.readTrackSector(17, 0)
  }

  // format(isBootable: boolean) {
  //   // zero all sectors
  //   for (let t = 0; t < this.TracksPerDisk; t += 1) {
  //     for (let s = 0; s < this.SectorsPerTrack; s += 1) {
  //       let sector = this.image.readTrackSector(t, s)
  //       sector.fill(0)
  //     }
  //   }
  //
  //   // initialize empty VTOC
  //   let vtoc = this.getVTOC()
  //   vtoc[0x00] = 4     // matches real disks
  //   vtoc[0x01] = 17    // first catalog track
  //   vtoc[0x02] = 15    // first catalog sector
  //   vtoc[0x03] = 3     // DOS 3.3
  //   vtoc[0x06] = 254   // volume
  //   vtoc[0x27] = 122   // track/sector pairs per sector
  //   vtoc[0x30] = 18    // last track where sectors were allocated
  //   vtoc[0x31] = 1     // direction of allocation
  //   vtoc[0x34] = this.TracksPerDisk
  //   vtoc[0x35] = this.SectorsPerTrack
  //   vtoc[0x36] = this.BytesPerSector & 0xFF
  //   vtoc[0x37] = this.BytesPerSector >> 8
  //
  //   for (let t = 0; t < this.TracksPerDisk; t += 1) {
  //     // mark first 3 tracks as allocated for DOS
  //     if (isBootable && t < 3) {
  //       continue
  //     }
  //     // mark track 17 as allocated for catalog
  //     if (t == 17) {
  //       continue
  //     }
  //     vtoc[0x38 + t * 4 + 0] = 0xFF
  //     vtoc[0x38 + t * 4 + 1] = 0xFF
  //
  //     // track 0 sector 0 is always allocated, even if non-bootable
  //     if (t == 0 && !isBootable) {
  //       vtoc[0x38 + t * 4 + 1] = 0xFE
  //     }
  //   }
  //
  //   // initialize catalog sectors
  //   for (let s = this.SectorsPerTrack - 1; s > 1; s -= 1) {
  //     let sector = this.image.readTrackSector(17, s)
  //     sector[0x01] = 17
  //     sector[0x02] = s - 1
  //   }
  //
  //   // initialize boot image
  //   let t = 0
  //   let s = 0
  //   let srcOffset = 0
  //   let bootData = isBootable ? Dos33Image : Dos33NoDosImage
  //   while (srcOffset < bootData.length) {
  //     let copySize = Math.min(this.BytesPerSector, bootData.length - srcOffset)
  //     let sector = this.image.readTrackSector(t, s)
  //     sector.set(bootData.subarray(srcOffset, srcOffset + copySize))
  //     srcOffset += this.BytesPerSector
  //     s += 1
  //     if (s == this.SectorsPerTrack) {
  //       s = 0
  //       t += 1
  //     }
  //   }
  // }

  forEachAllocatedFile(fileProc: Dos33FileProc) {
    let vtoc = this.getVTOC()
    let catTrack = vtoc[1]
    let catSector = vtoc[2]
    while (true) {
      let cat = this.image.readTrackSector(catTrack, catSector)
      if (!cat) {
        console.log(`Bad catalog track ${catTrack}, sector ${catSector}`)
        break
      }
      let offset = 0x0b
      do {
        // skip never used (0x00) or deleted (0xff)
        if (cat[offset + 0] != 0x00 && cat[offset + 0] != 0xff) {
          let fileCat = { track: catTrack, index: catSector, data: cat }
          let fileEntry = new Dos33FileEntry(this, fileCat, offset)
          if (!fileProc(fileEntry)) {
            return
          }
        }
        offset += 0x23
      } while (offset < 0xff)

      catTrack = cat[1]
      catSector = cat[2]
      if (catTrack == 0 && catSector == 0) {
        break
      }
    }
  }

  private forEachFreeFile(fileProc: Dos33FileProc) {
    let vtoc = this.getVTOC()
    let catTrack = vtoc[1]
    let catSector = vtoc[2]
    while (true) {
      let cat = this.image.readTrackSector(catTrack, catSector)
      let offset = 0x0B
      do {
        // look for never used (0x00) or deleted (0xff)
        if (cat[offset + 0] == 0x00 || cat[offset + 0] == 0xff) {
          let fileCat = { track: catTrack, index: catSector, data: cat }
          let fileEntry = new Dos33FileEntry(this, fileCat, offset)
          if (!fileProc(fileEntry)) {
            return
          }
        }
        offset += 0x23
      } while (offset < 0xff)

      catTrack = cat[1]
      catSector = cat[2]
      if (catTrack == 0 && catSector == 0) {
        break
      }
    }
  }

  protected forEachFileSector(fileEntry: Dos33FileEntry, dataProc: Dos33DataProc, tslProc?: Dos33TlsProc) {
    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    let vtoc = this.getVTOC()
    let pairsPerTsl = vtoc[0x27]      //*** require this to start and then use constant
    let index = 0
    while (true) {
      let tsList = this.image.readTrackSector(tslTrack, tslSector)
      if (!tsList) {
        console.log(`Invalid T/S list at track ${tslTrack}, sector ${tslSector}`)
        return
      }
      if (tslProc && !tslProc({track: tslTrack, index: tslSector, data: tsList})) {
        return
      }
      index += 1
      for (let i = 0; i < pairsPerTsl; i += 1) {
        //*** TODO: this isn't working here
        //  EDASM.OBJ catalog entry says it's 7 (0x600 + TSList) sectors long,
        //  but the file itself says it's 0x66c bytes long
        //
        // if (index == fileEntry.sectorLength) {
        //   return
        // }
        let t = tsList[0x0c + i * 2]
        let s = tsList[0x0d + i * 2]
        if (dataProc) {
          let sector = this.image.readTrackSector(t, s)
          if (!sector) {
            console.log(`Invalid track ${t}, sector ${s}`)
            // TODO: maybe let caller deal with missing data instead?
            sector = new Uint8Array(256)
            sector.fill(0xEE)
          }
          if (!dataProc({ track: t, index: s, data: sector })) {
            return
          }
        }
        //*** TODO: reconcile with comment above
        if (index == fileEntry.sectorLength) {
          return
        }
        index += 1
      }
      tslTrack = tsList[0x01]
      tslSector = tsList[0x02]
      if (tslTrack == 0 && tslSector == 0) {
        //*** ran out of track/sectors
        break
      }
    }
  }

  private changeAllocationBit(track: number, sector: number, newBit: number | undefined): number {
    let vtoc = this.getVTOC()
    let offset = 0x38 + track * 4
    if (sector < 8) {
      offset += 1
    }
    let mask = 1 << (sector & 7)
    let previous = (vtoc[offset] & mask) ? 1 : 0
    if (newBit != undefined) {
      if (newBit == 0) {
        vtoc[offset] &= ~mask
      } else {
        vtoc[offset] |= mask
      }
    }
    return previous
  }

  private allocateTrackSectorBit(track: number, sector: number): boolean {
    return this.changeAllocationBit(track, sector, 0) == 1
  }

  private freeTrackSectorBit(track: number, sector: number): boolean {
    return this.changeAllocationBit(track, sector, 1) == 0
  }

  protected testTrackSectorFree(track: number, sector: number): boolean {
    return this.changeAllocationBit(track, sector, undefined) == 1
  }

  private checkForSpace(sectorCount: number): boolean {
    let count = 0
    for (let t = 0; t < this.TracksPerDisk; t += 1) {
      for (let s = 0; s < this.SectorsPerTrack; s += 1) {
        if (this.testTrackSectorFree(t, s)) {
          count += 1
          if (count >= sectorCount) {
            return true
          }
        }
      }
    }
    return false
  }

  private allocateSector(): SectorData | undefined {
    let vtoc = this.getVTOC()
    let firstTrack = vtoc[0x30]
    let track = firstTrack
    let forwardDone = false
    let backwardDone = false
    while (true) {
      for (let s = this.SectorsPerTrack; --s >= 0; ) {
        if (this.allocateTrackSectorBit(track, s)) {
          vtoc[0x30] = track
          let sector = this.image.readTrackSector(track, s)
          sector.fill(0)
          return { track: track, index: s, data: sector }
        }
      }
      track = (track + vtoc[0x31]) & 0xff
      if (track == this.TracksPerDisk) {
        forwardDone = true
        vtoc[0x31] = -1
        track = 16
      } else if (track == 0xff) {
        backwardDone = true
        vtoc[0x31] = 1
        track = 18
      }
      if (forwardDone && backwardDone && track == firstTrack) {
        break
      }
    }
  }

  protected deleteFileEntry(fileEntry: Dos33FileEntry) {
    this.resizeFile(fileEntry, 0)

    let cat = this.image.readTrackSector(fileEntry.catTrack, fileEntry.catSector)
    cat[fileEntry.catOffset + 0x20] = cat[fileEntry.catOffset + 0x00]
    cat[fileEntry.catOffset + 0x00] = 0xff
  }

  protected allocateBinFileEntry(fileName: string): Dos33FileEntry | undefined {
    let fileEntry: Dos33FileEntry | undefined

    this.forEachFreeFile((freeEntry: Dos33FileEntry) => {
      fileEntry = freeEntry
      return false
    })

    if (!fileEntry) {
      //*** catalog is full ***
      return
    }

    let tsList = this.allocateSector()
    if (!tsList) {
      //*** disk is full ***
      return
    }

    fileEntry.tslTrack = tsList.track
    fileEntry.tslSector = tsList.index
    fileEntry.typeByte = 0x04
    fileEntry.isLocked = false
    fileEntry.type = "B"
    fileEntry.name = fileName.toUpperCase()
    fileEntry.sectorLength = 1
    fileEntry.updateCat()
    return fileEntry
  }

  // bsaveFileEntry(fileEntry: Dos33FileEntry, fileData: Dos33FileData) {
  //   let byteData = this.byteDataFromBinFile(fileData)
  //   if (!this.resizeFile(fileEntry, byteData.length)) {
  //     //*** disk is full ***
  //   }
  //   this.writeData(fileEntry, byteData)
  //   return true
  // }

  //*** fold into bsaveFileEntry? ***
  // private byteDataFromBinFile(fileData: Dos33FileData) {
  //   let byteData = new Uint8Array(4 + fileData.data.length)
  //   byteData[0x00] = fileData.address & 255
  //   byteData[0x01] = fileData.address >> 8
  //   byteData[0x02] = fileData.data.length & 255
  //   byteData[0x03] = fileData.data.length >> 8
  //   byteData.set(fileData.data, 4)
  //   return byteData
  // }

  // grow/shrink the number of sectors in the file
  //  (including a newly allowed empty file)
  //*** test by deleting damaged files like EDASM.OBJ ***
  private resizeFile(fileEntry: Dos33FileEntry, newSize: number): boolean {

    let newSectorCount = Math.ceil(newSize / 256)
    newSectorCount += Math.ceil(newSectorCount / 122)       //*** use constant ***
    let oldSectorCount = fileEntry.sectorLength

    if (newSectorCount != oldSectorCount) {

      let tsList: Uint8Array | undefined
      let tslTrack = 0
      let tslSector = 0
      let tslOffset = 256
      let sectorIndex = 0
      let sectorOffset = 0

      if (newSectorCount > 0 || oldSectorCount > 0) {
        tsList = this.image.readTrackSector(fileEntry.tslTrack, fileEntry.tslSector)
        sectorOffset += 122      //*** constant
        tslOffset = 0x0C
        sectorIndex += 1
      }

      if (!tsList) {
        return false
      }

      let keepCount = Math.min(newSectorCount, oldSectorCount)
      while (sectorIndex < keepCount) {
        if (tslOffset > 254) {
          tslTrack = tsList[0x01]
          tslSector = tsList[0x02]
          tsList = this.image.readTrackSector(tslTrack, tslSector)
          sectorOffset += 122      //*** constant/compare against existing?
          tslOffset = 0x0C
          sectorIndex += 1
        }
        tslOffset += 2
        sectorIndex += 1
      }

      if (newSectorCount > oldSectorCount) {
        if (!this.checkForSpace(newSectorCount - oldSectorCount)) {
          //*** disk is full ***
          return false
        }

        while (sectorIndex < newSectorCount) {
          // check for adding another sector to the track/sector list
          if (tslOffset > 254) {
            let tsNextList = this.allocateSector()
            if (!tsNextList) {
              return false
            }

            // track/sector of next T/S list
            tsList[0x01] = tsNextList.track
            tsList[0x02] = tsNextList.index
            // sector offset in file of first sector described by list
            sectorOffset += 122       //*** use constant ***
            tsList[0x05] = sectorOffset & 255
            tsList[0x06] = sectorOffset >> 8
            tsList = tsNextList.data
            tslOffset = 0x0C
            sectorIndex += 1
          }

          let dataSector = this.allocateSector()
          if (!dataSector) {
            return false
          }

          tsList[tslOffset + 0] = dataSector.track
          tsList[tslOffset + 1] = dataSector.index
          tslOffset += 2
          sectorIndex += 1
        }
      } else {    //*** ever == here?

        while (true) {

          let startTslOffset = tslOffset

          while (tslOffset <= 254 && sectorIndex < oldSectorCount) {
            let t = tsList[tslOffset + 0]
            let s = tsList[tslOffset + 1]
            if (t != 0 && s != 0) {
              this.freeTrackSectorBit(t, s)
              tsList[tslOffset + 0] = 0
              tsList[tslOffset + 1] = 0
              sectorIndex += 1
            }
            tslOffset += 2
          }

          let tslNextTrack = tsList[0x01]
          let tslNextSector = tsList[0x02]
          if (startTslOffset == 0x0C) {
            this.freeTrackSectorBit(tslTrack, tslSector)
          }

          if (sectorIndex >= oldSectorCount) {
            break
          }
          if (tslTrack == 0 && tslSector == 0) {
            break
          }
          tslTrack = tslNextTrack
          tslSector = tslNextSector
          tsList = this.image.readTrackSector(tslTrack, tslSector)
          tslOffset = 0x0C
        }
      }

      // update size in file and catalog entry
      fileEntry.sectorLength = newSectorCount
      let cat = this.image.readTrackSector(fileEntry.catTrack, fileEntry.catSector)
      cat[fileEntry.catOffset + 0x21] = newSectorCount & 0xff
      cat[fileEntry.catOffset + 0x22] = newSectorCount >> 8
    }

    return true
  }

  // write data into sectors previously allocated by resizeFile
  private writeData(fileEntry: Dos33FileEntry, byteData: Uint8Array) {
    let srcOffset = 0
    this.forEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = sector.data.length
      let remaining = byteData.length - srcOffset
      if (copySize > remaining) {
        copySize = remaining
      }
      let startOffset = srcOffset
      srcOffset += copySize
      sector.data.set(byteData.subarray(startOffset, srcOffset), 0)
      return true
    })

    if (srcOffset != byteData.length) {
      //*** something went wrong ***
    }
  }

  getFileContents(entry: FileEntry): Uint8Array {
    let fileEntry = entry as Dos33FileEntry
    // let address = -1
    let length = 0
    let outData: number[] = []
    this.forEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = sector.data.length
      let srcOffset = 0
      if (length == 0) {
        if (fileEntry.type == "B" || fileEntry.type == "Y") {   //*** */
          //*** maybe not for Y
          fileEntry.auxType = sector.data[srcOffset + 0] + ((sector.data[srcOffset + 1]) << 8)
          srcOffset += 2
          copySize -= 2
        }
        if (fileEntry.type.match(/[BAIY]/)) {   //*** */
          length = sector.data[srcOffset + 0] + ((sector.data[srcOffset + 1]) << 8)
          srcOffset += 2
          copySize -= 2
        }
      }
      let inData = Array.from(sector.data)
      if (fileEntry.type == "T") {
        for (let i = 0; i < copySize; i += 1) {
          if (inData[i] == 0) {
            outData = outData.concat(inData.slice(0, i))
            length += i
            return false
          }
        }
        length += copySize
      }
      let remaining = length - outData.length
      if (copySize > remaining) {
        copySize = remaining
      }
      outData = outData.concat(inData.slice(srcOffset, srcOffset + copySize))
      return true
    })
    if (length != outData.length) {
      throw "Invalid file length"
    }
    return new Uint8Array(outData)
  }
}

//------------------------------------------------------------------------------
