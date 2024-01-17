
import { DiskImage, FileEntry } from "./prodos"

// import { Dos33NoDosImage, Dos33Image } from "./dos33_image"

// TODO: just use index and share prodos BlockData structure instead
export type SectorData = {
  track: number
  index: number
  data: Uint8Array
}

type Dos33DataProc = (sector: SectorData) => boolean
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

  setContents(data: Uint8Array) {
    this.volume.setFileContents(this, data)
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
    // TODO: more validation on name?
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

  public commitChanges() {
    this.image.commitChanges()
  }

  public resetChanges() {
    this.image.resetChanges()
  }

  private readVTOC(): Uint8Array {
    return this.image.readTrackSector(17, 0)
  }

  // format(isBootable: boolean) {
  //   // zero all sectors
  //   for (let t = 0; t < this.TracksPerDisk; t += 1) {
  //     for (let s = 0; s < this.SectorsPerTrack; s += 1) {
  //       let sector = this.image.readTrackSector(t, s)
  //       // *** need to write cleared sector back ***
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
  //   *** write back all data ***
  // }

  forEachAllocatedFile(fileProc: Dos33FileProc) {
    let vtoc = this.readVTOC()
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

  // private forEachFreeFile(fileProc: Dos33FileProc) {
  //   let vtoc = this.readVTOC()
  //   let catTrack = vtoc[1]
  //   let catSector = vtoc[2]
  //   while (true) {
  //     let cat = this.image.readTrackSector(catTrack, catSector)
  //     let offset = 0x0B
  //     do {
  //       // look for never used (0x00) or deleted (0xff)
  //       if (cat[offset + 0] == 0x00 || cat[offset + 0] == 0xff) {
  //         let fileCat = { track: catTrack, index: catSector, data: cat }
  //         let fileEntry = new Dos33FileEntry(this, fileCat, offset)
  //         if (!fileProc(fileEntry)) {
  //           return
  //         }
  //       }
  //       offset += 0x23
  //     } while (offset < 0xff)
  //
  //     catTrack = cat[1]
  //     catSector = cat[2]
  //     if (catTrack == 0 && catSector == 0) {
  //       break
  //     }
  //   }
  // }

  private changeAllocationBit(track: number, sector: number, newBit: number | undefined): number {
    let vtoc = this.readVTOC()
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

  // private checkForSpace(sectorCount: number): boolean {
  //   let count = 0
  //   for (let t = 0; t < this.TracksPerDisk; t += 1) {
  //     for (let s = 0; s < this.SectorsPerTrack; s += 1) {
  //       if (this.testTrackSectorFree(t, s)) {
  //         count += 1
  //         if (count >= sectorCount) {
  //           return true
  //         }
  //       }
  //     }
  //   }
  //   return false
  // }

  private allocateSector(): SectorData | undefined {
    let vtoc = this.readVTOC()
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
    this.writeEachFileSector(fileEntry, (sector: SectorData): boolean => {
      return false
    })
    let cat = this.image.readTrackSector(fileEntry.catTrack, fileEntry.catSector)
    cat[fileEntry.catOffset + 0x20] = cat[fileEntry.catOffset + 0x00]
    cat[fileEntry.catOffset + 0x00] = 0xff
  }

  // protected allocateBinFileEntry(fileName: string): Dos33FileEntry | undefined {
  //   let fileEntry: Dos33FileEntry | undefined
  //
  //   this.forEachFreeFile((freeEntry: Dos33FileEntry) => {
  //     fileEntry = freeEntry
  //     return false
  //   })
  //
  //   if (!fileEntry) {
  //     //*** catalog is full ***
  //     return
  //   }
  //
  //   let tsList = this.allocateSector()
  //   if (!tsList) {
  //     //*** disk is full ***
  //     return
  //   }
  //
  //   // *** fileEntry is a data copy here ***
  //   fileEntry.tslTrack = tsList.track
  //   fileEntry.tslSector = tsList.index
  //   fileEntry.typeByte = 0x04
  //   fileEntry.isLocked = false
  //   fileEntry.type = "B"
  //   fileEntry.name = fileName.toUpperCase()
  //   fileEntry.sectorLength = 1            // *** should this be 2?
  //   fileEntry.updateCat()
  //   return fileEntry
  // }

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

  public getFileContents(entry: FileEntry): Uint8Array {  // *** | undefined?
    let fileEntry = entry as Dos33FileEntry
    let length = 0
    let outData: number[] = []
    this.readEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = sector.data.length
      let srcOffset = 0
      if (length == 0) {
        if (fileEntry.type == "B" || fileEntry.type == "Y") {
          // TODO: maybe no address for Y type file?
          fileEntry.auxType = sector.data[srcOffset + 0] + ((sector.data[srcOffset + 1]) << 8)
          srcOffset += 2
          copySize -= 2
        }
        if (fileEntry.type.match(/[BAIY]/)) {
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
      throw "Invalid file length"       // *** throw everywhere?
    }
    return new Uint8Array(outData)
  }

  private readEachFileSector(fileEntry: Dos33FileEntry, dataProc: Dos33DataProc) {
    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    let vtoc = this.readVTOC()
    let pairsPerTsl = vtoc[0x27]
    let index = 0
    while (true) {
      let tsList = this.image.readTrackSector(tslTrack, tslSector)
      if (!tsList) {
        console.log(`Invalid T/S list at track ${tslTrack}, sector ${tslSector}`)
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

  public setFileContents(entry: FileEntry, contents: Uint8Array): boolean {
    let fileEntry = entry as Dos33FileEntry

    const header: number[] = []
    if (fileEntry.type == "B" || fileEntry.type == "Y") {
      // TODO: maybe no address for Y type file?
      header.push(fileEntry.auxType & 0xff)
      header.push((fileEntry.auxType >> 8) & 0xff)
    }
    if (fileEntry.type.match(/[BAIY]/)) {
      header.push(contents.length & 0xff)
      header.push((contents.length >> 8) & 0xff)
    }

    let data = contents
    if (header.length > 0) {
      data = new Uint8Array(header.length + contents.length)
      data.set(header)
      data.set(contents, header.length)
    }

    let dataOffset = 0
    this.writeEachFileSector(fileEntry, (sector: SectorData): boolean => {
      let copySize = Math.min(sector.data.length, data.length - dataOffset)
      for (let i = 0; i < copySize; i += 1) {
        sector.data[i] = data[dataOffset + i]
      }
      dataOffset += copySize
      return dataOffset < data.length
    })

    // *** error check ***

    return true
  }

  // NOTE: this doesn't not correctly handle non-sequential text files

  private writeEachFileSector(fileEntry: Dos33FileEntry, dataProc: Dos33DataProc): boolean {
    let vtoc = this.readVTOC()
    let pairsPerTsl = vtoc[0x27]
    let moreData = true

    let sectorCount = 1
    let deltaCount = 0
    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    let tsList = this.image.readTrackSector(tslTrack, tslSector)
    if (!tsList) {
      // ERROR: bad track/sector values
      return false
    }

    while (true) {

      const deallocTsList = !moreData

      for (let i = 0; i < pairsPerTsl; i += 1) {
        let t = tsList[0x0c + i * 2]
        let s = tsList[0x0d + i * 2]
        if (moreData) {
          if (t == 0 && s == 0) {
            let dataSector = this.allocateSector()
            if (!dataSector) {
              // ERROR: failed to allocate another data sector
              return false
            }
            tsList[0x0c + i * 2] = dataSector.track
            tsList[0x0d + i * 2] = dataSector.index
            t = dataSector.track
            s = dataSector.index
            deltaCount += 1
          } else {
            sectorCount += 1
          }

          let sector = this.image.readTrackSector(t, s)
          if (!sector) {
            // ERROR: bad track/sector values
            return false
          }
          moreData = dataProc({ track: t, index: s, data: sector })
        } else {
          if (t != 0 && s != 0) {
            this.freeTrackSectorBit(t, s)
            deltaCount -= 1
            tsList[0x0c + i * 2] = 0
            tsList[0x0d + i * 2] = 0
            sectorCount += 1
          }
        }
      }

      if (moreData) {
        tslTrack = tsList[0x01]
        tslSector = tsList[0x02]
        if (tslTrack == 0 && tslSector == 0) {
          let tsSect = this.allocateSector()
          if (!tsSect) {
            // ERROR: failed to allocate another tsList sector
            return false
          }
          tslTrack = tsSect.track
          tslSector = tsSect.index
          tsList[0x1] = tsSect.track
          tsList[0x2] = tsSect.index
          tsList = tsSect.data
          deltaCount += 1
        }
      } else {
        if (deallocTsList) {
          this.freeTrackSectorBit(tslTrack, tslSector)
          deltaCount -= 1
        }
        tslTrack = tsList[0x01]
        tslSector = tsList[0x02]
        tsList[0x01] = 0
        tsList[0x02] = 0
        if (tslTrack == 0 && tslSector == 0) {
          break
        }
        tsList = this.image.readTrackSector(tslTrack, tslSector)
        if (!tsList) {
          // ERROR: bad track/sector values
          return false
        }
        sectorCount += 1
        if (sectorCount >= fileEntry.sectorLength) {
          break
        }
      }
    }

    fileEntry.sectorLength = sectorCount + deltaCount
    return true
  }
}

//------------------------------------------------------------------------------
