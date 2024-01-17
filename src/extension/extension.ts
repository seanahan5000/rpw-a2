import * as vscode from 'vscode'
import { Apple2FileSystem } from "./a2fs"
import { HiresEditorProvider, ViewerProvider } from "./editor"

export function activate(context: vscode.ExtensionContext) {
  const a2fs = new Apple2FileSystem()

  // *** are all of these needed?
  // *** make writeable later ***
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('dsk', a2fs, { isReadonly: false, isCaseSensitive: false }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('do', a2fs, { isReadonly: false, isCaseSensitive: false }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('po', a2fs, { isReadonly: false, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('2mg', a2fs, { isReadonly: false, isCaseSensitive: true }))

  context.subscriptions.push(HiresEditorProvider.register(context))
  context.subscriptions.push(ViewerProvider.register(context, "LST"))
  context.subscriptions.push(ViewerProvider.register(context, "BIN"))
  context.subscriptions.push(ViewerProvider.register(context, "BAS"))
  context.subscriptions.push(ViewerProvider.register(context, "INT"))
  context.subscriptions.push(ViewerProvider.register(context, "TXT"))

  // *** could this be made to work with multiple volumes at the same time? ***
  context.subscriptions.push(vscode.commands.registerCommand('extension.mountApple2FileSystem', (uri: vscode.Uri) => {

    const wsUri = vscode.Uri.parse(`dsk:/?${uri}`)
    // *** other file systems ***

    if (vscode.workspace.getWorkspaceFolder(wsUri) === undefined) {
      const name = vscode.workspace.asRelativePath(uri, true)
      const index = vscode.workspace.workspaceFolders?.length || 0
      const workspaceFolder: vscode.WorkspaceFolder = { uri: wsUri, name, index }
      vscode.workspace.updateWorkspaceFolders(index, 0, workspaceFolder)
    }
  }))
}
