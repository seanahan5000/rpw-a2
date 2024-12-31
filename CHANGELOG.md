# RPW A2 Changelog

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
