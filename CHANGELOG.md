# RPW A2 Changelog

### [3.0.0] - 2025-07-29

#### Added:
* Emulation of Apple II+ and IIe hardware
* Debugger protocol support
* Disk image nibbilizing/denibbilizing

#### Fixed:
* Lores pixel ordering

### [2.0.3] - 2025-02-07

#### Added:
* XOR/invert of entire screen, without selection (x)
* More zoom levels

#### Fixed:
* Select all selecting html elements along with pixels

### [2.0.2] - 2025-01-06

#### Added:
* XOR/invert of current selection (shift-x)

#### Fixed:
* Arrow keys scrolling window and selection
* Lasso mask lost on copy then paste
* Rectangle tool coordinate rounding

### [2.0.1] - 2024-12-30

Rework URI handling in order to fix VSCode EXPLORER view drawing weirdness.

#### Fixed:
* New files and folders showing in all mounted volumes instead of just the target.
* Incorrect file name being displayed after rename.

### [2.0.0] - 2024-12-21

Major rewrite of graphics editor to support more graphics formats, along with new editing tools.

#### Added:
* LORES, Double-LORES, and Double-HIRES editing support
* Lasso, text eraser, paint bucket, dropper, brush, line, and oval tools
* Custom cursors for tools
* Floating/hover help with much more detail

#### Fixed:
* Detection of ProDOS order sectors in .dsk images
* Dragging files into ProDOS subdirectories
* Copy/paste of file in same directory

### [1.0.1] - 2024-04-05

#### Fixed:

* Mount command again allows mounting more than one image.  (Something in VSCode must have changed to break this.)

### [1.0.0] - 2024-04-05

Initial version

#### Added:

* HIRES graphics editor
* ProDOS and DOS 3.3 file system provider
