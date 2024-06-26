
import { DiskImage, SectorData } from "./disk_image"
import { Dos33VTOC, Dos33Volume, Dos33FileEntry, Dos33VolFileEntry } from "./dos33"
import { FileType } from "./prodos"

enum SectorState {
  FREE = 0,
  USED = 1,
  REFED = 2
}

export class VerifiedDos33Volume extends Dos33Volume {

  private sectorStates: SectorState[][] = [][16]

  constructor(image: DiskImage, reformat: boolean) {
    super(image, reformat)
    // *** verify on construct? ***
  }

  public commitChanges(): void {
    this.verify()
    super.commitChanges()
  }

  public revertChanges(): void {
    super.revertChanges()
    // *** this will become excessive ***
    this.verify()
    super.revertChanges()
  }

  public verify() {
    try {
      this.verifyVolume()
    } catch (e: any) {
      console.log(e.message)
    }
  }

  verifyVolume() {

    this.sectorStates = []
    for (let t = 0; t < 35; t += 1) {
      const track = new Array(16).fill(SectorState.USED)
      this.sectorStates.push(track)
    }

    const vtoc = new Dos33VTOC(this.refReadTrackSector(17, 0))

    this.check(vtoc.dosVersion == 3,
      `Bad DOS version -- expected 3, got ${vtoc.dosVersion}`)
    this.check(vtoc.tsPairsPerSector == 122,
      `Bad TS pairs per sector -- expected 122, got ${vtoc.tsPairsPerSector}`)
    this.check(vtoc.tracksPerDisk == 35,
      `Bad tracks per disk -- expected 35, got ${vtoc.tracksPerDisk}`)
    this.check(vtoc.sectorsPerTrack == 16,
      `Sectors per track -- expected 16, got ${vtoc.sectorsPerTrack}`)
    this.check(vtoc.bytesPerSector == 256,
      `Bytes per sector -- expected 256, got ${vtoc.bytesPerSector}`)
    this.checkWarn(vtoc.data[0x00] == 0 || vtoc.data[0x00] == 4,
      `Questionable VTOC[0] value -- expected 0 or 4, got ${vtoc.data[0x00]}`)

    // *** check allocation track and direction ***

    for (let t = 0; t < 35; t += 1) {
      const offset = 0x38 + t * 4
      this.check(vtoc.data[offset + 2] == 0x00,
        `Free block bits set at VTOC[0x${(offset + 2).toString(16)}] (t:%{i})`)
      this.check(vtoc.data[offset + 3] == 0x00,
        `Free block bits set at VTOC[0x${(offset + 3).toString(16)}] (t:%{i})`)

      for (let j = 1; j >= 0; j -= 1) {
        const data = vtoc.data[offset + j]
        for (let k = 0; k < 8; k += 1) {
          if (data & (1 << k)) {
            this.sectorStates[t][(j ^ 1) * 8 + k] = SectorState.FREE
          }
        }
      }
    }

    for (let i = 0xC4; i <= 0xFF; i += 1) {
      this.check(vtoc.data[i] == 0x00,
        `Free block bits set at VTOC[0x${i.toString(16)}]`)
    }

    this.checkWarn(this.sectorStates[0][0] != SectorState.FREE, "Boot sector 0 marked as free")
    this.sectorStates[0][0] = SectorState.REFED

    // for (let i = 0; i < 16; i += 1) {
    //   const index = 17 * 16 + i
    //   this.checkWarn(this.blockStates[index] != BlockState.FREE, `Catalog sector ${i} marked as free`)
    //   this.blockStates[index] = BlockState.REFED
    // }

    this.verifyFiles(vtoc)

    // if all of track 0, 1, and 2 are used, then assume DOS image is present
    let allRefed = true
    for (let t = 0; t < 3; t += 1) {
      for (let s = (t == 0 ? 1 : 0); s < 16; s += 1) {
        if (this.sectorStates[t][s] != SectorState.USED) {
          allRefed = false
          break
        }
      }
    }

    for (let t = (allRefed ? 3 : 1); t < 35; t += 1) {
      for (let s = 0; s < 16; s += 1) {
        this.checkWarn(this.sectorStates[t][s] != SectorState.USED,
          `Track ${t} sector ${s} marked as used but never referenced`)
      }
    }
  }

  private verifyFiles(vtoc: Dos33VTOC) {
    let catTrack = vtoc.catTrack
    let catSector = vtoc.catSector
    while (true) {
      const cat = this.refReadTrackSector(catTrack, catSector)
      let offset = 0x0b
      do {
        // skip never used (0x00) or deleted (0xff)
        if (cat.data[offset + 0] != 0x00 && cat.data[offset + 0] != 0xff) {
          // *** validate file type? ***
          // *** validate all name characters ***
          const readExtra = false
          const fileEntry = new Dos33FileEntry(this, cat, offset, readExtra)
          this.verifyFile(vtoc, fileEntry)
        }
        offset += 0x23
      } while (offset < 0xff)

      catTrack = cat.data[1]
      catSector = cat.data[2]
      if (catTrack == 0 && catSector == 0) {
        break
      }
    }
  }

  private verifyFile(vtoc: Dos33VTOC, fileEntry: Dos33FileEntry) {
    this.progress(`Checking ${fileEntry.name}`)
    let tslTrack = fileEntry.tslTrack
    let tslSector = fileEntry.tslSector
    const pairsPerTsl = vtoc.tsPairsPerSector
    let sectorCount = 0

    while (true) {
      const tsList = this.refReadTrackSector(tslTrack, tslSector)
      sectorCount += 1
      for (let i = 0; i < pairsPerTsl; i += 1) {
        const t = tsList.data[0x0c + i * 2]
        const s = tsList.data[0x0d + i * 2]
        if (t != 0 || s != 0) {
          const sector = this.refReadTrackSector(t, s)
          sectorCount += 1
        }
      }
      tslTrack = tsList.data[0x01]
      tslSector = tsList.data[0x02]
      if (tslTrack == 0 && tslSector == 0) {
        break
      }
    }

    // EDASM.OBJ catalog entry says it's 7 (0x600 + TSList) sectors long,
    //  but the file itself says it's 0x66c bytes long

    // IMPROVED CATALOG has a sectorLength of 0

    this.checkWarn(sectorCount == fileEntry.sectorLength,
      `${fileEntry.name} sector count ${fileEntry.sectorLength} doesn't match observed count ${sectorCount}`)
  }

  private refReadTrackSector(t: number, s: number): SectorData {
    this.refTrackSector(t, s)
    return super.readTrackSector(t, s)
  }

  private refTrackSector(t: number, s: number) {

    // range check index
    this.check(t >= 0 && t < 35,
      `track ${t} sector ${s} out of range`)
    this.check(s >= 0 && s < 16,
      `track ${t} sector ${s} out of range`)

    // check for free block
    this.check(this.sectorStates[t][s] != SectorState.FREE,
      `track ${t} sector ${s} is marked as free but referenced`)

    // check for already referenced
    this.check(this.sectorStates[t][s] == SectorState.USED,
      `track ${t} sector ${s} already referenced`)

    // mark as now referenced
    this.sectorStates[t][s] = SectorState.REFED
  }

  private check(test: boolean, message: string) {
    if (!test) {
      throw new Error(message)
    }
  }

  private checkWarn(test: boolean, message: string) {
    if (!test) {
      console.log(message)
    }
  }

  private progress(message: string) {
    // console.log(message)
  }
}


function testDos33a() {
  const diskImage = new DiskImage("dsk", new Uint8Array(35 * 16 * 256), false)
  const volume = new VerifiedDos33Volume(diskImage, true)
  const parent = new Dos33VolFileEntry(volume)
  const file = volume.createFile(parent, "TEST_FILE", FileType.BIN, 0x2000)
  let direction = 1
  let fileSize = 0x100
  // *** binary files cap at 64K, others dont? ***
  const maxFileSize = 256 * 256 - 1 // 33 * 16 * 256   // *** figure in tsl sectors ***

  // *** generalize this code ***

  while (true) {
    const inData = new Uint8Array(fileSize)

    let value = 0
    for (let i = 0; i < inData.length; i += 1) {
      inData[i] = value++
      // let value change phase wrt block
      if (value == 255) {
        value = 0
      }
    }

    file.setContents(inData)
    volume.verify()

    const outData = file.getContents()
    if (outData.length != fileSize) {
      console.log("error")
    }

    for (let i = 0; i < inData.length; i += 1) {
      if (inData[i] != outData[i]) {
        console.log("error")
        break
      }
    }

    if (direction > 0) {
      if (fileSize < 0x100000) {
        fileSize += 0x1100
      } else {
        fileSize += 0x100100
      }
      if (fileSize > maxFileSize) {
        fileSize = maxFileSize
        direction = -1
      }
    } else {
      if (fileSize == 0) {
        break
      }
      if (fileSize < 0x100000) {
        fileSize -= 0x1100
      } else {
        fileSize -= 0x100100
      }
      if (fileSize < 0) {
        fileSize = 0
      }
    }
  }
}

function testDos33b() {
  const diskImage = new DiskImage("dsk", new Uint8Array(35 * 16 * 256), false)
  const volume = new VerifiedDos33Volume(diskImage, true)

  const iterationCount = 10000
  let fileIndex = 0
  let fileList: string[] = []

  while (fileIndex < iterationCount) {
    const fileSize = 0x380    // TODO: randomize size?
    const fileName = "FILE_" + fileIndex.toString()
    fileIndex += 1
    let file: Dos33FileEntry | undefined
    try {
      const parent = new Dos33VolFileEntry(volume)
      file = <Dos33FileEntry>volume.createFile(parent, fileName, FileType.BIN, fileSize)
      const fillData = new Uint8Array(fileSize).fill(0xee)
      file.setContents(fillData)
      volume.commitChanges()
    } catch (e: any) {
      volume.revertChanges()
      if (e.message != "Catalog full" && e.message != "Disk full") {
        console.log("error")
      }
    }

    if (!file) {
      // delete half of allocated files from list, randomly
      const parent = new Dos33VolFileEntry(volume)
      const count = Math.floor(fileList.length / 2)
      for (let i = 0; i < count; i += 1) {
        const n = Math.floor(Math.random() * fileList.length)
        try {
          const f = volume.findFileEntry(fileList[n])
          if (!f) {
            throw Error("File not found")
          }
          volume.deleteFile(parent, f)
          volume.commitChanges()
        } catch (e: any) {
          volume.revertChanges()
          console.log("error")
        }
        fileList.splice(n, 1)
      }
      continue
    }

    fileList.push(fileName)
  }

  while (true) {
    const fileName = fileList.pop()
    if (!fileName) {
      break
    }
    try {
      const parent = new Dos33VolFileEntry(volume)
      const f = volume.findFileEntry(fileName)
      if (!f) {
        throw Error("File not found")
      }
      volume.deleteFile(parent, f)
      volume.commitChanges()
    } catch (e: any) {
      volume.revertChanges()
      console.log("error")
    }
  }
}

// testDos33a()
// testDos33b()

//   Hex 80+file type - file is locked
//   00+file type - file is not locked
//   00 - Text file
//   01 - Integer BASIC file
//   02 - Applesoft BASIC file
//   04 - Binary file
//   08 - S type file
//   10 - Relocatable object module file
//   20 - A type file
//   40 - B type file
//   (thus, 84 is a locked Binary file, and 90 is a locked
//  R type file)
