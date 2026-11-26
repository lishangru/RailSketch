import type { Command } from './Command'

export class CommandManager {
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private maxDepth = 200

  execute(command: Command): void {
    command.execute()
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift()
    this.redoStack.length = 0
  }

  undo(): boolean {
    const command = this.undoStack[this.undoStack.length - 1]
    if (!command) return false
    command.undo()
    this.undoStack.pop()
    this.redoStack.push(command)
    if (this.redoStack.length > this.maxDepth) this.redoStack.shift()
    return true
  }

  redo(): boolean {
    const command = this.redoStack[this.redoStack.length - 1]
    if (!command) return false
    command.execute()
    this.redoStack.pop()
    this.undoStack.push(command)
    return true
  }

  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
}
