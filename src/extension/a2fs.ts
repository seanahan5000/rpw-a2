import * as fs from 'fs'
import * as vscode from 'vscode'
import * as path from 'path'
import { DiskImage, ProdosVolume, FileEntry, ProdosFileEntry } from "../filesys/prodos"
import { Dos33Volume } from '../filesys/dos33'

// *** TODO: this really needs test cases

export class Apple2FileSystem implements vscode.FileSystemProvider {

  private volumes = new Map<string, Dos33Volume | ProdosVolume>()

  private bufferedEvents: vscode.FileChangeEvent[] = []
  private fireSoonTimer?: NodeJS.Timer
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event

  public watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
    // ignore, fires for all changes
    return new vscode.Disposable(() => { })
  }

  private fireSoon(...events: vscode.FileChangeEvent[]): void {
    this.bufferedEvents.push(...events)
    if (this.fireSoonTimer) {
      clearTimeout(this.fireSoonTimer)
    }
    this.fireSoonTimer = setTimeout(() => {
      this.emitter.fire(this.bufferedEvents)
      this.bufferedEvents = []
    }, 5)
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
      const isReadOnly = false    // *** get this from somewhere ***
      const diskImage = new DiskImage(diskData, isReadOnly)
      if (ext == "dsk" || ext == "do") {
        volume = new Dos33Volume(diskImage)
      } else if (ext == "po" || ext == "2mg") {
        volume = new ProdosVolume(diskImage)
      } else {
        throw vscode.FileSystemError.FileNotFound(uri)
      }
      this.volumes.set(volumeUri.path, volume)
    }

    volume.resetChanges()

    let path = uri.path.slice(1)  // trim leading '/'
    if (!path) {
      const { ctime, mtime, size } = await vscode.workspace.fs.stat(volumeUri)
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    }

    const fileEntry = this.findFileOrDir(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    // *** TODO: get time information from actual files ***
    const ctime = Date.now()
    const mtime = Date.now()
    let size = 0
    if (fileEntry.type == "DIR") {
      return { type: vscode.FileType.Directory, ctime, mtime, size }
    } else {
      const contents = fileEntry.getContents()
      if (!contents) {
        // *** format error
        throw vscode.FileSystemError.Unavailable(uri)
      }
      return { type: vscode.FileType.File, ctime, mtime, size: contents.length }
    }
  }

  public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const volume = this.getVolume(uri)
    const entries: [string, vscode.FileType][] = []

    let dirFileEntry: ProdosFileEntry | undefined
    if (volume instanceof ProdosVolume) {
      dirFileEntry = <ProdosFileEntry>this.mayFindDir(volume, uri)
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

    // NOTE: no need to commitChanges on read-only operation
    return entries
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const volume = this.getVolume(uri)
    const fileEntry = this.findFile(volume, uri)
    if (!fileEntry) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    // NOTE: no need to commitChanges on read-only operation
    const contents = volume.getFileContents(fileEntry)
    if (!contents) {
      // *** format error
      throw vscode.FileSystemError.Unavailable(uri)
    }
    return contents
  }

  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    const volume = this.getVolume(uri)
    if (volume instanceof Dos33Volume) {
      // TODO: create better error?
      throw vscode.FileSystemError.NoPermissions(uri)
    }

    const dirName = uri.with({ path: path.posix.dirname(uri.path) })
    const baseName = path.posix.basename(uri.path)
    const parentDir = this.findDir(volume, dirName)

    //***

    volume.commitChanges()
    this.fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirName },
      { type: vscode.FileChangeType.Created, uri: uri }
    )
  }

  public writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void> {
    const volume = this.getVolume(uri)
    const fileEntry = this.findFile(volume, uri)
    if (fileEntry) {
      if (fileEntry.type == "DIR") {
        throw vscode.FileSystemError.FileIsADirectory(uri)
      }
      if (options.overwrite) {
        // TODO: overwrite existing file
        // TODO: check for same file type?
        // TODO: (if new file larger check for available space on difference)
        if (!volume.setFileContents(fileEntry, content)) {
          // TODO: create real error
          throw vscode.FileSystemError.Unavailable(uri)
        }
        volume.commitChanges()
      } else {
        throw vscode.FileSystemError.FileExists(uri)
      }
    } else if (options.create) {
      // TODO: create new file
      // TODO: validate file name?
      // TODO: get file type from somewhere?
      volume.commitChanges()
      this.fireSoon({ type: vscode.FileChangeType.Created, uri })
    } else {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    this.fireSoon({ type: vscode.FileChangeType.Changed, uri })
  }

  public delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void> {

    const volume = this.getVolume(uri)
    const dirName = uri.with({ path: path.posix.dirname(uri.path) })
    const baseName = path.posix.basename(uri.path)
    const parentDir = this.mayFindDir(volume, dirName)

    // const fileEntry = this.findFileOrDir(volume, uri)
    // if (!fileEntry) {
    //   throw vscode.FileSystemError.FileNotFound(uri)
    // }

    // if (fileEntry.type == "DIR") {
    //   // TODO: recurse?
    //   // TODO: changed events for each? or just recurse?
    // } else {

    // }

    volume.commitChanges()
    this.fireSoon(
      { type: vscode.FileChangeType.Changed, uri: dirName },
      { type: vscode.FileChangeType.Deleted, uri: uri }
    )


    // const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    // const basename = path.posix.basename(uri.path);
    // const parent = this._lookupAsDirectory(dirname, false);
    // if (!parent.entries.has(basename)) {
    // 	throw vscode.FileSystemError.FileNotFound(uri);
    // }
    // parent.entries.delete(basename);
    // parent.mtime = Date.now();
    // parent.size -= 1;
    // this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
  }

  public rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void> {
    const oldVolume = this.getVolume(oldUri)
    const newVolume = this.getVolume(newUri)

    // *** rename directory?

    // TODO: check new name for length
    // TODO: check new name for auxType information

    if (newVolume == oldVolume) {
      // TODO: move file within volume
    } else {
      // TODO: move file across volumes
    }

    // TODO: check for existing file/directory at target

    oldVolume.commitChanges()
    newVolume.commitChanges()
    this.fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    )
  }

  public copy(source: vscode.Uri, destination: vscode.Uri, options: { readonly overwrite: boolean }): void | Thenable<void> {
    // *** copy/paste appears to use this ***
    // *** source and destination could be directories? ***

    debugger  // ***
  }

  private getVolume(uri: vscode.Uri): ProdosVolume | Dos33Volume {
    const volumeUri = vscode.Uri.parse(uri.query)
    const volume = this.volumes.get(volumeUri.path)
    if (!volume) {
      throw vscode.FileSystemError.FileNotFound(volumeUri)
    }
    volume.resetChanges()
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
      const binLength = fileEntry.getContents()?.length ?? 0x0000
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
      if (type.startsWith("$")) {
        name += "_$" + fileEntry.auxType.toString(16).toUpperCase().padStart(4, "0")
      }
      name += "." + type
    }
    return name
  }

  private findFile(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry {
    const result = this.findFileOrDir(volume, uri)
    if (!result) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    if (result.type == "DIR") {
      throw vscode.FileSystemError.FileIsADirectory(uri)
    }
    return result
  }

  private findDir(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry {
    const result = this.findFileOrDir(volume, uri)
    if (!result) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    if (result.type != "DIR") {
      throw vscode.FileSystemError.FileNotADirectory(uri)
    }
    return result
  }

  private mayFindDir(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry | undefined {
    const result = this.findFileOrDir(volume, uri)
    if (result) {
      if (result.type != "DIR") {
        throw vscode.FileSystemError.FileNotADirectory(uri)
      }
    }
    return result
  }

  // private findParentDir(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry {
  //   const dirName = uri.with({ path: path.posix.dirname(uri.path) })
  //   return this.findDir(volume, dirName)
  // }

  private findFileOrDir(volume: Dos33Volume | ProdosVolume, uri: vscode.Uri): FileEntry | undefined {

    let parentDirEntry: ProdosFileEntry | undefined

    // *** shared code? ***
    let dirPath = uri.path.slice(1)  // trim leading '/'
    const dirName = path.posix.dirname(dirPath)
    if (dirName != "" && dirName != ".") {
      if (volume instanceof Dos33Volume) {
        // TODO: create better error?
        throw vscode.FileSystemError.NoPermissions(uri)
      }
      parentDirEntry = volume.findFileEntry(dirName)
      if (!parentDirEntry) {
        return
      }
    }

    // strip "magic" extensions
    let fileName = path.posix.basename(uri.path)
    let n = fileName.lastIndexOf("_$")
    if (n >= 0) {
      fileName = fileName.substring(0, n)
    }

    // get name without type extension
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
    }, parentDirEntry)

    return matchEntry
  }
}
