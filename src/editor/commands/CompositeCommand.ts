import type { Command } from './Command'

/** Child operations must be individually atomic; completed children are compensated on failure. */
export class CompositeCommand implements Command {
  readonly label: string

  constructor(label: string, readonly commands: Command[] = []) {
    this.label = label
  }

  execute(): void {
    const completed: Command[] = []
    try {
      for (const command of this.commands) {
        command.execute()
        completed.push(command)
      }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      for (const command of completed.reverse()) {
        try { command.undo() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
      if (rollbackErrors.length) throw Object.assign(new Error('Composite execute rollback failed'), { cause: error, rollbackErrors })
      throw error
    }
  }

  undo(): void {
    const completed: Command[] = []
    try {
      for (let i = this.commands.length - 1; i >= 0; i--) {
        this.commands[i].undo()
        completed.push(this.commands[i])
      }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      for (const command of completed.reverse()) {
        try { command.execute() } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
      if (rollbackErrors.length) throw Object.assign(new Error('Composite undo rollback failed'), { cause: error, rollbackErrors })
      throw error
    }
  }
}
