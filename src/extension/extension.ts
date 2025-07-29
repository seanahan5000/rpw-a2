import * as vscode from 'vscode'
import { Apple2FileSystem } from "./a2fs"
import { HiresEditorProvider, ViewerProvider, EmulatorPanel } from "./editor"

export function activate(context: vscode.ExtensionContext) {
  const a2fs = new Apple2FileSystem()

  // TODO: are all of these needed?
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('dsk', a2fs, { isReadonly: false, isCaseSensitive: false }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('do',  a2fs, { isReadonly: false, isCaseSensitive: false }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('po',  a2fs, { isReadonly: false, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('2mg', a2fs, { isReadonly: false, isCaseSensitive: true }))
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider('hdv', a2fs, { isReadonly: false, isCaseSensitive: true }))

  context.subscriptions.push(HiresEditorProvider.register(context))
  context.subscriptions.push(ViewerProvider.register(context, "BIN"))
  context.subscriptions.push(ViewerProvider.register(context, "BAS"))
  context.subscriptions.push(ViewerProvider.register(context, "INT"))
  context.subscriptions.push(ViewerProvider.register(context, "LST"))

	context.subscriptions.push(
		vscode.commands.registerCommand('rpwa2.LaunchEmulatorIIp', (stopOnEntry?: boolean) => {
			EmulatorPanel.createOrShow(context.extensionUri, "iip", stopOnEntry ?? false)
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand('rpwa2.LaunchEmulatorIIe', (stopOnEntry?: boolean) => {
			EmulatorPanel.createOrShow(context.extensionUri, "iie", stopOnEntry ?? false)
		})
	)

  // TODO: could this be made to work with multiple volumes at the same time?
  context.subscriptions.push(vscode.commands.registerCommand('extension.mountApple2FileSystem',
    async (uri: vscode.Uri) => {

      await vscode.commands.executeCommand("vscode.open", uri)
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor")

      const dskUri = vscode.Uri.parse(`dsk:${uri.path}`, true)
      const name = vscode.workspace.asRelativePath(uri, true)
      const index = vscode.workspace.workspaceFolders?.length || 0
      const workspaceFolder: vscode.WorkspaceFolder = { uri: dskUri, name, index }
      vscode.workspace.updateWorkspaceFolders(index, 0, workspaceFolder)
    }
  ))
}
