This Retro Programmer's Workshop (RPW) extension provides VSCode editor support for HIRES graphics, and file system support for ProDOS and DOS 3.3 disk images.  (See the RPW 65 extension for other related funtionality.)

<img src="images/hires.gif"/>

#### HIRES Graphics Editor

<img src="images/hires.png"/>

##### NOTES

There is not a separate zoom tool.  Just move the cursor over the image to where you want to zoom in/out and press a number from 1 to 6.

Copying a graphics selection puts that data on the clipboard in text form, ready to be pasted into 6502 source code.  The reverse is also supported, with the extension attempting to determine the dimensions of the data.

#### File System Provider

* Mounts .dsk, .do, .po, .2mg, and .hdv images (.nib and .woz not supported)
* Supports file and folder move, copy, create, delete, and rename
* Displays file contents as text, hex, 6502 disassembly, or HIRES graphics
* Automatically detokenizes Applesoft and Integer BASIC files to text
* Automatically converts Merlin and LISA v2 source files to text

##### NOTES

New volume images can be created by right clicking and choosing "New File..." in your project.  Name the new file with one of the supported suffixes (.dsk, .po, etc.) and then Mount it.  A non-bootable, empty image will be initialized, ready for files to be added to it.

All write operations are treated as transactions.  The volume is verified before and after any operation.  If verification fails, the operation is rolled back and the volume left unmodified.  That said, back up any important disk image data before modifying with this extension.

This extension has been tested by opening and verifying most images in the Asimov archive.  It will refuse to open any image with any questionable or unknown formatting.  This conservative approach could be relaxed in the future if necessary.

The file conversion functionality in RPW A2 is enough to access old code and graphics, but is not intendend as a general-purpose file export and conversion tool.  For more complete conversion functionality, see tools like Ciderpress.

### Known Problems

* With multiple images mounted, adding a new file or directory to a volume appears to add it to all volumes.  The operation is correctly applied to just the target volume, but VSCode incorrectly updates the display of all volumes.  Switching away from the VSCode application and then back refreshes the display with the actual correct volume contents.

* File system error information such as Disk Full is buried in the VSCode error reporting dialog and not visible without viewing the full message.  It's unclear how to make VSCode display just the relevant information without the extra noise.

#### ProDOS

* Sparse files are not directly supported and will be converted to their expanded form if copied.

#### DOS 3.3

* Non-sequential text files are not supported.
* File names containing the "/" character can't be accessed.
