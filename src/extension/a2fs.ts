import * as vscode from 'vscode'
import { DiskImage, ProdosVolume, FileEntry, ProdosFileEntry } from "../filesys/prodos"
import { Dos33Volume } from '../filesys/dos33'
import * as fs from 'fs'

export class Apple2FileSystem implements vscode.FileSystemProvider {

  private volumes = new Map<string, Dos33Volume | ProdosVolume>()

  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event

  public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    return new class {
      dispose() {
        // debugger  // ***
        // *** remove from volumes ***
      }
    }
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {

    const volumeUri = vscode.Uri.parse(uri.query)
    let volume = this.volumes.get(volumeUri.path)
    if (!volume) {

      const n = volumeUri.path.lastIndexOf(".")
      if (n < 0) {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      const ext = volumeUri.path.slice(n + 1).toLowerCase()

      const diskData = fs.readFileSync(volumeUri.path)
      const diskImage = new DiskImage(diskData)
      if (ext == "dsk" || ext == "do") {
        volume = new Dos33Volume(diskImage)
      } else if (ext == "po" || ext == "2mg") {
        volume = new ProdosVolume(diskImage)
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      this.volumes.set(volumeUri.path, volume)
    }

    let path = uri.path.slice(1)  // trim leading '/'
    if (!path) {
      const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    }

    const fileEntry = this.findFile(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    const ctime = Date.now()
    const mtime = Date.now()
    let size = 0
    if (fileEntry.type == "DIR") {
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    } else {
      size = fileEntry.getContents().length
      return { type: vscode.FileType.File, ctime, mtime, size }
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {

    const entries: [string, vscode.FileType][] = []
    const volume = this.getVolume(uri)

    let path = uri.path.slice(1)  // trim leading '/'
    let dirFileEntry: ProdosFileEntry | undefined
    while (path.length > 0) {

      let subDir: string | undefined
      const n = path.indexOf("/")
      if (n >= 0) {
        subDir = path.substring(0, n)
        path = path.substring(n + 1)
      } else {
        subDir = path
        path = ""
      }

      volume.forEachAllocatedFile((fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == "DIR") {
          if (fileEntry.name == subDir) {
            if (fileEntry instanceof ProdosFileEntry) {
              dirFileEntry = fileEntry
              return false
            }
          }
        }
        return true
      }, dirFileEntry)
    }

    volume.forEachAllocatedFile((fileEntry: FileEntry) => {
      const fileName = this.getFullFileName(fileEntry)
      if (fileEntry.type == "DIR") {
        entries.push([fileName, vscode.FileType.Directory])
      } else {
        entries.push([fileName, vscode.FileType.File])
      }
      return true
    }, dirFileEntry)

    return entries
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {

    const volume = this.getVolume(uri)
    const fileEntry = this.findFile(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return volume.getFileContents(fileEntry)
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    const volume = this.getVolume(uri)
    if (volume instanceof Dos33Volume) {
      throw vscode.FileSystemError.NoPermissions(uri)
    }

    debugger  // ***
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    debugger  // ***
  }

  private getVolume(uri: vscode.Uri): ProdosVolume | Dos33Volume {
    const volumeUri = vscode.Uri.parse(uri.query)
    const volume = this.volumes.get(volumeUri.path)
    if (!volume) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return volume
  }

  private getFullFileName(fileEntry: FileEntry): string {
    let name = fileEntry.name
    let type = fileEntry.type
    if (type == "DIR") {
      // no change
    } else if (type == "A") {
      name += ".BAS"
    } else if (type == "I") {
      name += ".INT"
    } else if (type == "T") {
      if (!fileEntry.name.endsWith(".TXT")) {
        name += ".TXT"
      }
    } else if (type == "B" || type == "BIN") {
      let defaultBin = true
      const binLength = fileEntry.getContents().length
      if (binLength >= 0x1FF8 && binLength <= 0x2000) {
        if (fileEntry.auxType == 0x2000 || fileEntry.auxType == 0x4000) {
          if (!fileEntry.name.endsWith(".PIC")) {
            name += ".PIC"
          }
          defaultBin = false
        }
      }
      if (defaultBin) {
        name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
        name += ".BIN"
      }
    } else if (type == "SYS") {
      name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      name += ".SYS"
  } else if (type != "DIR") {
      name += "." + type
    }
    return name
  }

  private findFile(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry | undefined {

    let path = uri.path.slice(1)  // trim leading '/'

    let dirFileEntry: ProdosFileEntry | undefined
    while (true) {

      let subDir: string | undefined
      const n = path.indexOf("/")
      if (n >= 0) {
        subDir = path.substring(0, n)
        path = path.substring(n + 1)
      } else {
        break
      }

      let matchDirEntry: ProdosFileEntry | undefined

      volume.forEachAllocatedFile((fileEntry: FileEntry) => {
        const fileName = this.getFullFileName(fileEntry)
        if (fileEntry.type == "DIR") {
          if (fileEntry.name == subDir) {
            if (fileEntry instanceof ProdosFileEntry) {
              matchDirEntry = fileEntry
              return false
            }
          }
        }
        return true
      }, dirFileEntry)

      if (!matchDirEntry) {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      dirFileEntry = matchDirEntry
    }

    // strip file extensions

    let fileName = path
    let n = fileName.lastIndexOf("_$")
    if (n >= 0) {
      fileName = fileName.substring(0, n)
    }

    let coreName = fileName
    n = fileName.lastIndexOf(".")
    if (n >= 0) {
      coreName = fileName.substring(0, n)
    }

    let matchEntry: FileEntry | undefined
    volume.forEachAllocatedFile((fileEntry: FileEntry) => {
      if (fileEntry.type == "DIR") {
        if (fileEntry.name != fileName) {
          return true
        }
      } else {
        if (fileEntry.name != fileName && fileEntry.name != coreName) {
          return true
        }
      }
      matchEntry = fileEntry
      return false
    }, dirFileEntry)

    if (!matchEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    return matchEntry
  }
}
